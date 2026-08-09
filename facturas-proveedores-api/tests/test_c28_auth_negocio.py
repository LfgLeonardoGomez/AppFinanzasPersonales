"""
C-28 — registration creates the negocio, and deactivated users cannot get in.

Registration entering this change is not scope creep: `usuario.negocio_id` is
NOT NULL, so the existing endpoint would simply stop working without it (D6).

The deactivation check lives in `get_current_user` rather than in a token claim
on purpose (D1): the user row is already fetched on every request, so a
deactivated account loses access immediately instead of surviving until its
access token expires.
"""

import uuid

import pytest
from sqlalchemy import create_engine, text

from app.core.security import create_access_token, decode_token
from tests.conftest import make_anon_client, unique_client_ip, unique_test_email


@pytest.fixture
def app_module(engine):
    """The FastAPI app, with the schema guaranteed to exist first."""
    from app.main import app

    return app


@pytest.fixture(scope="module")
def engine(db_url: str):
    """Engine on the shared disposable Postgres.

    Each test module builds the schema itself (repo convention) — create_all is
    a no-op for tables another module already made.
    """
    import app.models  # noqa: F401 — register every table before create_all
    from sqlmodel import SQLModel

    eng = create_engine(db_url)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


def _registrar(client, *, nombre_negocio=None, nombre="Test User"):
    payload = {
        "email": unique_test_email("c28"),
        "password": "testpass123",
        "nombre": nombre,
    }
    if nombre_negocio is not None:
        payload["nombre_negocio"] = nombre_negocio

    return client.post(
        "/api/auth/registro",
        json=payload,
        headers={"X-Forwarded-For": unique_client_ip()},
    )


class TestRegistroCreatesNegocio:
    """Tasks 4.1 - 4.3."""

    def test_registro_creates_negocio_and_admin_user(self, app_module, engine):
        client = make_anon_client(app_module)
        respuesta = _registrar(client, nombre_negocio="Kiosco Central")

        assert respuesta.status_code == 201, respuesta.text
        cuerpo = respuesta.json()
        assert "password_hash" not in cuerpo

        with engine.connect() as conn:
            fila = conn.execute(
                text(
                    "SELECT u.es_admin, u.desactivado, n.nombre "
                    "FROM usuario u JOIN negocio n ON n.id = u.negocio_id "
                    "WHERE u.id = :id"
                ),
                {"id": uuid.UUID(cuerpo["id"])},
            ).one()

        es_admin, desactivado, nombre_negocio = fila
        assert es_admin is True
        assert desactivado is False
        assert nombre_negocio == "Kiosco Central"

    def test_registro_derives_negocio_name_when_omitted(self, app_module, engine):
        client = make_anon_client(app_module)
        respuesta = _registrar(client, nombre="Marta Gómez")

        assert respuesta.status_code == 201, respuesta.text

        with engine.connect() as conn:
            nombre = conn.execute(
                text(
                    "SELECT n.nombre FROM negocio n "
                    "JOIN usuario u ON u.negocio_id = n.id WHERE u.id = :id"
                ),
                {"id": uuid.UUID(respuesta.json()["id"])},
            ).scalar()

        assert nombre is not None and nombre.strip() != ""
        assert "Marta Gómez" in nombre

    def test_duplicate_email_leaves_no_orphan_negocio(self, app_module, engine):
        client = make_anon_client(app_module)
        email = unique_test_email("dup")
        headers = {"X-Forwarded-For": unique_client_ip()}
        payload = {"email": email, "password": "testpass123", "nombre": "Primero"}

        primera = client.post("/api/auth/registro", json=payload, headers=headers)
        assert primera.status_code == 201, primera.text

        with engine.connect() as conn:
            negocios_antes = conn.execute(text("SELECT count(*) FROM negocio")).scalar()

        segunda = client.post(
            "/api/auth/registro",
            json={**payload, "nombre": "Segundo"},
            headers={"X-Forwarded-For": unique_client_ip()},
        )
        assert segunda.status_code == 409, segunda.text

        with engine.connect() as conn:
            negocios_despues = conn.execute(text("SELECT count(*) FROM negocio")).scalar()
            usuarios_con_ese_email = conn.execute(
                text("SELECT count(*) FROM usuario WHERE email = :email"),
                {"email": email},
            ).scalar()
            huerfanos = conn.execute(
                text(
                    "SELECT count(*) FROM negocio n WHERE NOT EXISTS "
                    "(SELECT 1 FROM usuario u WHERE u.negocio_id = n.id)"
                )
            ).scalar()

        assert negocios_despues == negocios_antes, "el registro fallido creó un negocio"
        assert usuarios_con_ese_email == 1
        assert huerfanos == 0

    def test_each_registration_gets_its_own_negocio(self, app_module, engine):
        primero = make_anon_client(app_module)
        segundo = make_anon_client(app_module)

        uno = _registrar(primero)
        dos = _registrar(segundo)
        assert uno.status_code == 201 and dos.status_code == 201

        with engine.connect() as conn:
            negocios = conn.execute(
                text("SELECT negocio_id FROM usuario WHERE id IN (:a, :b)"),
                {"a": uuid.UUID(uno.json()["id"]), "b": uuid.UUID(dos.json()["id"])},
            ).scalars().all()

        assert len(set(negocios)) == 2


class TestDeactivatedUserIsLockedOut:
    """Tasks 4.5 - 4.6."""

    def test_deactivated_user_gets_401_with_a_valid_token(self, app_module, engine):
        from tests.conftest import make_user_client

        client = make_user_client(app_module, prefix="deact")
        assert client.get("/api/me").status_code == 200

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(client.usuario_id)},
            )

        respuesta = client.get("/api/me")
        assert respuesta.status_code == 401, (
            "un usuario desactivado siguió entrando con su token vigente"
        )

    def test_deactivated_user_cannot_reach_business_endpoints(self, app_module, engine):
        from tests.conftest import make_user_client

        client = make_user_client(app_module, prefix="deactbiz")
        assert client.get("/api/proveedores").status_code == 200

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(client.usuario_id)},
            )

        assert client.get("/api/proveedores").status_code == 401

    def test_reactivation_restores_access(self, app_module, engine):
        from tests.conftest import make_user_client

        client = make_user_client(app_module, prefix="react")

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(client.usuario_id)},
            )
        assert client.get("/api/me").status_code == 401

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = false WHERE id = :id"),
                {"id": uuid.UUID(client.usuario_id)},
            )
        assert client.get("/api/me").status_code == 200


class TestTokenShapeIsUnchanged:
    """Task 4.7 — D1: the negocio_id is NOT a token claim."""

    def test_access_token_carries_no_negocio_id(self, env_vars):
        token = create_access_token(sub=str(uuid.uuid4()))
        payload = decode_token(token)

        assert set(payload) == {"sub", "iat", "exp", "type"}
        assert "negocio_id" not in payload
        assert payload["type"] == "access"
