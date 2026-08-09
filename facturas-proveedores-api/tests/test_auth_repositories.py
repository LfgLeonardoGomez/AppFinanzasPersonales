"""
Tests for auth repositories (tasks 3.1 and 3.2).

TDD RED phase: covers UsuarioRepository extensions and RefreshTokenRepository.

Spec scenarios:
- usuario: create, get_by_id, get_by_email
- refresh_token: create, get_by_hash, revoke marks revoked_at
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401 — ensure all tables registered including RefreshToken

from tests.conftest import crear_negocio


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    # No drop_all — shared with other modules that use the same pg_container


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


def _unique_email() -> str:
    return f"user_{uuid.uuid4().hex[:8]}@test.com"


def _make_usuario(session: Session) -> "Usuario":  # type: ignore[name-defined]
    from app.models.usuario import Usuario
    from app.repositories.usuario_repository import UsuarioRepository
    repo = UsuarioRepository(session)
    u = repo.create(
        negocio_id=crear_negocio(session).id,
        email=_unique_email(),
        nombre="Test User",
        password_hash="$argon2id$fakehash",
    )
    return u


# ── Task 3.1: UsuarioRepository.create + get_by_id ────────────────────────────

class TestUsuarioRepository:
    """Spec: create, get_by_id, get_by_email."""

    def test_create_persists_usuario(self, session: Session):
        """Spec: create() persists and returns a Usuario with an ID."""
        from app.repositories.usuario_repository import UsuarioRepository
        repo = UsuarioRepository(session)
        u = repo.create(
            negocio_id=crear_negocio(session).id,
            email=_unique_email(),
            nombre="New User",
            password_hash="$argon2id$fakehash",
        )
        session.commit()
        assert u.id is not None
        assert u.email is not None

    def test_get_by_id_returns_correct_user(self, session: Session):
        """Spec: get_by_id returns the user matching the given id."""
        from app.repositories.usuario_repository import UsuarioRepository
        repo = UsuarioRepository(session)
        email = _unique_email()
        u = repo.create(negocio_id=crear_negocio(session).id, email=email, nombre="By ID", password_hash="hash")
        session.commit()

        fetched = repo.get_by_id(u.id)
        assert fetched is not None
        assert fetched.id == u.id
        assert fetched.email == email

    def test_get_by_id_returns_none_for_unknown(self, session: Session):
        """Edge case: get_by_id returns None for non-existent id."""
        from app.repositories.usuario_repository import UsuarioRepository
        repo = UsuarioRepository(session)
        result = repo.get_by_id(uuid.uuid4())
        assert result is None

    def test_get_by_email_returns_correct_user(self, session: Session):
        """Spec: get_by_email finds user by email."""
        from app.repositories.usuario_repository import UsuarioRepository
        repo = UsuarioRepository(session)
        email = _unique_email()
        u = repo.create(negocio_id=crear_negocio(session).id, email=email, nombre="By Email", password_hash="hash")
        session.commit()

        fetched = repo.get_by_email(email)
        assert fetched is not None
        assert fetched.id == u.id

    def test_get_by_email_returns_none_for_unknown(self, session: Session):
        """Edge case: get_by_email returns None for non-existent email."""
        from app.repositories.usuario_repository import UsuarioRepository
        repo = UsuarioRepository(session)
        result = repo.get_by_email("nobody@nowhere.test")
        assert result is None


# ── Task 3.2: RefreshTokenRepository ──────────────────────────────────────────

class TestRefreshTokenRepository:
    """Spec: create, get_by_hash, revoke."""

    def test_create_persists_refresh_token(self, session: Session):
        """Spec: create() persists a RefreshToken row with token_hash."""
        from app.repositories.refresh_token_repository import RefreshTokenRepository
        from app.core.security import create_refresh_token

        u = _make_usuario(session)
        session.commit()

        repo = RefreshTokenRepository(session)
        _, token_hash = create_refresh_token()
        expires = datetime.now(timezone.utc) + timedelta(days=30)

        rt = repo.create(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=expires,
        )
        session.commit()

        assert rt.id is not None
        assert rt.token_hash == token_hash
        assert rt.revoked_at is None

    def test_get_by_hash_returns_matching_row(self, session: Session):
        """Spec: get_by_hash retrieves the row by its hash."""
        from app.repositories.refresh_token_repository import RefreshTokenRepository
        from app.core.security import create_refresh_token

        u = _make_usuario(session)
        session.commit()

        repo = RefreshTokenRepository(session)
        _, token_hash = create_refresh_token()
        rt = repo.create(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        session.commit()

        found = repo.get_by_hash(token_hash)
        assert found is not None
        assert found.id == rt.id

    def test_get_by_hash_returns_none_for_unknown(self, session: Session):
        """Edge case: get_by_hash returns None for non-existent hash."""
        from app.repositories.refresh_token_repository import RefreshTokenRepository
        repo = RefreshTokenRepository(session)
        result = repo.get_by_hash("nonexistent_hash_value")
        assert result is None

    def test_revoke_marks_revoked_at(self, session: Session):
        """Spec: revoke() sets revoked_at on the token row."""
        from app.repositories.refresh_token_repository import RefreshTokenRepository
        from app.core.security import create_refresh_token

        u = _make_usuario(session)
        session.commit()

        repo = RefreshTokenRepository(session)
        _, token_hash = create_refresh_token()
        rt = repo.create(
            usuario_id=u.id,
            token_hash=token_hash,
            expires_at=datetime.now(timezone.utc) + timedelta(days=30),
        )
        session.commit()

        assert rt.revoked_at is None

        repo.revoke(rt.id)
        session.commit()
        session.refresh(rt)

        assert rt.revoked_at is not None

    def test_revoke_nonexistent_is_noop(self, session: Session):
        """Edge case: revoke on non-existent ID does not raise."""
        from app.repositories.refresh_token_repository import RefreshTokenRepository
        repo = RefreshTokenRepository(session)
        # Should not raise
        repo.revoke(uuid.uuid4())
        session.commit()
