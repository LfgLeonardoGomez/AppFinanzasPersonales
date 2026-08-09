"""
Tests for C-05 UsuarioService methods: actualizar_perfil, actualizar_avatar (tasks 2.1-2.5).

Covers:
- actualizar_perfil: partial update of optional fields, omitted fields unchanged,
  theme change persisted, identity fields NOT changeable.
- actualizar_avatar: sets avatar_url on the authenticated user's record.
- Isolation: a foreign user_id is impossible because the service ONLY operates on
  the supplied usuario_id (caller-side scoping); the router always passes the
  authenticated user.id, so cross-tenant writes are structurally impossible.

Uses real Postgres via testcontainers (session-scoped fixture from conftest).
"""

import uuid
from decimal import Decimal

import pytest
from sqlmodel import Session, SQLModel, create_engine
from fastapi import HTTPException

import app.models  # noqa: F401


# ── Fixtures ──────────────────────────────────────────────────────────────────


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


def _make_usuario(
    session: Session,
    email: str | None = None,
    nombre: str = "Test User",
    telefono: str | None = None,
    nombre_negocio: str | None = None,
) -> "Usuario":
    from app.models.usuario import Usuario
    from app.core.uuid_utils import new_uuid

    from tests.conftest import crear_negocio

    u = Usuario(
        id=new_uuid(),
        negocio_id=crear_negocio(session).id,
        email=email or f"u_{uuid.uuid4().hex[:8]}@test.com",
        nombre=nombre,
        password_hash="$argon2id$v=19$m=65536,t=3,p=4$fakehashforperfil",
        telefono=telefono,
        nombre_negocio=nombre_negocio,
    )
    session.add(u)
    session.flush()
    return u


# ── actualizar_perfil ─────────────────────────────────────────────────────────


class TestActualizarPerfil:
    """Spec: PATCH /api/me service behavior."""

    def test_actualizar_perfil_updates_telefono_and_nombre_negocio(self, session: Session):
        """Spec: subset update persists the provided fields, leaves others."""
        from app.services.usuario_service import UsuarioService
        from app.schemas.perfil import PerfilUpdate

        user = _make_usuario(session, telefono="1100000000")
        session.commit()

        svc = UsuarioService(session)
        result = svc.actualizar_perfil(
            user.id,
            PerfilUpdate(telefono="1122334455", nombre_negocio="Kiosco Don Pepe"),
        )
        session.commit()

        assert result.telefono == "1122334455"
        assert result.nombre_negocio == "Kiosco Don Pepe"
        # tema_preferido default is CLARO; was not provided, must remain CLARO.
        assert result.tema_preferido.value == "CLARO"

        # Persisted in DB
        from app.models.usuario import Usuario
        from app.repositories.usuario_repository import UsuarioRepository

        repo = UsuarioRepository(session)
        fresh = repo.get_by_id(user.id)
        assert fresh is not None
        assert fresh.telefono == "1122334455"
        assert fresh.nombre_negocio == "Kiosco Don Pepe"
        assert fresh.tema_preferido.value == "CLARO"

    def test_actualizar_perfil_tema_only_leaves_other_fields(self, session: Session):
        """Spec: only sending tema_preferido must NOT clear telefono/nombre_negocio."""
        from app.services.usuario_service import UsuarioService
        from app.models.enums import TemaPreferido
        from app.schemas.perfil import PerfilUpdate

        user = _make_usuario(
            session,
            telefono="1100000000",
            nombre_negocio="Acme",
        )
        session.commit()

        svc = UsuarioService(session)
        result = svc.actualizar_perfil(
            user.id, PerfilUpdate(tema_preferido=TemaPreferido.OSCURO)
        )
        session.commit()

        assert result.tema_preferido.value == "OSCURO"
        # Omitted fields MUST remain unchanged.
        assert result.telefono == "1100000000"
        assert result.nombre_negocio == "Acme"

    def test_actualizar_perfil_clears_telefono_with_empty_string(self, session: Session):
        """Spec: telefono='' is an explicit clear; service must apply it."""
        from app.services.usuario_service import UsuarioService
        from app.schemas.perfil import PerfilUpdate

        user = _make_usuario(session, telefono="1100000000")
        session.commit()

        svc = UsuarioService(session)
        result = svc.actualizar_perfil(user.id, PerfilUpdate(telefono=""))
        session.commit()

        assert result.telefono == ""

    def test_actualizar_perfil_empty_payload_is_noop(self, session: Session):
        """Spec: empty PATCH payload returns the user unchanged (no-op)."""
        from app.services.usuario_service import UsuarioService
        from app.schemas.perfil import PerfilUpdate

        user = _make_usuario(
            session,
            telefono="1100000000",
            nombre_negocio="Acme",
        )
        session.commit()

        svc = UsuarioService(session)
        result = svc.actualizar_perfil(user.id, PerfilUpdate())
        session.commit()

        assert result.telefono == "1100000000"
        assert result.nombre_negocio == "Acme"
        assert result.tema_preferido.value == "CLARO"

    def test_actualizar_perfil_returns_persisted_usuario(self, session: Session):
        """Spec: the return value reflects the persisted state."""
        from app.services.usuario_service import UsuarioService
        from app.models.enums import TemaPreferido
        from app.schemas.perfil import PerfilUpdate

        user = _make_usuario(session)
        session.commit()

        svc = UsuarioService(session)
        result = svc.actualizar_perfil(
            user.id, PerfilUpdate(nombre_negocio="Test Store")
        )
        session.commit()

        assert result.id == user.id
        assert result.email == user.email  # identity field unchanged
        assert result.nombre == user.nombre  # identity field unchanged
        assert result.nombre_negocio == "Test Store"


