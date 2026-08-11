"""
Tests for Alembic migration 0008 — cliente (C-32).

Additive: one table, no backfill. The part that needs real proof is the
**partial** unique index. A plain unique index would pass a naive "is it
unique?" test and still be wrong: it would let a soft-deleted customer hold
its own name forever, so the shop could never re-add someone it had removed.

So the index is exercised against the database in both directions — it must
reject an active duplicate AND accept a name whose previous holder is deleted.

Revisions pinned ("0007", "0008") rather than head/-1, per D-21.
"""

import os
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from testcontainers.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migration_engine_0008():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_8",
        password="mig_pass_8",
        dbname="test_migration_0008",
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
def migrated(migration_engine_0008):
    _run_alembic("upgrade", "0008")
    return migration_engine_0008


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


def _insertar_cliente(conn, negocio_id, nombre, normalizado, borrado=False):
    conn.execute(
        text(
            "INSERT INTO cliente (id, negocio_id, nombre, nombre_normalizado, "
            "deleted_at, created_at, updated_at) "
            "VALUES (:id, :neg, :nom, :norm, :del, now(), now())"
        ),
        {
            "id": uuid.uuid4(),
            "neg": negocio_id,
            "nom": nombre,
            "norm": normalizado,
            "del": datetime(2026, 1, 1, tzinfo=timezone.utc) if borrado else None,
        },
    )


class TestSchema:
    def test_table_exists_with_its_columns(self, migrated):
        inspector = inspect(migrated)
        assert "cliente" in inspector.get_table_names()

        columnas = {c["name"] for c in inspector.get_columns("cliente")}
        assert columnas == {
            "id",
            "negocio_id",
            "creado_por_usuario_id",
            "nombre",
            "nombre_normalizado",
            "telefono",
            "notas",
            "deleted_at",
            "created_at",
            "updated_at",
        }

    def test_the_unique_index_is_partial(self, migrated):
        """The WHERE clause is the whole point — assert it is really there."""
        with migrated.connect() as conn:
            definicion = conn.execute(
                text(
                    "SELECT indexdef FROM pg_indexes "
                    "WHERE indexname = 'uq_cliente_negocio_nombre_normalizado_activo'"
                )
            ).scalar()

        assert definicion is not None, "no existe el índice único"
        assert "UNIQUE" in definicion.upper()
        assert "WHERE" in definicion.upper() and "deleted_at IS NULL" in definicion

    def test_no_derived_columns(self, migrated):
        inspector = inspect(migrated)
        columnas = {c["name"] for c in inspector.get_columns("cliente")}
        assert "saldo" not in columnas
        assert "estado" not in columnas


class TestElIndiceHaceLoQuePromete:
    def test_rechaza_un_duplicado_activo(self, migrated):
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            _insertar_cliente(conn, negocio_id, "Juan Pérez", "juan perez")

        with pytest.raises(IntegrityError):
            with migrated.begin() as conn:
                _insertar_cliente(conn, negocio_id, "juan perez", "juan perez")

    def test_acepta_el_nombre_de_uno_eliminado(self, migrated):
        """La mitad que un índice único común NO da."""
        with migrated.begin() as conn:
            negocio_id = _negocio(conn)
            _insertar_cliente(conn, negocio_id, "Se Fue", "se fue", borrado=True)

        # No debe levantar: el anterior está eliminado, así que liberó el nombre.
        with migrated.begin() as conn:
            _insertar_cliente(conn, negocio_id, "Se Fue", "se fue")

        with migrated.connect() as conn:
            total = conn.execute(
                text(
                    "SELECT count(*) FROM cliente "
                    "WHERE negocio_id = :neg AND nombre_normalizado = 'se fue'"
                ),
                {"neg": negocio_id},
            ).scalar()
        assert total == 2, "la fila eliminada debería seguir existiendo junto a la nueva"

    def test_la_unicidad_es_por_negocio(self, migrated):
        with migrated.begin() as conn:
            negocio_a = _negocio(conn)
            negocio_b = _negocio(conn)
            _insertar_cliente(conn, negocio_a, "Juan Pérez", "juan perez")
            _insertar_cliente(conn, negocio_b, "Juan Pérez", "juan perez")

        with migrated.connect() as conn:
            total = conn.execute(
                text("SELECT count(*) FROM cliente WHERE nombre_normalizado = 'juan perez'")
            ).scalar()
        assert total >= 2


class TestRoundTrip:
    def test_downgrade_removes_only_this_table(self, migrated):
        with migrated.connect() as conn:
            usuarios = conn.execute(text("SELECT count(*) FROM usuario")).scalar()

        _run_alembic("downgrade", "0007")

        inspector = inspect(migrated)
        assert "cliente" not in inspector.get_table_names()
        assert "invitacion_empleado" in inspector.get_table_names()
        assert "negocio" in inspector.get_table_names()

        with migrated.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM usuario")).scalar() == usuarios

        _run_alembic("upgrade", "0008")
        assert "cliente" in inspect(migrated).get_table_names()
