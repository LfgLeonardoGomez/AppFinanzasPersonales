"""
Integration tests for the perfil/avatar/preset endpoints (C-05 tasks 4.1, 4.3, 4.5 — TDD RED).

Covers:
- PATCH /api/me
  - authenticated subset update returns 200 with updated profile
  - invalid tema_preferido → 422
  - identity fields (email/nombre) are NOT changed
  - unauthenticated → 401
- POST /api/me/avatar
  - valid Cloudinary URL updates avatar; returns 200 with updated profile
  - malformed URL → 422
  - unauthenticated → 401
- GET /api/cloudinary/preset-firmado?tipo=avatar
  - authenticated returns signed preset with constraints
  - the secret is absent from the response
  - unsupported tipo → 422
  - unauthenticated → 401
"""

import uuid
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def perfil_client(engine, env_vars) -> TestClient:
    """Integration TestClient with DB override and rate-limit store reset.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.routers.usuarios import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


# ── Auth helpers ──────────────────────────────────────────────────────────────


def _unique_email():
    return f"perfil_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.3"


def _register_and_login(client: TestClient) -> str:
    """Register a new user and return their access_token (no cookies retained)."""
    email = _unique_email()
    password = "testpass123"
    ip = _unique_ip()

    client.post(
        "/api/auth/registro",
        json={"email": email, "nombre": "Perfil Test", "password": password},
        headers={"X-Forwarded-For": ip},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )
    assert resp.status_code == 200
    return resp.cookies["access_token"]


def _set_token(client: TestClient, token: str) -> None:
    client.cookies.clear()
    client.cookies.set("access_token", token)


def _clear_token(client: TestClient) -> None:
    client.cookies.clear()


# ── PATCH /api/me ─────────────────────────────────────────────────────────────


class TestPatchMe:
    def test_patch_me_without_auth_returns_401(self, perfil_client: TestClient):
        """Spec: unauthenticated PATCH /api/me → 401."""
        _clear_token(perfil_client)
        resp = perfil_client.patch("/api/me", json={"telefono": "1111111111"})
        assert resp.status_code == 401

    def test_patch_me_subset_update_returns_200(self, perfil_client: TestClient):
        """Spec: subset update persists telefono and nombre_negocio."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.patch(
            "/api/me",
            json={"telefono": "1122334455", "nombre_negocio": "Kiosco Don Pepe"},
        )
        _clear_token(perfil_client)

        assert resp.status_code == 200
        data = resp.json()
        assert data["telefono"] == "1122334455"
        assert data["nombre_negocio"] == "Kiosco Don Pepe"
        # tema_preferido default is CLARO
        assert data["tema_preferido"] == "CLARO"

    def test_patch_me_tema_only_leaves_other_fields(self, perfil_client: TestClient):
        """Spec: only changing tema_preferido must NOT clear other fields."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        # First, set telefono
        r1 = perfil_client.patch("/api/me", json={"telefono": "1100000000"})
        assert r1.status_code == 200

        # Then change only the theme
        r2 = perfil_client.patch("/api/me", json={"tema_preferido": "OSCURO"})
        _clear_token(perfil_client)

        assert r2.status_code == 200
        data = r2.json()
        assert data["tema_preferido"] == "OSCURO"
        assert data["telefono"] == "1100000000"

    def test_patch_me_invalid_tema_returns_422(self, perfil_client: TestClient):
        """Spec: invalid tema_preferido value → 422."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.patch("/api/me", json={"tema_preferido": "ROSA"})
        _clear_token(perfil_client)

        assert resp.status_code == 422

    def test_patch_me_identity_fields_ignored(self, perfil_client: TestClient):
        """Spec: email/nombre are NOT changeable through PATCH /api/me."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        # Fetch the original email to compare
        me = perfil_client.get("/api/me").json()
        original_email = me["email"]
        original_nombre = me["nombre"]

        # Try to change them
        resp = perfil_client.patch(
            "/api/me",
            json={"email": "hacker@evil.com", "nombre": "Impostor"},
        )
        _clear_token(perfil_client)

        # Pydantic's extra='forbid' on PerfilUpdate → 422 if unknown fields are sent
        # (this is the strongest rejection; spec also allows "ignored")
        assert resp.status_code in (200, 422)
        if resp.status_code == 200:
            data = resp.json()
            assert data["email"] == original_email
            assert data["nombre"] == original_nombre

    def test_patch_me_empty_payload_returns_200_unchanged(self, perfil_client: TestClient):
        """Spec: empty PATCH is a no-op and returns 200."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.patch("/api/me", json={})
        _clear_token(perfil_client)

        assert resp.status_code == 200


