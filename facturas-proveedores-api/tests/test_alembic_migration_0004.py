"""
Tests for Alembic migration 0004 (factura composite index for FIFO queries).

Task 5.1 — TDD RED, then GREEN.

Verifies:
- upgrade head chains 0001→...→0004 cleanly
- head is '0004' after upgrade
- composite index (usuario_id, proveedor_id, deleted_at, fecha_emision) exists on factura
- NO estado or saldo column added to factura (critical invariant, D-01)
- downgrade drops the index and returns to 0003 state
- re-upgrade restores the index (idempotency round-trip)
"""

import os
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, inspect
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="module")
def migration_engine_0004():
    """Separate disposable Postgres for 0004 migration testing."""
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_4",
        password="mig_pass_4",
        dbname="test_migration_0004",
    ) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+psycopg2://", 1)
        os.environ["DATABASE_URL"] = url
        engine = create_engine(url, echo=False)
        yield engine
        engine.dispose()


def _run_alembic(*args: str) -> None:
    """Run an alembic command via subprocess with the test DATABASE_URL."""
    result = subprocess.run(
        [sys.executable, "-m", "alembic"] + list(args),
        cwd="C:/Users/pocho/Desktop/ProyectosPersonales/AppFinazasPPersonales/facturas-proveedores-api",
        capture_output=True,
        text=True,
        env=os.environ,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic {' '.join(args)} failed:\n{result.stdout}\n{result.stderr}"
        )


def test_upgrade_chains_to_0004(migration_engine_0004):
    """
    Spec: alembic upgrade head chains through 0004 cleanly.
    (After C-10's migration 0005, the head is 0005 — this test verifies
    that 0004 is still part of the chain, NOT the final head. The C-10
    dedicated test_alembic_migration_0005.py asserts head=0005.)
    """
    _run_alembic("upgrade", "head")

    result = subprocess.run(
        [sys.executable, "-m", "alembic", "current"],
        cwd="C:/Users/pocho/Desktop/ProyectosPersonales/AppFinazasPPersonales/facturas-proveedores-api",
        capture_output=True,
        text=True,
        env=os.environ,
    )
    # 0004 is part of the chain; the final head is 0005 (C-10).
    assert "0005" in result.stdout or "0005" in result.stderr, (
        f"Expected head 0005 (chain includes 0004), got: {result.stdout} {result.stderr}"
    )


def test_composite_index_on_factura_exists(migration_engine_0004):
    """Spec: after upgrade, ix_factura_usuario_deleted_emision exists on factura."""
    inspector = inspect(migration_engine_0004)
    indexes = inspector.get_indexes("factura")
    index_names = {idx["name"] for idx in indexes}
    assert "ix_factura_usuario_deleted_emision" in index_names, (
        f"Expected FIFO index on factura, got indexes: {index_names}"
    )


def test_no_estado_or_saldo_column_added(migration_engine_0004):
    """
    CRITICAL: migration 0004 must NOT add estado or saldo columns to factura.
    These are computed on-demand, never persisted (D-01, RN-FIFO).
    """
    inspector = inspect(migration_engine_0004)
    columns = {col["name"] for col in inspector.get_columns("factura")}
    assert "estado" not in columns, "factura MUST NOT have an 'estado' column"
    assert "saldo" not in columns, "factura MUST NOT have a 'saldo' column"


def test_downgrade_drops_index(migration_engine_0004):
    """
    Spec: downgrade from current head past 0004 drops the 0004 FIFO index
    and returns to 0003 state. (After C-10 added 0005, the chain is
    0001→...→0005; we explicitly downgrade to 0003 to validate that the
    0004 migration's downgrade is reversible.)
    """
    # Verify index exists first (chain is at head 0005)
    inspector = inspect(migration_engine_0004)
    pre_indexes = {idx["name"] for idx in inspector.get_indexes("factura")}
    assert "ix_factura_usuario_deleted_emision" in pre_indexes

    # Explicit downgrade to 0003 — tests that 0004's downgrade is reversible
    # (downgrade -1 from 0005 would only drop 0005, not 0004).
    _run_alembic("downgrade", "0003")

    inspector2 = inspect(migration_engine_0004)
    post_indexes = {idx["name"] for idx in inspector2.get_indexes("factura")}
    assert "ix_factura_usuario_deleted_emision" not in post_indexes, (
        "FIFO index should be removed after downgrade past 0004"
    )

    # Head should be back to 0003
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "current"],
        cwd="C:/Users/pocho/Desktop/ProyectosPersonales/AppFinazasPPersonales/facturas-proveedores-api",
        capture_output=True,
        text=True,
        env=os.environ,
    )
    assert "0003" in result.stdout or "0003" in result.stderr, (
        f"Expected head 0003 after explicit downgrade, got: {result.stdout} {result.stderr}"
    )


def test_re_upgrade_restores_index(migration_engine_0004):
    """Spec: upgrade head after downgrade restores the FIFO index (round-trip)."""
    _run_alembic("upgrade", "head")

    inspector = inspect(migration_engine_0004)
    indexes = {idx["name"] for idx in inspector.get_indexes("factura")}
    assert "ix_factura_usuario_deleted_emision" in indexes
