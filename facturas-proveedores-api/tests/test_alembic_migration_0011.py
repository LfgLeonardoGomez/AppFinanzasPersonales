"""
Tests for Alembic migration 0011 — cobro_cliente (C-35).

Same discipline as test_alembic_migration_0010.py: the D-56 failure mode (an
enum type created twice, breaking every later migration) is invisible in a
schema-shape test alone, so the chain is proven end to end, and the round
trip (upgrade -> downgrade -> upgrade) is exercised so a leftover Postgres
type would fail here instead of silently blocking the next real migration.

Revisions pinned ("0010", "0011") rather than head/-1, per D-21.
"""

import os
import subprocess
import sys
import uuid
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migration_engine_0011():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_11",
        password="mig_pass_11",
        dbname="test_migration_0011",
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


@pytest.fixture(scope="module")
def migrated(migration_engine_0011):
    _run_alembic("upgrade", "head")
    return migration_engine_0011


def _negocio(conn) -> uuid.UUID:
    negocio_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO negocio (id, nombre, created_at, updated_at) "
            "VALUES (:id, 'Test', now(), now())"
        ),
        {"id": negocio_id},
    )
    return negocio_id


def _cliente(conn, negocio_id) -> uuid.UUID:
    cliente_id = uuid.uuid4()
    conn.execute(
        text(
            "INSERT INTO cliente (id, negocio_id, nombre, nombre_normalizado, "
            "created_at, updated_at) VALUES (:id, :neg, 'X', :norm, now(), now())"
        ),
        {"id": cliente_id, "neg": negocio_id, "norm": f"x{uuid.uuid4().hex[:8]}"},
    )
    return cliente_id


class TestLaCadenaSigueCorriendo:
    def test_upgrade_head_completo(self, migration_engine_0011):
        _run_alembic("upgrade", "head")
        assert "cobro_cliente" in inspect(migration_engine_0011).get_table_names()

    def test_las_tablas_anteriores_siguen_ahi(self, migrated):
        tablas = set(inspect(migrated).get_table_names())
        assert {"usuario", "negocio", "cliente", "venta", "token_reset"} <= tablas


class TestSchema:
    def test_columnas(self, migrated):
        columnas = {c["name"] for c in inspect(migrated).get_columns("cobro_cliente")}
        assert columnas == {
            "id",
            "negocio_id",
            "cliente_id",
            "creado_por_usuario_id",
            "monto",
            "fecha",
            "metodo",
            "comprobante_url",
            "deleted_at",
            "created_at",
            "updated_at",
        }

    def test_sin_venta_id(self, migrated):
        """RN-CCC-03 — the invariant this table exists to protect."""
        columnas = {c["name"] for c in inspect(migrated).get_columns("cobro_cliente")}
        assert "venta_id" not in columnas

    def test_sin_columnas_derivadas(self, migrated):
        columnas = {c["name"] for c in inspect(migrated).get_columns("cobro_cliente")}
        assert "saldo" not in columnas
        assert "estado" not in columnas

    def test_indices_para_las_consultas_que_existen(self, migrated):
        indices = inspect(migrated).get_indexes("cobro_cliente")
        columnas = [tuple(i["column_names"]) for i in indices]

        assert ("negocio_id",) in columnas
        assert ("negocio_id", "cliente_id", "deleted_at") in columnas
        assert ("negocio_id", "fecha") in columnas

    def test_revision_pinneada_de_forma_explicita(self):
        """D-21: the migration module declares literal revision ids."""
        module_path = API_ROOT / "alembic" / "versions" / "20240011_0011_cobro_cliente.py"
        source = module_path.read_text(encoding="utf-8")
        assert 'revision = "0011"' in source
        assert 'down_revision = "0010"' in source


class TestRoundTrip:
    def test_downgrade_y_re_upgrade(self, migrated):
        with migrated.connect() as conn:
            clientes = conn.execute(text("SELECT count(*) FROM cliente")).scalar()

        _run_alembic("downgrade", "0010")

        inspector = inspect(migrated)
        assert "cobro_cliente" not in inspector.get_table_names()
        assert "cliente" in inspector.get_table_names()

        with migrated.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM cliente")).scalar() == clientes

        # The re-upgrade is where a duplicated CREATE TYPE would surface (D-56).
        _run_alembic("upgrade", "0011")
        assert "cobro_cliente" in inspect(migrated).get_table_names()

    def test_el_tipo_enum_se_limpia_al_bajar(self, migrated):
        _run_alembic("downgrade", "0010")

        with migrated.connect() as conn:
            existe = conn.execute(
                text("SELECT count(*) FROM pg_type WHERE typname = 'metodocobro'")
            ).scalar()
        assert existe == 0, "el downgrade dejo el tipo metodocobro colgado"

        _run_alembic("upgrade", "0011")


class TestPersistenciaBasica:
    def test_insertar_y_leer_cobro(self, migrated):
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            cliente_id = _cliente(conn, negocio_id)
            cobro_id = uuid.uuid4()
            conn.execute(
                text(
                    "INSERT INTO cobro_cliente (id, negocio_id, cliente_id, monto, "
                    "fecha, metodo, created_at, updated_at) VALUES "
                    "(:id, :neg, :cli, 250.00, :f, 'EFECTIVO', now(), now())"
                ),
                {"id": cobro_id, "neg": negocio_id, "cli": cliente_id, "f": date(2026, 1, 15)},
            )

        with migrated.connect() as conn:
            total = conn.execute(
                text("SELECT count(*) FROM cobro_cliente WHERE id = :id"),
                {"id": cobro_id},
            ).scalar()
        assert total == 1
