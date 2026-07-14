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
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def cloud_client(engine, env_vars) -> TestClient:
    """Integration client with DB override.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.core.deps import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


def _unique_email():
    return f"cloud_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.9"


def _register_and_login(client: TestClient) -> dict:
    email = _unique_email()
    password = "testpass123"
    ip = _unique_ip()

    client.post(
        "/api/auth/registro",
        json={"email": email, "password": password, "nombre": "Test User"},
        headers={"X-Forwarded-For": ip},
    )
    login_resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )
    assert login_resp.status_code == 200
    token = login_resp.cookies.get("access_token")
    return {"Cookie": f"access_token={token}"}


class TestComprobantePreset:
    def test_tipo_comprobante_returns_signed_preset(self, cloud_client: TestClient):
        """C-10: tipo=comprobante is now a valid value; same response shape."""
        headers = _register_and_login(cloud_client)

        resp = cloud_client.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "comprobante"},
            headers=headers,
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

    def test_tipo_comprobante_folder_distinct(self, cloud_client: TestClient):
        """The comprobante preset should be in its own folder (comprobantes)
        so Cloudinary organizes uploads by kind."""
        headers = _register_and_login(cloud_client)

        resp = cloud_client.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "comprobante"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "comprobantes"

    def test_tipo_desconocido_returns_422(self, cloud_client: TestClient):
        headers = _register_and_login(cloud_client)

        resp = cloud_client.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "desconocido"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_unauthenticated_returns_401(self, cloud_client: TestClient):
        resp = cloud_client.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "comprobante"},
        )
        assert resp.status_code == 401

    def test_tipo_avatar_still_works(self, cloud_client: TestClient):
        """No regression: tipo=avatar continues to work (C-05 contract)."""
        headers = _register_and_login(cloud_client)

        resp = cloud_client.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "avatar"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "avatars"

    def test_tipo_factura_still_works(self, cloud_client: TestClient):
        """No regression: tipo=factura continues to work (C-08 contract)."""
        headers = _register_and_login(cloud_client)

        resp = cloud_client.get(
            "/api/cloudinary/preset-firmado",
            params={"tipo": "factura"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["folder"] == "facturas"
