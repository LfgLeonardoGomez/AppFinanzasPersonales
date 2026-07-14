"""
Tests for Alembic migration 0005 (pago composite index for FIFO pool queries).

Task 4.1 — TDD RED, then GREEN.

Verifies:
- upgrade head chains 0001→...→0005 cleanly
- head is '0005' after upgrade
- composite index (usuario_id, proveedor_id, deleted_at, fecha) exists on pago
- NO estado, saldo, or factura_id column added to pago (CRITICAL invariants)
- downgrade drops the index and returns to 0004 state
- re-upgrade restores the index (idempotency round-trip)
"""

import os
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, inspect
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="module")
def migration_engine_0005():
    """Separate disposable Postgres for 0005 migration testing."""
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_5",
        password="mig_pass_5",
        dbname="test_migration_0005",
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


def _alembic_current() -> str:
    """Return the current alembic head as a string."""
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "current"],
        cwd="C:/Users/pocho/Desktop/ProyectosPersonales/AppFinazasPPersonales/facturas-proveedores-api",
        capture_output=True,
        text=True,
        env=os.environ,
    )
    return result.stdout + result.stderr


def test_upgrade_chains_to_0005(migration_engine_0005):
    """Spec: alembic upgrade head from base produces head = 0005."""
    _run_alembic("upgrade", "head")
    assert "0005" in _alembic_current(), f"Expected head 0005, got: {_alembic_current()}"


def test_composite_index_on_pago_exists(migration_engine_0005):
    """Spec: after upgrade, ix_pago_usuario_proveedor_deleted_fecha exists on pago."""
    inspector = inspect(migration_engine_0005)
    indexes = inspector.get_indexes("pago")
    index_names = {idx["name"] for idx in indexes}
    assert "ix_pago_usuario_proveedor_deleted_fecha" in index_names, (
        f"Expected FIFO pool index on pago, got indexes: {index_names}"
    )


def test_composite_index_column_order(migration_engine_0005):
    """Spec: index columns in order (usuario_id, proveedor_id, deleted_at, fecha)
    for the C-08/C-10 FIFO pool query (WHERE usuario_id=? AND proveedor_id=?
    AND deleted_at IS NULL ORDER BY fecha)."""
    inspector = inspect(migration_engine_0005)
    indexes = inspector.get_indexes("pago")
    idx = next(
        (i for i in indexes if i["name"] == "ix_pago_usuario_proveedor_deleted_fecha"),
        None,
    )
    assert idx is not None, "Index ix_pago_usuario_proveedor_deleted_fecha not found"
    # column_names preserves definition order in SQLAlchemy's inspector
    assert idx["column_names"] == ["usuario_id", "proveedor_id", "deleted_at", fecha_key()], (
        f"Expected column order [usuario_id, proveedor_id, deleted_at, fecha], "
        f"got {idx['column_names']}"
    )


def fecha_key():
    """The pago table's fecha column name (parameterised for readability)."""
    return "fecha"


def test_no_estado_or_saldo_column_added(migration_engine_0005):
    """
    CRITICAL: migration 0005 must NOT add estado, saldo, or factura_id columns
    to pago. These are computed on-demand or never exist (D-01, RN-SALDO,
    RN-PAG-01). pago must remain a flat record with no derived state.
    """
    inspector = inspect(migration_engine_0005)
    columns = {col["name"] for col in inspector.get_columns("pago")}
    for forbidden in ("estado", "saldo", "factura_id"):
        assert forbidden not in columns, (
            f"pago MUST NOT have a '{forbidden}' column (RN-PAG-01 / D-01 / RN-SALDO)"
        )


def test_downgrade_drops_index(migration_engine_0005):
    """Spec: downgrade from 0005 drops the FIFO pool index and returns to 0004 state."""
    # Verify index exists first
    inspector = inspect(migration_engine_0005)
    pre_indexes = {idx["name"] for idx in inspector.get_indexes("pago")}
    assert "ix_pago_usuario_proveedor_deleted_fecha" in pre_indexes

    _run_alembic("downgrade", "-1")

    inspector2 = inspect(migration_engine_0005)
    post_indexes = {idx["name"] for idx in inspector2.get_indexes("pago")}
    assert "ix_pago_usuario_proveedor_deleted_fecha" not in post_indexes, (
        "FIFO pool index should be removed after downgrade"
    )

    assert "0004" in _alembic_current(), (
        f"Expected head 0004 after downgrade, got: {_alembic_current()}"
    )


def test_re_upgrade_restores_index(migration_engine_0005):
    """Spec: upgrade head after downgrade restores the FIFO pool index (round-trip)."""
    _run_alembic("upgrade", "head")

    inspector = inspect(migration_engine_0005)
    indexes = {idx["name"] for idx in inspector.get_indexes("pago")}
    assert "ix_pago_usuario_proveedor_deleted_fecha" in indexes


def test_pago_table_columns_match_0001_baseline(migration_engine_0005):
    """
    The pago table's columns must be exactly what migration 0001 created.
    No drift allowed (RN-PAG-01, D-01).
    """
    inspector = inspect(migration_engine_0005)
    columns = {col["name"] for col in inspector.get_columns("pago")}
    expected = {
        "id",
        "usuario_id",
        "proveedor_id",
        "monto",
        "fecha",
        "metodo",
        "comprobante_url",
        "origen",
        "created_at",
        "updated_at",
        "deleted_at",
    }
    assert columns == expected, (
        f"pago columns drifted from 0001 baseline.\n"
        f"Expected: {expected}\nGot: {columns}"
    )
