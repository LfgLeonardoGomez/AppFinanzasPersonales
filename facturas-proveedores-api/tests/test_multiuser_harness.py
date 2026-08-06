"""
Guard tests for the multi-user auth harness (c-22).

WHY THIS FILE EXISTS
--------------------
17 integration tests asserting regla dura #3 ("a resource belonging to another
user returns 404") were passing while verifying nothing, then started failing.
The application was never at fault. The tests were.

They simulated a second user with a hand-written header:

    token = login_resp.cookies.get("access_token")
    headers_b = {"Cookie": f"access_token={token}"}
    client.get(f"/api/pagos/{pago_a['id']}", headers=headers_b)

That is unsafe under cookie auth, in two independent ways:

1. `TestClient` (httpx) owns a persistent cookie jar. On write requests the jar
   wins over the explicit header, so a resource created with `headers=headers_a`
   is persisted with B's `usuario_id`. The "foreign" resource was never foreign;
   the endpoint correctly answered 200 and the `assert 404` failed.
2. The jar survives between tests sharing a module-scoped client, so a request
   meant to be anonymous arrives authenticated by an earlier test's login.

The fix is mechanical but easy to undo by accident: one client per identity,
session only in that client's own jar (`make_user_client` / `make_anon_client`
in conftest.py). These tests exist so that undoing it fails loudly here, with
an explanation, instead of silently draining the isolation suites of meaning
months from now.
"""

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_anon_client, make_user_client


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def harness_app(engine, env_vars):
    """The FastAPI app wired to the throwaway Postgres."""
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    # c-17: import get_db from a ROUTER module, never from app.core.deps.
    # test_deps.py does `del sys.modules["app.core.deps"]` and re-imports,
    # producing a NEW get_db object while the routers keep the OLD one. An
    # override keyed on the new object never matches, so requests fall through
    # to the lazy engine bound to a dead DSN (connection refused).
    from app.routers.pagos import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db
    # One context-managed client so the app's lifespan runs once for the module.
    with TestClient(app, raise_server_exceptions=True):
        yield app
    app.dependency_overrides.clear()


# ── The harness itself ────────────────────────────────────────────────────────


class TestUserClientFactory:
    """make_user_client must produce genuinely distinct, usable identities."""

    def test_each_client_is_a_distinct_user(self, harness_app):
        """Two users must never collapse into one identity."""
        client_a = make_user_client(harness_app, prefix="guard_a")
        client_b = make_user_client(harness_app, prefix="guard_b")

        assert client_a.usuario_id != client_b.usuario_id
        assert client_a.email != client_b.email

    def test_client_identity_matches_the_session_it_carries(self, harness_app):
        """The annotated usuario_id must be the one the API actually sees."""
        client = make_user_client(harness_app, prefix="guard_me")

        me = client.get("/api/me")

        assert me.status_code == 200
        assert me.json()["id"] == client.usuario_id

    def test_resources_are_owned_by_the_creating_client(self, harness_app):
        """The bug that started this: a write must be attributed to its client.

        Under the old header-based helper, a proveedor created "as A" came back
        owned by B, which is what made every cross-tenant assertion vacuous.
        """
        client_a = make_user_client(harness_app, prefix="guard_own_a")
        client_b = make_user_client(harness_app, prefix="guard_own_b")

        prov_a = client_a.post(
            "/api/proveedores", json={"nombre": "Prov A", "categoria": "OTRO"}
        )
        assert prov_a.status_code == 201

        # B must not be able to see it — proof the resource really belongs to A.
        assert client_b.get(f"/api/proveedores/{prov_a.json()['id']}").status_code == 404
        assert client_a.get(f"/api/proveedores/{prov_a.json()['id']}").status_code == 200


class TestAnonClient:
    """make_anon_client must not inherit a session from anywhere."""

    def test_anon_client_is_unauthenticated(self, harness_app):
        client = make_anon_client(harness_app)

        assert client.get("/api/me").status_code == 401

    def test_anon_client_stays_anonymous_after_another_user_logs_in(self, harness_app):
        """Order-independence: this is the exact 401 failure mode.

        `test_unauthenticated_returns_401` used to pass alone and fail inside
        its file because a previous test's login lingered in the shared jar.
        """
        make_user_client(harness_app, prefix="guard_noise")

        client = make_anon_client(harness_app)

        assert client.get("/api/me").status_code == 401
        assert client.get("/api/pagos").status_code == 401


# ── The pattern this change bans ──────────────────────────────────────────────


