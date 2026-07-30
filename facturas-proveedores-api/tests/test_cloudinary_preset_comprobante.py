"""
Tests for the C-10 extension of /api/cloudinary/preset-firmado
to accept tipo=comprobante (Task 6.1 — TDD RED, then GREEN).

Covers:
- tipo=comprobante → 200 with the same shape as tipo=avatar and tipo=factura
- tipo=desconocido → 422 (Pydantic enum rejects)
- tipo=factura still works (no regression)
- tipo=avatar still works (no regression)
- Unauthenticated → 401
- Response does NOT include api_secret (security baseline, D3 from C-05)

c-22: auth is per-client. Each authenticated test drives its own logged-in
client (`make_user_client`); the 401 test uses a client with a guaranteed-empty
cookie jar (`make_anon_client`). Previously this file shared one module-scoped
client, so the 401 test inherited an earlier test's session and passed only
when run in isolation.
"""

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_anon_client, make_user_client


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def cloud_app(engine, env_vars):
    """The app wired to the throwaway Postgres.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    # app.routers.cloudinary_preset does not itself use `get_db` (only
    # `get_current_user`), so we borrow the OLD `get_db` reference from a
    # router that does — same pattern used by test_ia_vision_integration.py.
    from app.routers.facturas import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    # One context-managed client so the app's lifespan runs once per module.
    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


@pytest.fixture
def user(cloud_app) -> TestClient:
    """A logged-in client; its session lives only in its own cookie jar."""
    return make_user_client(cloud_app, prefix="cloud")


class TestComprobantePreset:
    def test_tipo_comprobante_returns_signed_preset(self, user: TestClient):
        """C-10: tipo=comprobante is now a valid value; same response shape."""
        resp = user.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "comprobante"},
        )
        assert resp.status_code == 200
        data = resp.json()
        # Public parameters only — same as avatar/factura
        assert "signature" in data
        assert "timestamp" in data
        assert "api_key" in data
        assert "cloud_name" in data
        assert "folder" in data
        assert "allowed_formats" in data
        assert "max_file_size" in data
        # No secret leaked
        assert "api_secret" not in data
        assert "secret" not in data

    def test_tipo_comprobante_folder_distinct(self, user: TestClient):
        """The comprobante preset should be in its own folder (comprobantes)
        so Cloudinary organizes uploads by kind."""
        resp = user.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "comprobante"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "comprobantes"

    def test_tipo_desconocido_returns_422(self, user: TestClient):
        resp = user.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "desconocido"},
        )
        assert resp.status_code == 422

    def test_unauthenticated_returns_401(self, cloud_app):
        """Must hold regardless of whether another test logged in first."""
        anon = make_anon_client(cloud_app)

        resp = anon.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "comprobante"},
        )
        assert resp.status_code == 401

    def test_tipo_avatar_still_works(self, user: TestClient):
        """No regression: tipo=avatar continues to work (C-05 contract)."""
        resp = user.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "avatar"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "avatars"

    def test_tipo_factura_still_works(self, user: TestClient):
        """No regression: tipo=factura continues to work (C-08 contract)."""
        resp = user.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "factura"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "facturas"
