"""
Tests for UsuarioService (tasks 5.1–5.5).

TDD RED phase. Covers:
- registrar: success + duplicate email
- login: success, wrong password, non-existent email (same generic message)
- logout: revokes refresh token
- refresh: rotates (old token invalidated, new one works)

Uses real Postgres via testcontainers (session-scoped fixture from conftest).
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


def _unique_email() -> str:
    return f"svc_{uuid.uuid4().hex[:8]}@test.com"


# ── Task 5.1: registrar ───────────────────────────────────────────────────────

class TestRegistrar:
    """Spec: registro exitoso + email duplicado."""

    def test_registrar_success(self, session: Session):
        """Spec: register stores user with hashed password."""
        from app.services.usuario_service import UsuarioService

        svc = UsuarioService(session)
        email = _unique_email()
        usuario = svc.registrar(email=email, nombre="Test User", password="password123")
        session.commit()

        assert usuario.id is not None
        assert usuario.email == email
        assert usuario.password_hash != "password123"  # must be hashed
        assert usuario.password_hash.startswith("$argon2")

    def test_registrar_duplicate_email_raises(self, session: Session):
        """Spec: duplicate email → HTTPException (409 or 400)."""
        from app.services.usuario_service import UsuarioService
        from fastapi import HTTPException

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="User 1", password="password123")
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.registrar(email=email, nombre="User 2", password="password456")
        # Should NOT be 401 (that's for auth failures); 409/400 for conflict
        assert exc_info.value.status_code in (400, 409)
        assert "email" in exc_info.value.detail.lower()


# ── Task 5.2: login ────────────────────────────────────────────────────────────

class TestLogin:
    """Spec: login emits tokens; generic error on failure."""

    def test_login_success_returns_tokens(self, session: Session):
        """Spec: login with correct credentials returns access + refresh tokens."""
        from app.services.usuario_service import UsuarioService

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="Login User", password="mypassword")
        session.commit()

        access_token, refresh_token, usuario = svc.login(email=email, password="mypassword")
        session.commit()

        assert access_token is not None
        assert refresh_token is not None
        assert len(refresh_token) > 20  # opaque, URL-safe string
        assert usuario.email == email

    def test_login_wrong_password_generic_error(self, session: Session):
        """Spec: wrong password → generic 401, same message as missing email."""
        from app.services.usuario_service import UsuarioService
        from fastapi import HTTPException

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="PW Fail", password="correctpassword")
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            svc.login(email=email, password="wrongpassword")
        assert exc_info.value.status_code == 401

    def test_login_nonexistent_email_generic_error(self, session: Session):
        """Spec: non-existent email → same generic 401 message as wrong password."""
        from app.services.usuario_service import UsuarioService
        from fastapi import HTTPException

        svc = UsuarioService(session)

        with pytest.raises(HTTPException) as exc_info:
            svc.login(email="nobody@nowhere.test", password="anypassword")
        assert exc_info.value.status_code == 401

    def test_login_errors_have_identical_messages(self, session: Session):
        """Spec: wrong password and non-existent email produce identical error detail."""
        from app.services.usuario_service import UsuarioService
        from fastapi import HTTPException

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="Timing", password="correctpassword")
        session.commit()

        # Wrong password
        try:
            svc.login(email=email, password="wrongpassword")
        except HTTPException as e:
            wrong_pw_msg = e.detail

        # Non-existent email
        try:
            svc.login(email="nobody@nowhereatall.test", password="anypassword")
        except HTTPException as e:
            no_email_msg = e.detail

        assert wrong_pw_msg == no_email_msg

    def test_login_persists_refresh_token_hash(self, session: Session):
        """Spec: refresh token is stored as hash; raw value not in DB."""
        from app.services.usuario_service import UsuarioService
        from app.models.refresh_token import RefreshToken
        from sqlmodel import select

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="Hash Check", password="mypassword")
        session.commit()

        _, raw_refresh, usuario = svc.login(email=email, password="mypassword")
        session.commit()

        # Find the persisted token
        stmt = select(RefreshToken).where(RefreshToken.usuario_id == usuario.id)
        rt = session.exec(stmt).first()
        assert rt is not None
        assert rt.token_hash != raw_refresh  # hash ≠ raw
        assert len(rt.token_hash) == 64  # SHA-256 hex = 64 chars


# ── Task 5.3: logout ──────────────────────────────────────────────────────────

class TestLogout:
    """Spec: logout revokes the refresh token."""

    def test_logout_revokes_refresh_token(self, session: Session):
        """Spec: after logout, the refresh token has revoked_at set."""
        from app.services.usuario_service import UsuarioService
        from app.models.refresh_token import RefreshToken
        from app.core.security import hash_refresh_token
        from sqlmodel import select

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="Logout User", password="mypassword")
        session.commit()

        _, raw_refresh, usuario = svc.login(email=email, password="mypassword")
        session.commit()

        svc.logout(raw_refresh)
        session.commit()

        token_hash = hash_refresh_token(raw_refresh)
        stmt = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        rt = session.exec(stmt).first()
        assert rt is not None
        assert rt.revoked_at is not None


# ── Task 5.4: refresh ─────────────────────────────────────────────────────────

class TestRefresh:
    """Spec: rotation — old token revoked, new pair issued."""

    def test_refresh_returns_new_tokens(self, session: Session):
        """Spec: refresh issues new access + refresh tokens."""
        from app.services.usuario_service import UsuarioService

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="Refresh User", password="mypassword")
        session.commit()

        _, raw_refresh, _ = svc.login(email=email, password="mypassword")
        session.commit()

        new_access, new_refresh, usuario = svc.refresh(raw_refresh)
        session.commit()

        assert new_access is not None
        assert new_refresh is not None
        assert new_refresh != raw_refresh  # must be different token

    def test_refresh_revokes_old_token(self, session: Session):
        """Spec: the old refresh token is revoked after rotation."""
        from app.services.usuario_service import UsuarioService
        from app.models.refresh_token import RefreshToken
        from app.core.security import hash_refresh_token
        from sqlmodel import select

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="Rotate User", password="mypassword")
        session.commit()

        _, raw_refresh, _ = svc.login(email=email, password="mypassword")
        session.commit()

        svc.refresh(raw_refresh)
        session.commit()

        old_hash = hash_refresh_token(raw_refresh)
        stmt = select(RefreshToken).where(RefreshToken.token_hash == old_hash)
        old_rt = session.exec(stmt).first()
        assert old_rt is not None
        assert old_rt.revoked_at is not None  # old token is revoked

    def test_refresh_old_token_cannot_be_reused(self, session: Session):
        """Spec: using an already-rotated refresh token is rejected (401)."""
        from app.services.usuario_service import UsuarioService
        from fastapi import HTTPException

        svc = UsuarioService(session)
        email = _unique_email()
        svc.registrar(email=email, nombre="No Reuse", password="mypassword")
        session.commit()

        _, raw_refresh, _ = svc.login(email=email, password="mypassword")
        session.commit()

        # First refresh — should succeed
        svc.refresh(raw_refresh)
        session.commit()

        # Second refresh with same token — should fail
        with pytest.raises(HTTPException) as exc_info:
            svc.refresh(raw_refresh)
        assert exc_info.value.status_code == 401

    def test_refresh_nonexistent_token_rejected(self, session: Session):
        """Edge case: refreshing with an unknown token → 401."""
        from app.services.usuario_service import UsuarioService
        from fastapi import HTTPException

        svc = UsuarioService(session)

        with pytest.raises(HTTPException) as exc_info:
            svc.refresh("this-token-does-not-exist-at-all")
        assert exc_info.value.status_code == 401
