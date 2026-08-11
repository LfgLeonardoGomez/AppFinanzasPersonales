"""
C-29 — the edges the happy-path integration tests do not reach.

Three things get proven here that the flow tests cannot:

- `revoke_all_for_usuario` kills exactly one user's sessions and nobody else's.
  The integration test shows the revoked member cannot renew; it says nothing
  about whether their teammates got logged out too.
- The public employee-signup endpoint is rate limited. It eats invitation codes
  and answers identically on every failure, which is precisely what makes it
  worth brute-forcing if nothing throttles it.
- The team collection route answers on both `/api/equipo` and `/api/equipo/`
  without a 307 (C-27): a redirect makes some clients rebuild the request and
  drop the session cookie.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from app.core.security import create_refresh_token
from app.models.usuario import Usuario
from app.repositories.refresh_token_repository import RefreshTokenRepository
from tests.conftest import (
    crear_negocio,
    make_anon_client,
    make_user_client,
    unique_client_ip,
    unique_test_email,
)


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


def _usuario(session: Session, **overrides) -> Usuario:
    negocio = crear_negocio(session)
    usuario = Usuario(
        negocio_id=negocio.id,
        email=unique_test_email("rev"),
        nombre="Test",
        password_hash="hash",
        **overrides,
    )
    session.add(usuario)
    session.flush()
    return usuario


def _token_activo(repo: RefreshTokenRepository, usuario: Usuario):
    _, token_hash = create_refresh_token()
    return repo.create(
        usuario_id=usuario.id,
        token_hash=token_hash,
        expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )


class TestRevokeAllForUsuario:
    """Task 5.8."""

    def test_revokes_every_active_token_of_that_user(self, session: Session):
        repo = RefreshTokenRepository(session)
        usuario = _usuario(session)
        tokens = [_token_activo(repo, usuario) for _ in range(3)]

        revocados = repo.revoke_all_for_usuario(usuario.id)

        assert revocados == 3
        for t in tokens:
            session.refresh(t)
            assert t.revoked_at is not None

    def test_does_not_touch_another_users_sessions(self, session: Session):
        """The teammates of a revoked member must stay logged in."""
        repo = RefreshTokenRepository(session)
        objetivo = _usuario(session)
        ajeno = _usuario(session)

        token_objetivo = _token_activo(repo, objetivo)
        token_ajeno = _token_activo(repo, ajeno)

        repo.revoke_all_for_usuario(objetivo.id)

        session.refresh(token_objetivo)
        session.refresh(token_ajeno)
        assert token_objetivo.revoked_at is not None
        assert token_ajeno.revoked_at is None, "se revocó la sesión de otro usuario"

    def test_is_idempotent(self, session: Session):
        repo = RefreshTokenRepository(session)
        usuario = _usuario(session)
        _token_activo(repo, usuario)

        primera = repo.revoke_all_for_usuario(usuario.id)
        segunda = repo.revoke_all_for_usuario(usuario.id)

        assert primera == 1
        assert segunda == 0, "una segunda pasada volvió a tocar filas ya revocadas"

    def test_leaves_already_revoked_timestamps_alone(self, session: Session):
        repo = RefreshTokenRepository(session)
        usuario = _usuario(session)
        token = _token_activo(repo, usuario)

        repo.revoke_all_for_usuario(usuario.id)
        session.refresh(token)
        primer_sello = token.revoked_at

        repo.revoke_all_for_usuario(usuario.id)
        session.refresh(token)

        assert token.revoked_at == primer_sello


@pytest.fixture(scope="module")
def app_with_db(engine, env_vars):
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.auth import get_db as get_db_auth
    from app.routers.equipo import get_db as get_db_equipo
    from app.routers.usuarios import get_db as get_db_usuarios

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_equipo] = override_get_db

    yield app

    app.dependency_overrides.clear()


class TestRateLimiting:
    """Task 7.5 — the endpoint that eats codes has to be throttled."""

    def test_employee_signup_is_rate_limited(self, app_with_db):
        from app.core.deps import reset_rate_limit_store

        reset_rate_limit_store()
        cliente = make_anon_client(app_with_db)
        misma_ip = {"X-Forwarded-For": "203.0.113.77"}

        estados = []
        for _ in range(8):
            r = cliente.post(
                "/api/auth/registro-empleado",
                json={
                    "email": unique_test_email("bruteforce"),
                    "nombre": "Probe",
                    "password": "testpass123",
                    "codigo": "ZZZZ2345",
                },
                headers=misma_ip,
            )
            estados.append(r.status_code)

        assert 429 in estados, (
            f"el endpoint público de alta por código no se frenó nunca: {estados}"
        )
        reset_rate_limit_store()


class TestRutasDeColeccion:
    """Task 7.7 — the C-27 contract: no 307 on the trailing slash."""

    def test_equipo_answers_on_both_paths_without_redirect(self, app_with_db):
        from app.core.deps import reset_rate_limit_store

        reset_rate_limit_store()
        admin = make_user_client(app_with_db, prefix="slash")

        sin_barra = admin.get("/api/equipo", follow_redirects=False)
        con_barra = admin.get("/api/equipo/", follow_redirects=False)

        assert sin_barra.status_code == 200, sin_barra.text
        assert con_barra.status_code == 200, con_barra.text
        assert sin_barra.json() == con_barra.json()


class TestRequireAdmin:
    """Tasks 4.1 / 4.2 — the dependency itself, not just its effect."""

    def test_deactivated_admin_is_rejected(self, app_with_db, engine):
        """An admin who was deactivated loses the privilege with the access."""
        from app.core.deps import reset_rate_limit_store

        reset_rate_limit_store()
        admin = make_user_client(app_with_db, prefix="deadadmin")
        assert admin.get("/api/equipo").status_code == 200

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(admin.usuario_id)},
            )

        respuesta = admin.get("/api/equipo")
        assert respuesta.status_code == 401, (
            "un admin desactivado siguió administrando el equipo"
        )

    def test_missing_privilege_is_403_not_404(self, app_with_db):
        """403 tells the member what is wrong; 404 would leave them guessing."""
        from app.core.deps import reset_rate_limit_store

        reset_rate_limit_store()
        admin = make_user_client(app_with_db, prefix="p403")
        codigo = admin.post(
            "/api/equipo/invitaciones", headers={"X-Forwarded-For": unique_client_ip()}
        ).json()["codigo"]

        empleado = make_anon_client(app_with_db)
        email = unique_test_email("p403emp")
        ip = {"X-Forwarded-For": unique_client_ip()}
        empleado.post(
            "/api/auth/registro-empleado",
            json={"email": email, "nombre": "Emp", "password": "testpass123", "codigo": codigo},
            headers=ip,
        )
        empleado.post(
            "/api/auth/login", json={"email": email, "password": "testpass123"}, headers=ip
        )

        respuesta = empleado.get("/api/equipo")
        assert respuesta.status_code == 403
        assert respuesta.status_code != 404
