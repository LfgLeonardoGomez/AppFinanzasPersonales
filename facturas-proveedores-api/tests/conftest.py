"""
Fixtures de pytest para el proyecto facturas-proveedores-api.

IMPORTANTE — Regla dura #9:
    Los tests usan PostgreSQL descartable (testcontainers/Docker).
    NUNCA SQLite. SQLite tiene divergencias de tipos (UUID, numeric,
    constraints) que invalidan tests de dominio.

La fixture `pg_container` levanta un contenedor Postgres efímero con
scope="session" para reutilizarlo entre todos los tests del run,
acelerando el suite. Si se necesita aislamiento por test, usar
scope="function" y borrar/recrear tablas en teardown.

PRERREQUISITO: Docker Desktop corriendo en el host.
"""

import os
import uuid

import pytest
from fastapi.testclient import TestClient
from testcontainers.postgres import PostgresContainer


# ── PostgreSQL descartable ────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def pg_container():
    """
    Levanta un contenedor PostgreSQL efímero para toda la sesión de tests.

    El contenedor se destruye automáticamente al finalizar el suite.
    """
    with PostgresContainer(
        image="postgres:15-alpine",
        username="test_user",
        password="test_password",
        dbname="test_facturas",
    ) as postgres:
        yield postgres


@pytest.fixture(scope="session")
def db_url(pg_container: PostgresContainer) -> str:
    """
    URL de conexión al PostgreSQL de test.

    Se expone también como variable de entorno para que alembic/config
    puedan leerla si es necesario.
    """
    url = pg_container.get_connection_url()
    # testcontainers devuelve postgresql:// — convertir al driver psycopg2
    url = url.replace("postgresql://", "postgresql+psycopg2://", 1)
    os.environ["DATABASE_URL"] = url
    return url


# ── Variables de entorno mínimas para tests ──────────────────────────────────

@pytest.fixture(scope="session", autouse=True)
def env_vars(db_url: str):
    """
    Establece las variables de entorno mínimas para que Settings no falle.

    Se ejecuta automáticamente antes de cualquier test (autouse=True).
    Las variables se restauran al finalizar la sesión.
    """
    original = {}
    test_env = {
        "DATABASE_URL": db_url,
        "SECRET_KEY": "test-secret-key-must-be-at-least-32-chars-long",
        "CLOUDINARY_URL": "cloudinary://key:secret@cloud",
        "VISION_PROVIDER": "claude",
        "ANTHROPIC_API_KEY": "sk-ant-test",
        "OPENAI_API_KEY": "sk-test",
        "ACCESS_TOKEN_TTL_MIN": "30",
        "REFRESH_TOKEN_TTL_DAYS": "30",
        "FRONTEND_ORIGIN": "http://localhost:5173",
        "COOKIE_DOMAIN": "localhost",
    }

    for key, value in test_env.items():
        original[key] = os.environ.get(key)
        os.environ[key] = value

    yield

    for key, original_value in original.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


# ── FastAPI TestClient ────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def client(env_vars) -> TestClient:
    """
    TestClient de FastAPI para el suite de tests de integración.

    Depende de env_vars para que Settings esté configurado correctamente
    antes de importar app.main (que instancia Settings al importar).

    C-16 (D-3): `get_settings()` is no longer cached (it's now a
    read-through proxy in `app/core/config.py`). The `cache_clear()` hack
    is gone; do NOT re-introduce it. If you need to lock the
    live-env-read contract, see `tests/test_config.py::TestSettingsProxyLiveEnvReads`.
    """
    from app.main import app
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c


# ── Multi-user auth harness (c-22) ────────────────────────────────────────────
#
# The API authenticates ONLY through HttpOnly cookies. A TestClient (httpx)
# keeps a persistent cookie jar, so identity must be established per CLIENT —
# never by passing a hand-written {"Cookie": "access_token=..."} header.
#
# Two measured failure modes of the header approach (see c-22 design.md):
#   1. On write requests the jar wins over the explicit header, so a resource
#      "created by A" is actually persisted with B's usuario_id. Cross-tenant
#      tests then compare a user against itself and 404 assertions fail.
#   2. The jar leaks between tests sharing a module-scoped client, so a request
#      meant to be anonymous arrives authenticated by an earlier test's login.
#
# Rule: one client per identity, session only in that client's own jar.