# ── POST /api/me/avatar ───────────────────────────────────────────────────────


class TestPostAvatar:
    def test_avatar_without_auth_returns_401(self, perfil_client: TestClient):
        """Spec: unauthenticated POST /api/me/avatar → 401."""
        _clear_token(perfil_client)
        resp = perfil_client.post(
            "/api/me/avatar",
            json={"avatar_url": "https://res.cloudinary.com/cloud/image/upload/v1/x.jpg"},
        )
        assert resp.status_code == 401

    def test_avatar_valid_url_returns_200_with_avatar(self, perfil_client: TestClient):
        """Spec: valid Cloudinary URL updates avatar_url."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        url = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/me.jpg"
        resp = perfil_client.post("/api/me/avatar", json={"avatar_url": url})
        _clear_token(perfil_client)

        assert resp.status_code == 200
        data = resp.json()
        assert data["avatar_url"] == url

    def test_avatar_malformed_url_returns_422(self, perfil_client: TestClient):
        """Spec: malformed URL → 422."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.post(
            "/api/me/avatar", json={"avatar_url": "not-a-url"}
        )
        _clear_token(perfil_client)

        assert resp.status_code == 422

    def test_avatar_non_cloudinary_url_returns_422(self, perfil_client: TestClient):
        """Spec: URL on a non-Cloudinary host → 422."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.post(
            "/api/me/avatar",
            json={"avatar_url": "https://evil.example.com/x.jpg"},
        )
        _clear_token(perfil_client)

        assert resp.status_code == 422

    def test_avatar_wrong_cloud_name_returns_422(self, perfil_client: TestClient):
        """Spec: URL on res.cloudinary.com but a different cloud_name → 422."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.post(
            "/api/me/avatar",
            json={
                "avatar_url": "https://res.cloudinary.com/other-cloud/image/upload/v1/x.jpg"
            },
        )
        _clear_token(perfil_client)

        assert resp.status_code == 422


# ── GET /api/cloudinary/preset-firmado ────────────────────────────────────────


class TestSignedPreset:
    def test_preset_without_auth_returns_401(self, perfil_client: TestClient):
        """Spec: unauthenticated GET preset-firmado → 401."""
        _clear_token(perfil_client)
        resp = perfil_client.get("/api/cloudinary/preset-firmado?tipo=avatar")
        assert resp.status_code == 401

    def test_preset_avatar_returns_signed_payload(self, perfil_client: TestClient):
        """Spec: authenticated request returns signed preset with constraints."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        with patch(
            "app.core.cloudinary_signer._call_cloudinary_sign",
            return_value="fakesignature",
        ):
            resp = perfil_client.get("/api/cloudinary/preset-firmado?tipo=avatar")
        _clear_token(perfil_client)

        assert resp.status_code == 200
        data = resp.json()
        # All public fields present
        assert data["signature"] == "fakesignature"
        assert isinstance(data["timestamp"], int)
        assert "api_key" in data
        assert data["cloud_name"] == "cloud"  # from test CLOUDINARY_URL
        assert data["folder"] == "avatars"
        assert set(data["allowed_formats"]) == {"pdf", "jpg", "png"}
        assert data["max_file_size"] <= 10 * 1024 * 1024

    def test_preset_response_does_not_include_secret(self, perfil_client: TestClient):
        """Spec: the API secret MUST NOT appear in the response."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        with patch(
            "app.core.cloudinary_signer._call_cloudinary_sign",
            return_value="sig",
        ):
            resp = perfil_client.get("/api/cloudinary/preset-firmado?tipo=avatar")
        _clear_token(perfil_client)

        data = resp.json()
        for forbidden in ("api_secret", "secret", "cloudinary_secret"):
            assert forbidden not in data, (
                f"Response must NOT include '{forbidden}'"
            )

    def test_preset_unsupported_tipo_returns_422(self, perfil_client: TestClient):
        """Spec: unsupported tipo → 422."""
        token = _register_and_login(perfil_client)
        _set_token(perfil_client, token)

        resp = perfil_client.get(
            "/api/cloudinary/preset-firmado?tipo=factura_invalida"
        )
        _clear_token(perfil_client)

        assert resp.status_code == 422
