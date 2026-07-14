"""
Integration tests for auth endpoints (task 7.4).

Full flow: registro → login → /api/me → refresh → logout.
Tests run against real Postgres via testcontainers + FastAPI TestClient.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng


@pytest.fixture(scope="module")
def int_client(engine, env_vars) -> TestClient:
    """
    Integration TestClient with DB override.

    Rate-limit store is reset so previous test modules don't bleed in.

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
    return f"int_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    """Generate a unique IP to avoid rate limit collisions between tests."""
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}"


class TestAuthFlow:
    """Full end-to-end auth flow."""

    def test_registro_returns_201_without_password_hash(self, int_client: TestClient):
        """Spec: registro returns 201 with user profile, no password_hash."""
        resp = int_client.post(
            "/api/auth/registro",
            json={"email": _unique_email(), "nombre": "Full Flow", "password": "testpass1"},
            headers={"X-Forwarded-For": _unique_ip()},
        )
        assert resp.status_code == 201
        data = resp.json()
        assert "password_hash" not in data
        assert "email" in data

    def test_registro_duplicate_email_returns_409(self, int_client: TestClient):
        """Spec: duplicate email → 409."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Dup", "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        resp = int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Dup2", "password": "testpass2"},
            headers={"X-Forwarded-For": ip},
        )
        assert resp.status_code == 409

    def test_registro_invalid_email_returns_422(self, int_client: TestClient):
        """Spec: malformed email → 422."""
        resp = int_client.post(
            "/api/auth/registro",
            json={"email": "not-an-email", "nombre": "Bad", "password": "testpass1"},
            headers={"X-Forwarded-For": _unique_ip()},
        )
        assert resp.status_code == 422

    def test_registro_short_password_returns_422(self, int_client: TestClient):
        """Spec: password < 8 chars → 422."""
        resp = int_client.post(
            "/api/auth/registro",
            json={"email": _unique_email(), "nombre": "Bad", "password": "short"},
            headers={"X-Forwarded-For": _unique_ip()},
        )
        assert resp.status_code == 422

    def test_login_success_sets_cookies(self, int_client: TestClient):
        """Spec: login sets access_token and refresh_token cookies."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Cookie", "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        resp = int_client.post(
            "/api/auth/login",
            json={"email": email, "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        assert resp.status_code == 200
        assert "access_token" in resp.cookies
        assert "refresh_token" in resp.cookies

    def test_login_wrong_credentials_returns_401(self, int_client: TestClient):
        """Spec: wrong password → 401 generic message."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Bad PW", "password": "correctpass"},
            headers={"X-Forwarded-For": ip},
        )
        resp = int_client.post(
            "/api/auth/login",
            json={"email": email, "password": "wrongpassword"},
            headers={"X-Forwarded-For": ip},
        )
        assert resp.status_code == 401

    def test_get_me_with_session_returns_profile(self, int_client: TestClient):
        """Spec: GET /api/me with valid cookie → profile without password_hash."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Me User", "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        login_resp = int_client.post(
            "/api/auth/login",
            json={"email": email, "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        access_token = login_resp.cookies.get("access_token")

        int_client.cookies.clear()
        int_client.cookies.set("access_token", access_token)
        me_resp = int_client.get("/api/me")
        int_client.cookies.clear()

        assert me_resp.status_code == 200
        data = me_resp.json()
        assert data["email"] == email
        assert "password_hash" not in data

    def test_get_me_without_session_returns_401(self, int_client: TestClient):
        """Spec: /api/me without auth → 401."""
        int_client.cookies.clear()
        resp = int_client.get("/api/me")
        assert resp.status_code == 401

    def test_refresh_issues_new_tokens(self, int_client: TestClient):
        """Spec: POST /api/auth/refresh with valid refresh cookie → new cookies."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Refresh", "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        login_resp = int_client.post(
            "/api/auth/login",
            json={"email": email, "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        old_refresh = login_resp.cookies.get("refresh_token")

        int_client.cookies.clear()
        int_client.cookies.set("refresh_token", old_refresh)
        refresh_resp = int_client.post("/api/auth/refresh")
        int_client.cookies.clear()

        assert refresh_resp.status_code == 200
        assert "access_token" in refresh_resp.cookies

    def test_logout_clears_cookies_and_revokes_refresh(self, int_client: TestClient):
        """Spec: logout → cookies cleared and refresh token is revoked."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Logout", "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        login_resp = int_client.post(
            "/api/auth/login",
            json={"email": email, "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        refresh_token_val = login_resp.cookies.get("refresh_token")

        # Logout
        int_client.cookies.clear()
        int_client.cookies.set("refresh_token", refresh_token_val)
        logout_resp = int_client.post("/api/auth/logout")
        int_client.cookies.clear()
        assert logout_resp.status_code == 204

        # After logout, the refresh token should be revoked (can no longer refresh)
        int_client.cookies.set("refresh_token", refresh_token_val)
        refresh_resp = int_client.post("/api/auth/refresh")
        int_client.cookies.clear()
        assert refresh_resp.status_code == 401

    def test_complete_flow(self, int_client: TestClient):
        """Spec: registro → login → /api/me → refresh → logout."""
        email = _unique_email()
        ip = _unique_ip()
        int_client.cookies.clear()

        # 1. Register
        r = int_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "Full Flow", "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        assert r.status_code == 201

        # 2. Login
        r = int_client.post(
            "/api/auth/login",
            json={"email": email, "password": "testpass1"},
            headers={"X-Forwarded-For": ip},
        )
        assert r.status_code == 200
        access_token = r.cookies.get("access_token")
        refresh_token_val = r.cookies.get("refresh_token")

        # 3. /api/me
        int_client.cookies.set("access_token", access_token)
        r = int_client.get("/api/me")
        assert r.status_code == 200
        assert r.json()["email"] == email
        int_client.cookies.clear()

        # 4. Refresh
        int_client.cookies.set("refresh_token", refresh_token_val)
        r = int_client.post("/api/auth/refresh")
        assert r.status_code == 200
        new_access_token = r.cookies.get("access_token")
        new_refresh_token = r.cookies.get("refresh_token")
        int_client.cookies.clear()

        # 5. /api/me with new access token
        int_client.cookies.set("access_token", new_access_token)
        r = int_client.get("/api/me")
        assert r.status_code == 200
        int_client.cookies.clear()

        # 6. Logout
        int_client.cookies.set("refresh_token", new_refresh_token)
        r = int_client.post("/api/auth/logout")
        int_client.cookies.clear()
        assert r.status_code == 204