def crear_negocio(session, nombre: str = "Negocio de Test"):
    """Persist a Negocio and return it.

    C-28: `usuario.negocio_id` is NOT NULL, so every test that builds a Usuario
    by hand needs a tenant first. This keeps that one line out of ~15 local
    factories.
    """
    from app.models.negocio import Negocio

    negocio = Negocio(nombre=nombre)
    session.add(negocio)
    session.flush()
    return negocio


def unique_test_email(prefix: str = "user") -> str:
    """Collision-free email so parallel users never clash in the DB."""
    return f"{prefix}_{uuid.uuid4().hex[:10]}@test.com"


def unique_client_ip() -> str:
    """Distinct source IP per login.

    The auth rate limiter is per-IP (D-C03-7). Creating several users inside
    one test from the same IP would trip it, so each login gets its own.
    """
    raw = uuid.uuid4().int
    return f"10.{raw % 256}.{(raw >> 8) % 256}.{((raw >> 16) % 254) + 1}"


def make_anon_client(app) -> TestClient:
    """A client guaranteed to carry no session.

    Use for 401 assertions so they prove the absence of a session instead of
    inheriting one from a previous test.
    """
    client = TestClient(app, raise_server_exceptions=True)
    client.cookies.clear()
    return client


def make_user_client(app, *, prefix: str = "user", password: str = "testpass123") -> TestClient:
    """Register + log in a fresh user and return that user's own client.

    The returned client carries the session in its own cookie jar. Requests
    made through it need no auth argument — that is the point: identity cannot
    be forgotten, mistyped, or silently overridden.

    The client is annotated with `usuario_id`, `negocio_id` and `email` for
    assertions.

    C-28: registration now also creates the user's own Negocio, so two calls to
    this helper produce two SEPARATE tenants — which is what cross-tenant
    isolation tests need. For two users inside the SAME negocio use
    `make_teammate_client`.
    """
    client = TestClient(app, raise_server_exceptions=True)
    email = unique_test_email(prefix)
    ip_headers = {"X-Forwarded-For": unique_client_ip()}

    registro = client.post(
        "/api/auth/registro",
        json={"email": email, "password": password, "nombre": "Test User"},
        headers=ip_headers,
    )
    assert registro.status_code == 201, f"registro failed: {registro.text}"

    login = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers=ip_headers,
    )
    assert login.status_code == 200, f"login failed: {login.text}"

    me = client.get("/api/me")
    assert me.status_code == 200, f"/api/me failed right after login: {me.text}"

    client.usuario_id = me.json()["id"]
    client.negocio_id = me.json()["negocio_id"]
    client.email = email
    return client


def make_teammate_client(app, engine, colega, *, password: str = "testpass123"):
    """Register a second user INSIDE `colega`'s negocio and return their client.

    C-29 will provide the real path for this (a single-use invite code). Until
    then the membership is set directly in the database: this harness exists to
    prove that two members of one shop share their data, and that assertion is
    worth having before the invite endpoints are built.

    The teammate is a plain member — `es_admin` stays false.
    """
    import uuid as _uuid

    from sqlalchemy import text as _text

    client = make_user_client(app, prefix="mate", password=password)

    with engine.begin() as conn:
        conn.execute(
            _text("UPDATE usuario SET negocio_id = :negocio WHERE id = :id"),
            {"negocio": _uuid.UUID(colega.negocio_id), "id": _uuid.UUID(client.usuario_id)},
        )

    me = client.get("/api/me")
    assert me.status_code == 200, f"/api/me failed after joining negocio: {me.text}"
    assert me.json()["negocio_id"] == colega.negocio_id

    client.negocio_id = colega.negocio_id
    return client
