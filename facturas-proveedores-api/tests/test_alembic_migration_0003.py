"""
Tests for Alembic migration 0003 (proveedor nombre index).

Task 5.1 — TDD RED, then GREEN.

Verifies:
- upgrade head chains 0001→0002→0003 cleanly
- head is '0003' after upgrade
- index (usuario_id, lower(nombre)) exists on proveedor table
- no saldo/estado column in proveedor
- downgrade drops the index and returns to 0002 state
"""

import os
import subprocess
import sys

import pytest
from sqlalchemy import create_engine, inspect, text
from testcontainers.postgres import PostgresContainer


def _migration_engine_0003_impl():
    """Separate disposable Postgres for 0003 migration testing.

    C-16 (D-4): snapshot os.environ["DATABASE_URL"] on enter, restore on
    teardown (pop if it was unset, set the original otherwise). Mirrors the
    pattern in tests/conftest.py::env_vars.

    C-25: separated from the `@pytest.fixture` decorator so a test can drive
    setup and teardown directly and actually observe the restore. See
    `test_database_url_restored_after_teardown` below.
    """
    original_db_url = os.environ.get("DATABASE_URL")
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user_3",
        password="mig_pass_3",
        dbname="test_migration_0003",
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


@pytest.fixture(scope="module")
def migration_engine_0003():
    yield from _migration_engine_0003_impl()


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


def test_upgrade_chains_to_0003(migration_engine_0003):
    """Spec: alembic upgrade to 0003 from base produces head = 0003.

    C-16 (D-4): the test targets the specific revision `0003` instead of
    `head` so it stays deterministic as the chain grows past 0005.
    """
    _run_alembic("upgrade", "0003")

    # Verify the current head via alembic current output
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "current"],
        cwd="C:/Users/pocho/Desktop/ProyectosPersonales/AppFinazasPPersonales/facturas-proveedores-api",
        capture_output=True,
        text=True,
        env=os.environ,
    )
    assert "0003" in result.stdout or "0003" in result.stderr, (
        f"Expected head 0003, got: {result.stdout} {result.stderr}"
    )


def test_index_on_usuario_nombre_lower_exists(migration_engine_0003):
    """Spec: after upgrade, composite index (usuario_id, lower(nombre)) exists on proveedor."""
    inspector = inspect(migration_engine_0003)
    indexes = inspector.get_indexes("proveedor")
    index_names = {idx["name"] for idx in indexes}
    assert "ix_proveedor_usuario_nombre_lower" in index_names, (
        f"Expected 'ix_proveedor_usuario_nombre_lower' in {index_names}"
    )


def test_no_saldo_or_estado_column_after_migration(migration_engine_0003):
    """Spec: migration 0003 must NOT add saldo or estado columns to proveedor."""
    inspector = inspect(migration_engine_0003)
    columns = {col["name"] for col in inspector.get_columns("proveedor")}
    assert "saldo" not in columns, "proveedor must NOT have a 'saldo' column"
    assert "estado" not in columns, "proveedor must NOT have an 'estado' column"


def test_downgrade_drops_index(migration_engine_0003):
    """Spec: downgrade from 0003 drops the nombre index and returns to 0002 state."""
    # First check index exists (from previous test)
    inspector = inspect(migration_engine_0003)
    pre_indexes = {idx["name"] for idx in inspector.get_indexes("proveedor")}
    assert "ix_proveedor_usuario_nombre_lower" in pre_indexes

    # Downgrade to 0002 (one step back from 0003)
    _run_alembic("downgrade", "0002")

    # Index must be gone
    inspector2 = inspect(migration_engine_0003)
    post_indexes = {idx["name"] for idx in inspector2.get_indexes("proveedor")}
    assert "ix_proveedor_usuario_nombre_lower" not in post_indexes, (
        "Index should be removed after downgrade"
    )

    # Head must now be 0002
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "current"],
        cwd="C:/Users/pocho/Desktop/ProyectosPersonales/AppFinazasPPersonales/facturas-proveedores-api",
        capture_output=True,
        text=True,
        env=os.environ,
    )
    assert "0002" in result.stdout or "0002" in result.stderr, (
        f"Expected head 0002 after downgrade, got: {result.stdout} {result.stderr}"
    )


def test_re_upgrade_restores_index(migration_engine_0003):
    """Spec: alembic upgrade to 0003 after downgrade restores the index (round-trip).

    C-16 (D-4): explicit revision `0003` so the test is chain-length independent.
    """
    _run_alembic("upgrade", "0003")

    inspector = inspect(migration_engine_0003)
    indexes = {idx["name"] for idx in inspector.get_indexes("proveedor")}
    assert "ix_proveedor_usuario_nombre_lower" in indexes


def test_database_url_restored_after_teardown(monkeypatch):
    """C-25 regression: driving `_migration_engine_0003_impl()`'s setup and
    then its teardown MUST restore `os.environ["DATABASE_URL"]`.

    This REPLACES a test that could never fail. The previous version read
    `DATABASE_URL` twice in a row with nothing in between and asserted the two
    reads were equal — trivially true whether or not the fixture restored
    anything. Verified during c-25: with the restore lines deleted, the old
    test still passed 6/6. Its docstring described a mechanism the body did
    not implement.

    Driving the generator directly is what makes the assertion real:
    - after `next(gen)` (setup) DATABASE_URL MUST have changed to the
      throwaway container's DSN — this is the premise check, so the test
      cannot pass by the fixture doing nothing at all;
    - after the generator is exhausted (teardown) it MUST be back to the
      sentinel set below.

    Mirrors the same test in test_alembic_migration.py / _0004 / _0005.
    """
    monkeypatch.setenv("DATABASE_URL", "sentinel-original-value")

    gen = _migration_engine_0003_impl()
    next(gen)  # setup: enters PostgresContainer, mutates DATABASE_URL
    assert os.environ["DATABASE_URL"] != "sentinel-original-value", (
        "fixture setup did not mutate DATABASE_URL — test premise broken"
    )

    with pytest.raises(StopIteration):
        next(gen)  # teardown: disposes engine, exits container, restores env

    assert os.environ["DATABASE_URL"] == "sentinel-original-value", (
        "DATABASE_URL was not restored on teardown — this leaks a dead DSN "
        "into every test that runs afterwards (the c-17 failure mode)"
    )
