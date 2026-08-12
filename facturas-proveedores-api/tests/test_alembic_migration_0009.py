"""
Tests for Alembic migration 0009 — token_reset (C-31).

Additive and low-risk: one table, no backfill. Revision number was reserved
back in C-32 (D-46) so two parallel changes would not both claim 0009.

Revisions pinned ("0008", "0009") rather than head/-1, per D-21.
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
def migration_engine_0009():
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_9",
        password="mig_pass_9",
        dbname="test_migration_0009",
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
def migrated(migration_engine_0009):
    _run_alembic("upgrade", "0009")
    return migration_engine_0009


class TestSchema:
    def test_table_exists_with_its_columns(self, migrated):
        inspector = inspect(migrated)
        assert "token_reset" in inspector.get_table_names()

        columnas = {c["name"] for c in inspector.get_columns("token_reset")}
        assert columnas == {
            "id",
            "usuario_id",
            "token_hash",
            "expira_en",
            "usado_en",
            "created_at",
            "updated_at",
        }

    def test_token_hash_is_unique(self, migrated):
        inspector = inspect(migrated)
        indices = inspector.get_indexes("token_reset")
        assert any(
            i["unique"] and i["column_names"] == ["token_hash"] for i in indices
        ), "token_hash debe tener índice único"

    def test_no_raw_token_column(self, migrated):
        """Only the hash is ever stored — the same rule as refresh_token."""
        inspector = inspect(migrated)
        columnas = {c["name"] for c in inspector.get_columns("token_reset")}
        assert "token" not in columnas

    def test_usado_en_is_nullable(self, migrated):
        inspector = inspect(migrated)
        columna = next(
            c for c in inspector.get_columns("token_reset") if c["name"] == "usado_en"
        )
        assert columna["nullable"] is True

    def test_previous_tables_untouched(self, migrated):
        """0009 is additive: the C-28/C-29/C-32 schema must be intact."""
        inspector = inspect(migrated)
        tablas = set(inspector.get_table_names())
        assert {"negocio", "invitacion_empleado", "cliente"} <= tablas

        usuario = {c["name"] for c in inspector.get_columns("usuario")}
        assert "desactivado" in usuario
        assert "deleted_at" not in usuario


class TestRoundTrip:
    def test_downgrade_removes_only_this_table(self, migrated):
        with migrated.connect() as conn:
            usuarios = conn.execute(text("SELECT count(*) FROM usuario")).scalar()

        _run_alembic("downgrade", "0008")

        inspector = inspect(migrated)
        assert "token_reset" not in inspector.get_table_names()
        assert "cliente" in inspector.get_table_names()

        with migrated.connect() as conn:
            assert conn.execute(text("SELECT count(*) FROM usuario")).scalar() == usuarios

        _run_alembic("upgrade", "0009")
        assert "token_reset" in inspect(migrated).get_table_names()
