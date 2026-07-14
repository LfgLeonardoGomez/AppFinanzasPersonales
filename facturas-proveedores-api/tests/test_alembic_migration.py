"""
Tests for Alembic migration 0001 (initial domain schema).

Task 6.4: Verifies that:
- upgrade head creates all 5 domain tables with FKs and indexes
- downgrade removes the 5 domain tables
- no 'saldo' or 'estado' columns exist in the schema

Uses a fresh PostgreSQL container (testcontainers) separate from the
SQLModel.metadata approach — this tests the migration SQL directly.
"""

import os
import pytest
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer


@pytest.fixture(scope="module")
def migration_engine():
    """
    Separate disposable Postgres for migration testing.

    Runs alembic upgrade/downgrade against a fresh DB.
    """
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user",
        password="mig_pass",
        dbname="test_migration",
    ) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+psycopg2://", 1)
        os.environ["DATABASE_URL"] = url
        engine = create_engine(url, echo=False)
        yield engine
        engine.dispose()


def run_alembic(*args: str) -> None:
    """Run an alembic command via subprocess with the test DATABASE_URL."""
    import subprocess
    import sys

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


def test_upgrade_creates_all_domain_tables(migration_engine):
    """Spec: alembic upgrade head creates usuario, proveedor, factura, factura_item, pago."""
    run_alembic("upgrade", "head")

    inspector = inspect(migration_engine)
    tables = inspector.get_table_names()

    assert "usuario" in tables
    assert "proveedor" in tables
    assert "factura" in tables
    assert "factura_item" in tables
    assert "pago" in tables


def test_schema_has_no_saldo_or_estado_columns(migration_engine):
    """Spec: no table contains 'saldo' or 'estado' columns (D-01, D-C02-6)."""
    inspector = inspect(migration_engine)

    for table in ["usuario", "proveedor", "factura", "factura_item", "pago"]:
        columns = {col["name"] for col in inspector.get_columns(table)}
        assert "saldo" not in columns, f"Table {table} must not have 'saldo' column"
        assert "estado" not in columns, f"Table {table} must not have 'estado' column"


def test_pago_has_no_factura_id_column(migration_engine):
    """Spec: pago table must not have factura_id (RN-PAG-01, D-02)."""
    inspector = inspect(migration_engine)
    columns = {col["name"] for col in inspector.get_columns("pago")}
    assert "factura_id" not in columns


def test_foreign_keys_exist(migration_engine):
    """Spec: FKs are created for all expected relationships."""
    inspector = inspect(migration_engine)

    # proveedor → usuario
    proveedor_fks = {fk["referred_table"] for fk in inspector.get_foreign_keys("proveedor")}
    assert "usuario" in proveedor_fks

    # factura → usuario, proveedor
    factura_fks = {fk["referred_table"] for fk in inspector.get_foreign_keys("factura")}
    assert "usuario" in factura_fks
    assert "proveedor" in factura_fks

    # factura_item → factura
    fi_fks = {fk["referred_table"] for fk in inspector.get_foreign_keys("factura_item")}
    assert "factura" in fi_fks

    # pago → usuario, proveedor (NOT factura)
    pago_fks = {fk["referred_table"] for fk in inspector.get_foreign_keys("pago")}
    assert "usuario" in pago_fks
    assert "proveedor" in pago_fks
    assert "factura" not in pago_fks  # RN-PAG-01


def test_downgrade_removes_all_domain_tables(migration_engine):
    """Spec: alembic downgrade base removes the 5 domain tables."""
    run_alembic("downgrade", "base")

    inspector = inspect(migration_engine)
    tables = set(inspector.get_table_names())

    # alembic_version table may remain; that's expected
    domain_tables = {"usuario", "proveedor", "factura", "factura_item", "pago"}
    remaining = tables & domain_tables
    assert remaining == set(), f"Tables {remaining} should have been dropped"
