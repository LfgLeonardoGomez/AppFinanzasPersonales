"""
c-27 (item C): collection routes must answer directly on both path forms.

TDD RED first: with redirects disabled, `POST /api/pagos/` (and the same for
facturas and proveedores) currently answers 307, redirecting to the
bare-path form. That redirect is not cosmetic (design.md D1; C-22): on a
redirect, httpx rebuilds the request from its own cookie jar and drops an
explicitly-set `Cookie` header — which is exactly what made the old
multi-user test harness attribute writes to the wrong user for months (see
tests/test_multiuser_harness.py).

This file asserts:
- Both `/api/<recurso>` and `/api/<recurso>/` answer directly — no 3xx
  anywhere in the exchange (C.1, C.2).
- Ownership and validation status codes (401/404/422) are unaffected by
  which path form is used (C.4).
- The generated OpenAPI document lists each collection operation exactly
  once, so registering both paths does not duplicate operations for
  openapi-typescript (C.5).

Item routes (`/{id}`) are out of scope — they carry a path parameter and
never had the trailing-slash ambiguity.
"""

import uuid
from datetime import date

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
def c27_app(engine, env_vars):
    """The app wired to the throwaway Postgres, with the rate-limit store reset.

    Overrides `get_db` on all three routers touched by this item (pagos,
    facturas, proveedores) — one test module exercising all of them, same
    pattern as test_pago_integration.py / test_factura_integration.py.
    """
    from app.core.deps import reset_rate_limit_store

    reset_rate_limit_store()

    from app.main import app
    from app.routers.facturas import get_db as facturas_get_db
    from app.routers.pagos import get_db as pagos_get_db
    from app.routers.proveedores import get_db as proveedores_get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[pagos_get_db] = override_get_db
    app.dependency_overrides[facturas_get_db] = override_get_db
    app.dependency_overrides[proveedores_get_db] = override_get_db

    # One context-managed client so the app's lifespan runs once per module.
    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


@pytest.fixture
def user(c27_app) -> TestClient:
    """A logged-in client; its session lives only in its own cookie jar."""
    return make_user_client(c27_app, prefix="c27")


@pytest.fixture
def other_user(c27_app) -> TestClient:
    """A second, independent logged-in client (for cross-tenant checks)."""
    return make_user_client(c27_app, prefix="c27b")


# ── Payload helpers ──────────────────────────────────────────────────────────


def _create_proveedor(client: TestClient) -> dict:
    resp = client.post(
        "/api/proveedores",
        json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
    )
    assert resp.status_code == 201
    return resp.json()


def _pago_payload(proveedor_id: str) -> dict:
    return {
        "proveedor_id": proveedor_id,
        "monto": "100.00",
        "fecha": date.today().isoformat(),
        "metodo": "EFECTIVO",
    }


def _factura_payload(proveedor_id: str) -> dict:
    return {
        "proveedor_id": proveedor_id,
        "fecha_emision": date.today().isoformat(),
        "monto_total": "150.00",
    }


COLLECTION_PATHS = {
    "pagos": ("/api/pagos", "/api/pagos/"),
    "facturas": ("/api/facturas", "/api/facturas/"),
    "proveedores": ("/api/proveedores", "/api/proveedores/"),
}


# ── C.1 / C.2 — no redirect on either path form ────────────────────────────────


class TestNoRedirectOnCollectionRoutes:
    """POST/GET must answer directly on `""` and `"/"` — no 3xx anywhere."""

    @pytest.mark.parametrize("path", COLLECTION_PATHS["pagos"])
    def test_post_pagos_answers_directly(self, user, path):
        proveedor = _create_proveedor(user)

        resp = user.post(
            path, json=_pago_payload(proveedor["id"]), follow_redirects=False
        )

        assert resp.status_code == 201

    @pytest.mark.parametrize("path", COLLECTION_PATHS["pagos"])
    def test_get_pagos_answers_directly(self, user, path):
        resp = user.get(path, follow_redirects=False)

        assert resp.status_code == 200

    @pytest.mark.parametrize("path", COLLECTION_PATHS["facturas"])
    def test_post_facturas_answers_directly(self, user, path):
        proveedor = _create_proveedor(user)

        resp = user.post(
            path, json=_factura_payload(proveedor["id"]), follow_redirects=False
        )

        assert resp.status_code == 201

    @pytest.mark.parametrize("path", COLLECTION_PATHS["facturas"])
    def test_get_facturas_answers_directly(self, user, path):
        resp = user.get(path, follow_redirects=False)

        assert resp.status_code == 200

    @pytest.mark.parametrize("path", COLLECTION_PATHS["proveedores"])
    def test_post_proveedores_answers_directly(self, user, path):
        resp = user.post(
            path,
            json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
            follow_redirects=False,
        )

        assert resp.status_code == 201

    @pytest.mark.parametrize("path", COLLECTION_PATHS["proveedores"])
    def test_get_proveedores_answers_directly(self, user, path):
        resp = user.get(path, follow_redirects=False)

        assert resp.status_code == 200


# ── C.4 — ownership and validation are unaffected by path form ────────────────


class TestOwnershipAndValidationUnaffectedByPathForm:
    """401/404/422 must be identical on both path forms — only the redirect goes."""

    @pytest.mark.parametrize(
        "path",
        COLLECTION_PATHS["pagos"] + COLLECTION_PATHS["facturas"] + COLLECTION_PATHS["proveedores"],
    )
    def test_unauthenticated_get_returns_401(self, c27_app, path):
        anon = make_anon_client(c27_app)

        resp = anon.get(path, follow_redirects=False)

        assert resp.status_code == 401

    @pytest.mark.parametrize("path", COLLECTION_PATHS["pagos"])
    def test_post_pago_with_foreign_proveedor_returns_404(self, user, other_user, path):
        foreign_proveedor = _create_proveedor(other_user)

        resp = user.post(
            path, json=_pago_payload(foreign_proveedor["id"]), follow_redirects=False
        )

        assert resp.status_code == 404

    @pytest.mark.parametrize("path", COLLECTION_PATHS["pagos"])
    def test_post_pago_with_invalid_monto_returns_422(self, user, path):
        proveedor = _create_proveedor(user)
        payload = _pago_payload(proveedor["id"])
        payload["monto"] = "0.00"

        resp = user.post(path, json=payload, follow_redirects=False)

        assert resp.status_code == 422

    @pytest.mark.parametrize("path", COLLECTION_PATHS["proveedores"])
    def test_get_proveedores_with_invalid_order_by_returns_422(self, user, path):
        resp = user.get(path, params={"order_by": "not-a-real-field"}, follow_redirects=False)

        assert resp.status_code == 422


# ── C.5 — the OpenAPI document stays single-valued ─────────────────────────────


class TestOpenAPISchemaStaysSingleValued:
    """Registering both path forms must not duplicate operations in the schema."""

    def test_collection_operations_appear_once(self, client):
        schema = client.get("/openapi.json").json()
        paths = schema["paths"]

        for base, (bare, slash) in COLLECTION_PATHS.items():
            assert bare in paths, f"{bare} missing from the OpenAPI schema"
            assert slash not in paths, (
                f"{slash} must not appear as its own OpenAPI path — the "
                "trailing-slash route must be registered with "
                "include_in_schema=False so generated clients see one "
                f"operation for {base}, not two"
            )
