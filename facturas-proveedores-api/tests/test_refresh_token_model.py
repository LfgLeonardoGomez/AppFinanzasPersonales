"""
Tests for RefreshToken model and Alembic migration 002.

TDD RED phase for tasks 2.1, 2.2, 2.3.

Spec scenarios covered:
- migration 002 creates refresh_token table
- migration 002 is reversible (downgrade removes only refresh_token)
- only hash is stored; token with revoked_at is invalid
"""

import os
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlmodel import Session, SQLModel
from testcontainers.postgres import PostgresContainer


# ── Fixture: isolated Postgres for migration testing ─────────────────────────

@pytest.fixture(scope="module")
def migration_engine_002():
    """Separate disposable Postgres for migration 001+002 testing."""
    with PostgresContainer(
        image="postgres:15-alpine",
        username="mig_user",
        password="mig_pass",
        dbname="test_migration_002",
    ) as pg:
        url = pg.get_connection_url().replace("postgresql://", "postgresql+psycopg2://", 1)
        os.environ["DATABASE_URL"] = url
        engine = create_engine(url, echo=False)
        yield engine
        engine.dispose()


def run_alembic(*args: str) -> None:
    """Run alembic command via subprocess using current DATABASE_URL."""
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


# ── Task 2.2 / 2.3: Migration tests ──────────────────────────────────────────

def test_upgrade_002_creates_refresh_token_table(migration_engine_002):
    """Spec: alembic upgrade head creates refresh_token table."""
    run_alembic("upgrade", "head")
    inspector = inspect(migration_engine_002)
    tables = inspector.get_table_names()
    assert "refresh_token" in tables


def test_refresh_token_has_required_columns(migration_engine_002):
    """Spec: refresh_token has usuario_id, token_hash, expires_at, revoked_at."""
    inspector = inspect(migration_engine_002)
    columns = {col["name"] for col in inspector.get_columns("refresh_token")}
    assert "id" in columns
    assert "usuario_id" in columns
    assert "token_hash" in columns
    assert "expires_at" in columns
    assert "revoked_at" in columns
    assert "created_at" in columns
    assert "updated_at" in columns


def test_refresh_token_has_no_raw_token_column(migration_engine_002):
    """Spec: no raw token column — only hash is stored."""
    inspector = inspect(migration_engine_002)
    columns = {col["name"] for col in inspector.get_columns("refresh_token")}
    # There must NOT be a column that could store raw token
    assert "token" not in columns
    assert "raw_token" not in columns
    assert "value" not in columns


def test_refresh_token_fk_to_usuario(migration_engine_002):
    """Spec: refresh_token.usuario_id has FK to usuario."""
    inspector = inspect(migration_engine_002)
    fks = {fk["referred_table"] for fk in inspector.get_foreign_keys("refresh_token")}
    assert "usuario" in fks


def test_token_hash_index_exists(migration_engine_002):
    """Spec: token_hash is indexed for efficient lookup."""
    inspector = inspect(migration_engine_002)
    indexes = inspector.get_indexes("refresh_token")
    indexed_cols = {col for idx in indexes for col in idx["column_names"]}
    assert "token_hash" in indexed_cols


def test_downgrade_002_removes_only_refresh_token(migration_engine_002):
    """Spec: downgrade 002 removes refresh_token but leaves C-02 tables intact."""
    run_alembic("downgrade", "0001")
    inspector = inspect(migration_engine_002)
    tables = set(inspector.get_table_names())
    assert "refresh_token" not in tables
    # C-02 tables must still exist
    for tbl in ["usuario", "proveedor", "factura", "factura_item", "pago"]:
        assert tbl in tables, f"C-02 table '{tbl}' should not be dropped by downgrade 002"


# ── Task 2.1 / 2.3: Model tests (via SQLModel metadata) ──────────────────────

@pytest.fixture(scope="module")
def model_engine(db_url: str):
    """
    Engine for model-level tests using the session-scoped Postgres.
    Creates all tables via SQLModel metadata (not alembic).
    """
    import app.models  # noqa: F401 — ensure all tables registered
    from app.models.refresh_token import RefreshToken  # noqa: F401

    engine = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(engine)
    yield engine


@pytest.fixture
def db_session(model_engine):
    with Session(model_engine) as s:
        yield s
        s.rollback()


def _make_usuario(session: Session) -> "Usuario":  # type: ignore[name-defined]
    from app.models.usuario import Usuario
    u = Usuario(
        email=f"rt_{uuid.uuid4().hex[:6]}@test.com",
        nombre="Test User",
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehash",
    )
    session.add(u)
    session.flush()
    return u


class TestRefreshTokenModel:
    """Spec: RefreshToken model correctness."""

    def test_create_refresh_token_row(self, db_session: Session):
        """Spec: can create a RefreshToken row with all required fields."""
        from app.models.refresh_token import RefreshToken
        from app.core.security import create_refresh_token

        u = _make_usuario(db_session)
        raw, token_hash = create_refresh_token()
        expires = datetime.now(timezone.utc) + timedelta(days=30)

        rt = RefreshToken(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=expires,
        )
        db_session.add(rt)
        db_session.flush()

        assert rt.id is not None
        assert rt.token_hash == token_hash
        assert rt.revoked_at is None

    def test_only_hash_stored_not_raw(self, db_session: Session):
        """Spec: token_hash ≠ raw token value."""
        from app.models.refresh_token import RefreshToken
        from app.core.security import create_refresh_token

        u = _make_usuario(db_session)
        raw, token_hash = create_refresh_token()
        expires = datetime.now(timezone.utc) + timedelta(days=30)

        rt = RefreshToken(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=expires,
        )
        db_session.add(rt)
        db_session.flush()
        db_session.refresh(rt)

        assert rt.token_hash != raw
        assert rt.token_hash == token_hash

    def test_revoked_at_null_means_active(self, db_session: Session):
        """Spec: revoked_at IS NULL → token is active."""
        from app.models.refresh_token import RefreshToken
        from app.core.security import create_refresh_token

        u = _make_usuario(db_session)
        _, token_hash = create_refresh_token()
        rt = RefreshToken(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        db_session.add(rt)
        db_session.flush()

        assert rt.revoked_at is None  # active

    def test_revoked_token_not_valid(self, db_session: Session):
        """Spec: token with revoked_at populated is not valid for session renewal."""
        from app.models.refresh_token import RefreshToken
        from app.core.security import create_refresh_token

        u = _make_usuario(db_session)
        _, token_hash = create_refresh_token()
        rt = RefreshToken(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
            revoked_at=datetime.now(timezone.utc),  # revoked
        )
        db_session.add(rt)
        db_session.flush()

        # Validity rule: revoked_at IS NULL AND expires_at > now()
        now = datetime.now(timezone.utc)
        is_valid = (rt.revoked_at is None) and (rt.expires_at > now)
        assert is_valid is False
