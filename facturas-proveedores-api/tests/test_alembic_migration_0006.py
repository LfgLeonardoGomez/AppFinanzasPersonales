"""
Tests for Alembic migration 0006 — the negocio scoping axis (C-28, D-27).

This is the highest-risk piece of C-28: it runs against real production data.
A mis-assigned `negocio_id` does not break a screen — it hands one shop's
invoices to another and stays silent.

So these tests seed a database at revision 0005 with TWO users that each own
suppliers, invoices and payments, run the upgrade, and assert that:
- every row ends up with a non-null `negocio_id`,
- the two data sets remain disjoint (nobody changed effective owner),
- each pre-existing user became the admin of their own negocio,
- and the whole thing survives an upgrade → downgrade → upgrade round trip
  without losing business rows.

Revisions are pinned explicitly ("0005", "0006") rather than head/-1, per D-21.
"""

import os
import subprocess
import sys
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migration_engine_0006():
    """Disposable Postgres dedicated to the 0006 migration test."""
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_6",
        password="mig_pass_6",
        dbname="test_migration_0006",
    ) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+psycopg2://", 1)
        os.environ["DATABASE_URL"] = url
        engine = create_engine(url, echo=False)
        yield engine
        engine.dispose()
    if original_db_url is None:
        os.environ.pop("DATABASE_URL", None)
    else:
        os.environ["DATABASE_URL"] = original_db_url


def _run_alembic(*args: str) -> None:
    result = subprocess.run(
        [sys.executable, "-m", "alembic"] + list(args),
        cwd=str(API_ROOT),
        capture_output=True,
        text=True,
        env=os.environ,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}"
        )


def _seed_at_0005(engine) -> dict:
    """Insert two independent users with their own suppliers, invoices and payments.

    Returns the ids so the post-migration assertions can prove nothing crossed
    over. `usuario_a` carries a nombre_negocio; `usuario_b` deliberately leaves
    it NULL so the fallback path is exercised too.
    """
    ids = {
        "usuario_a": uuid.uuid4(),
        "usuario_b": uuid.uuid4(),
        "prov_a": uuid.uuid4(),
        "prov_b": uuid.uuid4(),
        "fact_a": uuid.uuid4(),
        "fact_b": uuid.uuid4(),
        "pago_a": uuid.uuid4(),
        "pago_b": uuid.uuid4(),
    }

    with engine.begin() as conn:
        for key, nombre, nombre_negocio in (
            ("usuario_a", "Ana", "Almacén Ana"),
            ("usuario_b", "Bruno", None),
        ):
            conn.execute(
                text(
                    "INSERT INTO usuario (id, email, nombre, password_hash, "
                    "nombre_negocio, tema_preferido, created_at, updated_at) "
                    "VALUES (:id, :email, :nombre, 'hash', :nn, 'CLARO', now(), now())"
                ),
                {
                    "id": ids[key],
                    "email": f"{key}_{uuid.uuid4().hex[:8]}@test.com",
                    "nombre": nombre,
                    "nn": nombre_negocio,
                },
            )

        for user_key, prov_key, fact_key, pago_key in (
            ("usuario_a", "prov_a", "fact_a", "pago_a"),
            ("usuario_b", "prov_b", "fact_b", "pago_b"),
        ):
            conn.execute(
                text(
                    "INSERT INTO proveedor (id, usuario_id, nombre, categoria, "
                    "created_at, updated_at) "
                    "VALUES (:id, :uid, :nombre, 'OTRO', now(), now())"
                ),
                {"id": ids[prov_key], "uid": ids[user_key], "nombre": f"Prov {prov_key}"},
            )
            conn.execute(
                text(
                    "INSERT INTO factura (id, usuario_id, proveedor_id, fecha_emision, "
                    "monto_total, origen, created_at, updated_at) "
                    "VALUES (:id, :uid, :pid, '2026-01-10', 1000.00, 'MANUAL', now(), now())"
                ),
                {"id": ids[fact_key], "uid": ids[user_key], "pid": ids[prov_key]},
            )
            conn.execute(
                text(
                    "INSERT INTO pago (id, usuario_id, proveedor_id, monto, fecha, "
                    "metodo, origen, created_at, updated_at) "
                    "VALUES (:id, :uid, :pid, 400.00, '2026-01-12', 'EFECTIVO', "
                    "'MANUAL', now(), now())"
                ),
                {"id": ids[pago_key], "uid": ids[user_key], "pid": ids[prov_key]},
            )

    return ids