# ── actualizar_avatar ────────────────────────────────────────────────────────


class TestActualizarAvatar:
    """Spec: POST /api/me/avatar service behavior."""

    def test_actualizar_avatar_sets_url(self, session: Session):
        """Spec: a valid Cloudinary URL is persisted as avatar_url."""
        from app.services.usuario_service import UsuarioService

        user = _make_usuario(session)
        session.commit()

        url = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/me.jpg"
        svc = UsuarioService(session)
        result = svc.actualizar_avatar(user.id, url)
        session.commit()

        assert result.avatar_url == url

        # Persisted in DB
        from app.repositories.usuario_repository import UsuarioRepository

        repo = UsuarioRepository(session)
        fresh = repo.get_by_id(user.id)
        assert fresh is not None
        assert fresh.avatar_url == url

    def test_actualizar_avatar_overwrites_previous(self, session: Session):
        """Spec: updating the avatar replaces any prior value."""
        from app.services.usuario_service import UsuarioService

        old = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/old.jpg"
        new = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/new.jpg"

        user = _make_usuario(session)
        user.avatar_url = old
        session.commit()

        svc = UsuarioService(session)
        result = svc.actualizar_avatar(user.id, new)
        session.commit()

        assert result.avatar_url == new
        assert result.avatar_url != old

    def test_actualizar_avatar_does_not_touch_other_fields(self, session: Session):
        """Spec: avatar update leaves telefono/nombre_negocio/tema alone."""
        from app.services.usuario_service import UsuarioService

        user = _make_usuario(
            session,
            telefono="1100000000",
            nombre_negocio="Acme",
        )
        session.commit()

        url = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/pic.jpg"
        svc = UsuarioService(session)
        result = svc.actualizar_avatar(user.id, url)
        session.commit()

        assert result.telefono == "1100000000"
        assert result.nombre_negocio == "Acme"
        assert result.tema_preferido.value == "CLARO"


# ── Isolation (task 2.5) ─────────────────────────────────────────────────────


class TestProfileIsolation:
    """
    Spec: profile operations only ever touch the authenticated user's own record.

    The service takes usuario_id as the first arg and never resolves a
    record by any other id. This makes cross-tenant writes structurally
    impossible at the service layer; foreign access at the router would
    require the caller to substitute their own id (which only their own
    session knows), so it cannot leak across users.
    """

    def test_actualizar_perfil_on_user_a_does_not_affect_user_b(self, session: Session):
        """Spec: User A's update does not touch User B's profile."""
        from app.services.usuario_service import UsuarioService
        from app.schemas.perfil import PerfilUpdate

        user_a = _make_usuario(session, telefono="1111111111")
        user_b = _make_usuario(session, telefono="2222222222")
        session.commit()

        svc = UsuarioService(session)
        svc.actualizar_perfil(user_a.id, PerfilUpdate(telefono="9999999999"))
        session.commit()

        # User B's telefono is untouched.
        from app.repositories.usuario_repository import UsuarioRepository

        repo = UsuarioRepository(session)
        fresh_b = repo.get_by_id(user_b.id)
        assert fresh_b is not None
        assert fresh_b.telefono == "2222222222"

    def test_actualizar_avatar_on_user_a_does_not_affect_user_b(self, session: Session):
        """Spec: User A's avatar update does not touch User B's profile."""
        from app.services.usuario_service import UsuarioService

        user_a = _make_usuario(session)
        user_b = _make_usuario(session)
        user_b.avatar_url = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/b.jpg"
        session.commit()

        url_a = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/a.jpg"
        svc = UsuarioService(session)
        svc.actualizar_avatar(user_a.id, url_a)
        session.commit()

        from app.repositories.usuario_repository import UsuarioRepository

        repo = UsuarioRepository(session)
        fresh_b = repo.get_by_id(user_b.id)
        assert fresh_b is not None
        assert fresh_b.avatar_url == (
            "https://res.cloudinary.com/cloud/image/upload/v1/avatar/b.jpg"
        )
