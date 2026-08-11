"""
Tests for Alembic migration 0007 — invitacion_empleado (C-29).

Additive and low-risk compared to 0006: one new table, nothing backfilled,
no existing column altered. The round trip still gets exercised, because a
downgrade nobody runs is a downgrade nobody can trust.

Revisions are pinned ("0006", "0007") rather than head/-1, per D-21.
"""

import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer

API_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migration_engine_0007():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_7",
        password="mig_pass_7",
        dbname="test_migration_0007",
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
def migrated(migration_engine_0007):
    _run_alembic("upgrade", "0007")
    return migration_engine_0007


class TestSchema:
    def test_table_exists_with_its_columns(self, migrated):
        inspector = inspect(migrated)
        assert "invitacion_empleado" in inspector.get_table_names()

        columnas = {c["name"] for c in inspector.get_columns("invitacion_empleado")}
        assert columnas == {
            "id",
            "negocio_id",
            "codigo_hash",
            "creado_por_usuario_id",
            "expira_en",
            "usado_en",
            "created_at",
            "updated_at",
        }

    def test_codigo_hash_is_unique(self, migrated):
        inspector = inspect(migrated)
        indices = inspector.get_indexes("invitacion_empleado")
        unicos = [i for i in indices if i["unique"] and i["column_names"] == ["codigo_hash"]]
        assert unicos, "codigo_hash debe tener índice único"

    def test_no_raw_code_column(self, migrated):
        """Only the hash is ever stored (D-17 criterion)."""
        inspector = inspect(migrated)
        columnas = {c["name"] for c in inspector.get_columns("invitacion_empleado")}
        assert "codigo" not in columnas

    def test_usado_en_is_nullable(self, migrated):
        inspector = inspect(migrated)
        columna = next(
            c for c in inspector.get_columns("invitacion_empleado") if c["name"] == "usado_en"
        )
        assert columna["nullable"] is True

    def test_existing_tables_untouched(self, migrated):
        """0007 is additive: it must not have altered the C-28 schema."""
        inspector = inspect(migrated)
        usuario = {c["name"] for c in inspector.get_columns("usuario")}
        assert "desactivado" in usuario
        assert "deleted_at" not in usuario

        for tabla in ("proveedor", "factura", "pago"):
            columnas = {c["name"] for c in inspector.get_columns(tabla)}
            assert "negocio_id" in columnas
            assert "saldo" not in columnas
            assert "estado" not in columnas


class TestRoundTrip:
    def test_downgrade_removes_only_this_table(self, migrated):
        with migrated.connect() as conn:
            usuarios_antes = conn.execute(text("SELECT count(*) FROM usuario")).scalar()

        _run_alembic("downgrade", "0006")

        inspector = inspect(migrated)
        assert "invitacion_empleado" not in inspector.get_table_names()
        assert "negocio" in inspector.get_table_names()

        with migrated.connect() as conn:
            usuarios_despues = conn.execute(text("SELECT count(*) FROM usuario")).scalar()
        assert usuarios_despues == usuarios_antes

        _run_alembic("upgrade", "0007")
        assert "invitacion_empleado" in inspect(migrated).get_table_names()