@pytest.fixture(scope="module")
def migrated(migration_engine_0006):
    """Seed at 0005, then upgrade to 0006. Returns (engine, seeded ids)."""
    engine = migration_engine_0006
    _run_alembic("upgrade", "0005")
    ids = _seed_at_0005(engine)
    _run_alembic("upgrade", "0006")
    return engine, ids


class TestBackfillPreservesOwnership:
    """Task 3.1 — nobody changes effective owner."""

    def test_every_business_row_has_a_negocio(self, migrated):
        engine, _ = migrated
        with engine.connect() as conn:
            for tabla in ("usuario", "proveedor", "factura", "pago"):
                huerfanas = conn.execute(
                    text(f"SELECT count(*) FROM {tabla} WHERE negocio_id IS NULL")
                ).scalar()
                assert huerfanas == 0, f"{tabla} quedó con filas sin negocio_id"

    def test_the_two_data_sets_stay_disjoint(self, migrated):
        engine, ids = migrated
        with engine.connect() as conn:
            negocio_a = conn.execute(
                text("SELECT negocio_id FROM usuario WHERE id = :id"),
                {"id": ids["usuario_a"]},
            ).scalar()
            negocio_b = conn.execute(
                text("SELECT negocio_id FROM usuario WHERE id = :id"),
                {"id": ids["usuario_b"]},
            ).scalar()

            assert negocio_a != negocio_b

            for tabla, a_key, b_key in (
                ("proveedor", "prov_a", "prov_b"),
                ("factura", "fact_a", "fact_b"),
                ("pago", "pago_a", "pago_b"),
            ):
                fila_a = conn.execute(
                    text(f"SELECT negocio_id FROM {tabla} WHERE id = :id"),
                    {"id": ids[a_key]},
                ).scalar()
                fila_b = conn.execute(
                    text(f"SELECT negocio_id FROM {tabla} WHERE id = :id"),
                    {"id": ids[b_key]},
                ).scalar()

                assert fila_a == negocio_a, f"{tabla} de A cambió de dueño"
                assert fila_b == negocio_b, f"{tabla} de B cambió de dueño"

    def test_authorship_is_backfilled_from_the_old_owner(self, migrated):
        engine, ids = migrated
        with engine.connect() as conn:
            autor = conn.execute(
                text("SELECT creado_por_usuario_id FROM factura WHERE id = :id"),
                {"id": ids["fact_a"]},
            ).scalar()
            assert autor == ids["usuario_a"]


class TestNegociosCreatedForExistingUsers:
    """Task 3.2 — one negocio per pre-existing user, each of them admin."""

    def test_one_negocio_per_preexisting_user(self, migrated):
        engine, _ = migrated
        with engine.connect() as conn:
            usuarios = conn.execute(text("SELECT count(*) FROM usuario")).scalar()
            negocios = conn.execute(text("SELECT count(*) FROM negocio")).scalar()
            distintos = conn.execute(
                text("SELECT count(DISTINCT negocio_id) FROM usuario")
            ).scalar()

        assert negocios == usuarios == distintos

    def test_preexisting_users_become_active_admins(self, migrated):
        engine, _ = migrated
        with engine.connect() as conn:
            no_admin = conn.execute(
                text("SELECT count(*) FROM usuario WHERE es_admin IS NOT TRUE")
            ).scalar()
            desactivados = conn.execute(
                text("SELECT count(*) FROM usuario WHERE desactivado IS NOT FALSE")
            ).scalar()

        assert no_admin == 0
        assert desactivados == 0

    def test_negocio_name_comes_from_nombre_negocio(self, migrated):
        engine, ids = migrated
        with engine.connect() as conn:
            nombre = conn.execute(
                text(
                    "SELECT n.nombre FROM negocio n "
                    "JOIN usuario u ON u.negocio_id = n.id WHERE u.id = :id"
                ),
                {"id": ids["usuario_a"]},
            ).scalar()
        assert nombre == "Almacén Ana"

    def test_negocio_name_falls_back_when_nombre_negocio_is_null(self, migrated):
        engine, ids = migrated
        with engine.connect() as conn:
            nombre = conn.execute(
                text(
                    "SELECT n.nombre FROM negocio n "
                    "JOIN usuario u ON u.negocio_id = n.id WHERE u.id = :id"
                ),
                {"id": ids["usuario_b"]},
            ).scalar()
        assert nombre is not None and nombre.strip() != ""
        assert "Bruno" in nombre


