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
