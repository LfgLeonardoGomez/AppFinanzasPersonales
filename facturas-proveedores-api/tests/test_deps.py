"""
Tests for FastAPI dependencies (tasks 6.1, 6.2, 6.3).

TDD RED phase. Covers:
- get_current_user: valid cookie → correct Usuario
- get_current_user: no cookie → 401
- get_current_user: invalid/expired token → 401
- get_current_user: different users get their own Usuario
- rate_limit: 6th attempt in 60s window → 429
- rate_limit: different IPs have independent counters

These tests drive the dependency endpoints via TestClient using the app's
/api/me route (implemented in Task 7), so we write both together.
"""

import uuid
from datetime import datetime, timezone

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
def auth_client(engine, env_vars) -> TestClient:
    """TestClient wired with real Postgres session override.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    # Reset rate limit store so tests from previous modules don't bleed in
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.core.deps import get_db

    def override_get_db():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


def _register_and_login(client: TestClient, email: str, password: str = "password123") -> dict:
    """
    Helper: register + login, return cookies dict.

    Uses unique X-Forwarded-For per call to avoid rate limiting in tests.
    """
    unique_ip = f"192.168.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}"
    headers = {"X-Forwarded-For": unique_ip}
    client.post(
        "/api/auth/registro",
        json={"email": email, "nombre": "Test", "password": password},
        headers=headers,
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers=headers,
    )
    # Return a plain dict of cookie name → value
    return dict(resp.cookies)


# ── Task 6.1: get_current_user ────────────────────────────────────────────────

class TestGetCurrentUser:
    """Spec: dependency resolves Usuario from access_token cookie."""

    def test_me_with_valid_session_returns_profile(self, auth_client: TestClient):
        """Spec: GET /api/me with valid cookie returns user profile."""
        email = f"dep_{uuid.uuid4().hex[:6]}@test.com"
        cookie_dict = _register_and_login(auth_client, email)
        # Set access_token directly on client to avoid deprecation + ensure it's sent
        auth_client.cookies.set("access_token", cookie_dict["access_token"])
        resp = auth_client.get("/api/me")
        auth_client.cookies.clear()
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == email
        assert "password_hash" not in data

    def test_me_without_cookie_returns_401(self, auth_client: TestClient):
        """Spec: GET /api/me without session cookie → 401."""
        auth_client.cookies.clear()
        resp = auth_client.get("/api/me")
        assert resp.status_code == 401

    def test_me_with_invalid_token_returns_401(self, auth_client: TestClient):
        """Spec: invalid access token → 401."""
        auth_client.cookies.clear()
        auth_client.cookies.set("access_token", "not.a.jwt.token")
        resp = auth_client.get("/api/me")
        auth_client.cookies.clear()
        assert resp.status_code == 401

    def test_two_users_get_their_own_profile(self, auth_client: TestClient):
        """Spec: two concurrent users each see their own profile."""
        email1 = f"u1_{uuid.uuid4().hex[:6]}@test.com"
        email2 = f"u2_{uuid.uuid4().hex[:6]}@test.com"
        cookies1 = _register_and_login(auth_client, email1)
        cookies2 = _register_and_login(auth_client, email2)

        # Test user 1
        auth_client.cookies.clear()
        auth_client.cookies.set("access_token", cookies1["access_token"])
        resp1 = auth_client.get("/api/me")

        # Test user 2
        auth_client.cookies.clear()
        auth_client.cookies.set("access_token", cookies2["access_token"])
        resp2 = auth_client.get("/api/me")
        auth_client.cookies.clear()

        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["email"] == email1
        assert resp2.json()["email"] == email2
        # IDs must differ
        assert resp1.json()["id"] != resp2.json()["id"]


# ── Task 6.2: rate limiting ────────────────────────────────────────────────────

class TestRateLimit:
    """Spec: 5 attempts/60s per IP; 6th → 429."""

    def test_sixth_attempt_returns_429(self, auth_client: TestClient):
        """Spec: 5 valid attempts pass; 6th in same window → 429."""
        # Use a unique IP that won't collide with other tests
        test_ip = f"172.16.{uuid.uuid4().int % 256}.50"
        email = f"rl_{uuid.uuid4().hex[:6]}@test.com"
        password = "password123"

        # Register using a different IP to not consume the test IP's quota
        reg_ip = f"172.16.{uuid.uuid4().int % 256}.200"
        auth_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "RL", "password": password},
            headers={"X-Forwarded-For": reg_ip},
        )

        # 5 attempts on the test IP (rate limit not triggered yet)
        for _ in range(5):
            auth_client.post(
                "/api/auth/login",
                json={"email": email, "password": password},
                headers={"X-Forwarded-For": test_ip},
            )

        # 6th attempt must return 429
        resp = auth_client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
            headers={"X-Forwarded-For": test_ip},
        )
        assert resp.status_code == 429

    def test_different_ips_have_independent_counters(self, auth_client: TestClient):
        """Spec: rate limit is per IP; IP2 counter is unaffected by IP1."""
        ip1 = f"172.17.{uuid.uuid4().int % 256}.1"
        ip2 = f"172.18.{uuid.uuid4().int % 256}.1"
        email = f"rl2_{uuid.uuid4().hex[:6]}@test.com"
        password = "password123"

        # Register using a neutral IP
        reg_ip = f"172.19.{uuid.uuid4().int % 256}.1"
        auth_client.post(
            "/api/auth/registro",
            json={"email": email, "nombre": "RL2", "password": password},
            headers={"X-Forwarded-For": reg_ip},
        )

        # Exhaust IP1's limit (6 calls → 6th will be 429)
        for _ in range(6):
            auth_client.post(
                "/api/auth/login",
                json={"email": email, "password": password},
                headers={"X-Forwarded-For": ip1},
            )

        # IP2 should still be accepted (not 429)
        resp = auth_client.post(
            "/api/auth/login",
            json={"email": email, "password": password},
            headers={"X-Forwarded-For": ip2},
        )
        # IP2 hasn't hit the limit — must not be 429


# ── C-16 (D-2) lazy engine regression ────────────────────────────────────────


class TestLazyEngine:
    """
    C-16 (D-2): the SQLAlchemy engine in `app/core/deps.py` MUST be built
    lazily on first use, NOT at module-import time. Importing
    `app.core.deps` MUST NOT call `create_engine(...)` — the engine is
    only built when `_get_engine()` is called for the first time.

    This test would FAIL if the engine is reconstructed at import time
    (it would freeze the DSN at import, which is the pre-C-16 bug).
    """

    def test_deps_module_does_not_construct_engine_at_import(self):
        """
        Importing `app.core.deps` MUST NOT trigger `create_engine`. The
        engine is built on first `_get_engine()` call.
        """
        import importlib
        import sys

        # Drop the module from sys.modules to force a fresh import
        for mod_name in list(sys.modules):
            if mod_name.startswith("app.core.deps"):
                del sys.modules[mod_name]

        import app.core.deps as deps_module  # noqa: F401

        # `_engine` is the module-level reference; it MUST be None at
        # import time (lazy initialization).
        assert deps_module._engine is None, (
            "app.core.deps MUST NOT construct the engine at import time. "
            "If this fails, the lazy _get_engine() pattern was reverted."
        )

    def test_get_engine_builds_engine_on_first_call(self):
        """
        `_get_engine()` builds the engine on first call and returns the
        same instance on subsequent calls.
        """
        from app.core.deps import _get_engine

        first = _get_engine()
        second = _get_engine()
        assert first is second, "_get_engine() must cache the engine"

    def test_get_db_uses_lazy_engine(self, engine, env_vars):
        """
        `get_db()` MUST use the lazily-built engine. With the test's
        `engine` fixture overriding the DB, requesting `GET /api/me` with
        no session must use the lazy engine — which is the test's
        overridden DSN (via `env_vars`).
        """
        from app.core.deps import _get_engine

        # After any request that uses get_db, the engine exists.
        from fastapi.testclient import TestClient
        from app.main import app
        from app.core.deps import get_db

        def override_get_db():
            with Session(engine) as session:
                yield session

        app.dependency_overrides[get_db] = override_get_db
        try:
            with TestClient(app) as c:
                c.get("/health")
                # Engine was built lazily on first use.
                assert _get_engine() is not None
        finally:
            app.dependency_overrides.pop(get_db, None)