class TestRedirectThatCausedTheBugIsGone:
    """The mechanism behind the C-22 bug, and the guard that it stays removed.

    HISTORY — this class used to pin the failure mode itself. Collection routes
    were declared without a trailing slash, so `POST /api/proveedores/` answered
    307, and httpx rebuilt the redirected request from its own cookie jar,
    silently discarding an explicitly-set `Cookie` header. The legacy test
    helper used the trailing-slash form everywhere, so every "foreign resource"
    was in fact created by whoever logged in last, and 17 tenant-isolation tests
    passed for months while asserting nothing.

    c-27 removed the redirect at the source: collection routes now answer
    directly on both path forms. That deliberately invalidated the three tests
    that lived here, because they asserted the redirect and its consequences.
    They were not adjusted to fit — they were replaced, and this note records
    why, so nobody later reads a green suite and concludes the redirect was
    never a problem.

    What is still true, and still enforced elsewhere in this file:
    identity in tests comes from ONE CLIENT PER USER (`make_user_client`), and
    anonymous requests use a guaranteed-empty jar (`make_anon_client`). A
    hand-written `Cookie` header remains banned — not because of the redirect
    any more, but because the jar still leaks between tests sharing a client
    (see `TestAnonClient`), and because header-versus-jar precedence is httpx's
    behaviour to change, not a contract this suite should lean on. It has
    surprised this project once already.
    """

    def test_collection_routes_do_not_redirect(self, harness_app):
        """The regression guard: reintroducing the 307 brings the bug back.

        `tests/test_c27_no_redirect_collection_routes.py` covers every
        collection route in full. This one stays here, next to the story, so a
        future change that re-adds the redirect fails somewhere that explains
        what it costs.
        """
        client = make_user_client(harness_app, prefix="guard_redir")

        resp = client.post(
            "/api/proveedores/",
            json={"nombre": "Redirect probe", "categoria": "OTRO"},
            follow_redirects=False,
        )

        assert resp.status_code != 307, (
            "A collection route answered a redirect again. On a redirect, HTTP "
            "clients rebuild the request and can drop headers set on the "
            "original — which is exactly how writes were attributed to the "
            "wrong user before c-27."
        )
        assert resp.status_code == 201

    def test_the_bare_path_answers_identically(self, harness_app):
        """Both path forms must behave the same, or the ambiguity is still there."""
        client = make_user_client(harness_app, prefix="guard_bare")

        resp = client.post(
            "/api/proveedores",
            json={"nombre": "Bare path probe", "categoria": "OTRO"},
            follow_redirects=False,
        )

        assert resp.status_code == 201


# ── Regla dura #3, asserted with trustworthy identities ───────────────────────


class TestTenantIsolationBaseline:
    """The guarantee the broken tests claimed to protect, verified properly."""

    def test_foreign_pago_is_404_across_every_verb(self, harness_app):
        from datetime import date

        client_a = make_user_client(harness_app, prefix="guard_iso_a")
        client_b = make_user_client(harness_app, prefix="guard_iso_b")

        prov = client_a.post(
            "/api/proveedores", json={"nombre": "P", "categoria": "OTRO"}
        ).json()
        pago = client_a.post(
            "/api/pagos",
            json={
                "proveedor_id": prov["id"],
                "monto": "100.00",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
            },
        ).json()

        assert pago["usuario_id"] == client_a.usuario_id

        assert client_b.get(f"/api/pagos/{pago['id']}").status_code == 404
        assert client_b.patch(
            f"/api/pagos/{pago['id']}", json={"monto": "1.00"}
        ).status_code == 404
        assert client_b.delete(f"/api/pagos/{pago['id']}").status_code == 404

    def test_listings_are_scoped_to_the_requesting_user(self, harness_app):
        from datetime import date

        client_a = make_user_client(harness_app, prefix="guard_list_a")
        client_b = make_user_client(harness_app, prefix="guard_list_b")

        prov = client_a.post(
            "/api/proveedores", json={"nombre": "P", "categoria": "OTRO"}
        ).json()
        client_a.post(
            "/api/pagos",
            json={
                "proveedor_id": prov["id"],
                "monto": "100.00",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
            },
        )

        assert client_a.get("/api/pagos").json()["total"] == 1
        assert client_b.get("/api/pagos").json()["total"] == 0

    def test_nonexistent_and_foreign_are_indistinguishable(self, harness_app):
        """404 for both — never 403, which would leak existence."""
        client = make_user_client(harness_app, prefix="guard_enum")

        resp = client.get(f"/api/pagos/{uuid.uuid4()}")

        assert resp.status_code == 404