class TestSchemaShape:
    """Tasks 3.4 and 3.6 — invariants and the index axis."""

    def test_no_derived_columns_were_introduced(self, migrated):
        engine, _ = migrated
        inspector = inspect(engine)
        for tabla in ("factura", "pago", "proveedor", "negocio", "usuario"):
            columnas = {c["name"] for c in inspector.get_columns(tabla)}
            assert "saldo" not in columnas, f"{tabla} ganó una columna saldo"
            assert "estado" not in columnas, f"{tabla} ganó una columna estado"

    def test_factura_id_still_absent_from_pago(self, migrated):
        engine, _ = migrated
        inspector = inspect(engine)
        columnas = {c["name"] for c in inspector.get_columns("pago")}
        assert "factura_id" not in columnas

    def test_old_usuario_id_columns_are_gone(self, migrated):
        """A dead column holding plausible data is an invitation to filter by it."""
        engine, _ = migrated
        inspector = inspect(engine)
        for tabla in ("proveedor", "factura", "pago"):
            columnas = {c["name"] for c in inspector.get_columns(tabla)}
            assert "usuario_id" not in columnas, f"{tabla} conserva usuario_id"

    def test_scoped_indexes_lead_with_negocio(self, migrated):
        engine, _ = migrated
        inspector = inspect(engine)
        for tabla in ("proveedor", "factura", "pago"):
            indices = inspector.get_indexes(tabla)
            assert any(
                idx["column_names"] and idx["column_names"][0] == "negocio_id"
                for idx in indices
            ), f"{tabla} no tiene ningún índice que lidere con negocio_id"

    def test_negocio_id_is_not_nullable(self, migrated):
        engine, _ = migrated
        inspector = inspect(engine)
        for tabla in ("usuario", "proveedor", "factura", "pago"):
            columna = next(
                c for c in inspector.get_columns(tabla) if c["name"] == "negocio_id"
            )
            assert columna["nullable"] is False, f"{tabla}.negocio_id quedó nullable"


class TestRoundTrip:
    """Task 3.3 — downgrade must be survivable, not theoretical."""

    def test_upgrade_downgrade_upgrade_keeps_business_rows(self, migrated):
        engine, ids = migrated

        def contar():
            with engine.connect() as conn:
                return {
                    tabla: conn.execute(text(f"SELECT count(*) FROM {tabla}")).scalar()
                    for tabla in ("usuario", "proveedor", "factura", "pago")
                }

        antes = contar()

        _run_alembic("downgrade", "0005")
        with engine.connect() as conn:
            inspector = inspect(engine)
            assert "negocio" not in inspector.get_table_names()
            despues_downgrade = {
                tabla: conn.execute(text(f"SELECT count(*) FROM {tabla}")).scalar()
                for tabla in ("usuario", "proveedor", "factura", "pago")
            }
        assert despues_downgrade == antes, "el downgrade perdió filas de negocio"

        _run_alembic("upgrade", "0006")
        assert contar() == antes, "el re-upgrade perdió filas de negocio"

        with engine.connect() as conn:
            huerfanas = conn.execute(
                text("SELECT count(*) FROM factura WHERE negocio_id IS NULL")
            ).scalar()
        assert huerfanas == 0
