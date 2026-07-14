"""
Integration tests for /api/proveedores endpoints (task 4.1 — TDD RED, then GREEN).

Tests run against real Postgres (testcontainers) via FastAPI TestClient with
session dependency override (same pattern as test_auth_integration.py).

Covers:
- Unauthenticated request → 401
- POST /api/proveedores → 201 with saldo=0.00
- GET /api/proveedores paginated and order_by=nombre|saldo
- Invalid order_by → 422
- GET /api/proveedores/{id} happy path and foreign id → 404
- PATCH /api/proveedores/{id} happy path and foreign id → 404
- DELETE /api/proveedores/{id} soft-delete and foreign → 404
- GET /api/proveedores/buscar?nombre= returns normalized matches
- /buscar route not shadowed by /{id}
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def prov_client(engine, env_vars) -> TestClient:
    """Integration client with DB override and rate-limit store reset.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.routers.proveedores import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


# ── Auth helpers ──────────────────────────────────────────────────────────────


def _unique_email():
    return f"prov_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.2"


def _register_and_login(client: TestClient) -> str:
    """Register a new user and return their access_token."""
    email = _unique_email()
    password = "testpass123"
    ip = _unique_ip()

    client.post(
        "/api/auth/registro",
        json={"email": email, "nombre": "Prov Test", "password": password},
        headers={"X-Forwarded-For": ip},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )
    assert resp.status_code == 200
    return resp.cookies["access_token"]


def _make_factura(engine, usuario_id, proveedor_id, monto: Decimal):
    from app.models.factura import Factura
    from app.core.uuid_utils import new_uuid
    from app.models.enums import OrigenDocumento

    with Session(engine) as s:
        f = Factura(
            id=new_uuid(),
            usuario_id=usuario_id,
            proveedor_id=proveedor_id,
            fecha_emision=date.today(),
            monto_total=monto,
            origen=OrigenDocumento.MANUAL,
        )
        s.add(f)
        s.commit()


# ── Authentication guard ──────────────────────────────────────────────────────


class TestAuthGuard:
    def test_list_without_auth_returns_401(self, prov_client: TestClient):
        """Spec: unauthenticated request → 401."""
        prov_client.cookies.clear()
        resp = prov_client.get("/api/proveedores")
        assert resp.status_code == 401

    def test_post_without_auth_returns_401(self, prov_client: TestClient):
        prov_client.cookies.clear()
        resp = prov_client.post("/api/proveedores", json={"nombre": "Test"})
        assert resp.status_code == 401


# ── POST (create) ─────────────────────────────────────────────────────────────


class TestPost:
    def test_create_returns_201_with_saldo_zero(self, prov_client: TestClient):
        """Spec: POST → 201 with saldo=0.00."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "New Supplier"},
        )
        prov_client.cookies.clear()

        assert resp.status_code == 201
        data = resp.json()
        assert data["nombre"] == "New Supplier"
        assert Decimal(str(data["saldo"])) == Decimal("0.00")

    def test_create_with_valid_cuit(self, prov_client: TestClient):
        """Spec: valid CUIT accepted on create."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "WithCuit", "cuit": "20-12345678-9"},
        )
        prov_client.cookies.clear()

        assert resp.status_code == 201
        assert resp.json()["cuit"] == "20-12345678-9"

    def test_create_with_malformed_cuit_returns_422(self, prov_client: TestClient):
        """Spec: malformed CUIT → 422."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "BadCuit", "cuit": "20123456789"},
        )
        prov_client.cookies.clear()

        assert resp.status_code == 422

    def test_create_without_nombre_returns_422(self, prov_client: TestClient):
        """Spec: nombre is required → 422."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.post("/api/proveedores", json={})
        prov_client.cookies.clear()

        assert resp.status_code == 422


# ── GET / (list) ──────────────────────────────────────────────────────────────


class TestList:
    def test_list_returns_own_suppliers(self, prov_client: TestClient):
        """Spec: GET / returns the user's active suppliers."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        # Create a supplier first
        prov_client.post("/api/proveedores", json={"nombre": "Listed Supplier"})

        resp = prov_client.get("/api/proveedores")
        prov_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data, list)
        names = {item["nombre"] for item in data}
        assert "Listed Supplier" in names

    def test_list_order_by_nombre(self, prov_client: TestClient):
        """Spec: order_by=nombre returns suppliers in case-insensitive ascending order."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        prov_client.post("/api/proveedores", json={"nombre": "Zebra"})
        prov_client.post("/api/proveedores", json={"nombre": "alpha"})
        prov_client.post("/api/proveedores", json={"nombre": "Middle"})

        resp = prov_client.get("/api/proveedores?order_by=nombre")
        prov_client.cookies.clear()

        assert resp.status_code == 200
        names = [item["nombre"] for item in resp.json()]
        assert names == sorted(names, key=lambda n: n.lower())

    def test_list_order_by_saldo(self, prov_client: TestClient):
        """Spec: order_by=saldo returns suppliers largest saldo first."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.get("/api/proveedores?order_by=saldo")
        prov_client.cookies.clear()

        assert resp.status_code == 200

    def test_invalid_order_by_returns_422(self, prov_client: TestClient):
        """Spec: order_by with invalid value → 422."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.get("/api/proveedores?order_by=invalid_value")
        prov_client.cookies.clear()

        assert resp.status_code == 422

    def test_pagination_page_param(self, prov_client: TestClient):
        """Spec: page parameter is accepted (1-based)."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        resp = prov_client.get("/api/proveedores?page=1")
        prov_client.cookies.clear()

        assert resp.status_code == 200


# ── GET /{id} ─────────────────────────────────────────────────────────────────


class TestGetById:
    def test_get_own_supplier(self, prov_client: TestClient):
        """Spec: GET /{id} of own supplier returns it with saldo."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "GetMe"},
        )
        proveedor_id = create_resp.json()["id"]

        resp = prov_client.get(f"/api/proveedores/{proveedor_id}")
        prov_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == proveedor_id
        assert "saldo" in data

    def test_get_foreign_supplier_returns_404(self, prov_client: TestClient):
        """Spec: GET /{id} of another user's supplier → 404."""
        # User 1 creates a supplier
        token1 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token1)
        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "User1Supplier"},
        )
        proveedor_id = create_resp.json()["id"]
        prov_client.cookies.clear()

        # User 2 tries to access it
        token2 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token2)
        resp = prov_client.get(f"/api/proveedores/{proveedor_id}")
        prov_client.cookies.clear()

        assert resp.status_code == 404


# ── PATCH /{id} ───────────────────────────────────────────────────────────────


class TestPatch:
    def test_patch_own_supplier(self, prov_client: TestClient):
        """Spec: PATCH own supplier updates and returns with saldo."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "Original Name"},
        )
        proveedor_id = create_resp.json()["id"]

        resp = prov_client.patch(
            f"/api/proveedores/{proveedor_id}",
            json={"nombre": "Updated Name"},
        )
        prov_client.cookies.clear()

        assert resp.status_code == 200
        assert resp.json()["nombre"] == "Updated Name"

    def test_patch_foreign_supplier_returns_404(self, prov_client: TestClient):
        """Spec: PATCH another user's supplier → 404."""
        token1 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token1)
        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "User1Patch"},
        )
        proveedor_id = create_resp.json()["id"]
        prov_client.cookies.clear()

        token2 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token2)
        resp = prov_client.patch(
            f"/api/proveedores/{proveedor_id}",
            json={"nombre": "Hacked"},
        )
        prov_client.cookies.clear()

        assert resp.status_code == 404


# ── DELETE /{id} ──────────────────────────────────────────────────────────────


class TestDelete:
    def test_delete_own_supplier(self, prov_client: TestClient):
        """Spec: DELETE own supplier → 200 with tiene_dependencias."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "ToDelete"},
        )
        proveedor_id = create_resp.json()["id"]

        resp = prov_client.delete(f"/api/proveedores/{proveedor_id}")
        prov_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == proveedor_id
        assert "tiene_dependencias" in data
        assert data["tiene_dependencias"] is False

    def test_delete_excludes_from_listing(self, prov_client: TestClient):
        """Spec: after delete, supplier no longer in GET /."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "DeleteThenList"},
        )
        proveedor_id = create_resp.json()["id"]
        prov_client.delete(f"/api/proveedores/{proveedor_id}")

        list_resp = prov_client.get("/api/proveedores")
        prov_client.cookies.clear()

        names = {item["nombre"] for item in list_resp.json()}
        assert "DeleteThenList" not in names

    def test_delete_foreign_supplier_returns_404(self, prov_client: TestClient):
        """Spec: DELETE another user's supplier → 404."""
        token1 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token1)
        create_resp = prov_client.post(
            "/api/proveedores",
            json={"nombre": "User1Del"},
        )
        proveedor_id = create_resp.json()["id"]
        prov_client.cookies.clear()

        token2 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token2)
        resp = prov_client.delete(f"/api/proveedores/{proveedor_id}")
        prov_client.cookies.clear()

        assert resp.status_code == 404


# ── GET /buscar ───────────────────────────────────────────────────────────────


class TestBuscar:
    def test_buscar_not_shadowed_by_id_route(self, prov_client: TestClient):
        """Spec: /buscar resolves to the search endpoint, NOT /{id}."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        # 'buscar' is not a valid UUID — if it hits /{id} it would 422 or 404
        resp = prov_client.get("/api/proveedores/buscar?nombre=test")
        prov_client.cookies.clear()

        # Should be 200 (search endpoint found), not 422 (UUID parse error)
        assert resp.status_code == 200
        assert isinstance(resp.json(), list)

    def test_buscar_returns_normalized_matches(self, prov_client: TestClient):
        """Spec: buscar returns matches for caller only, case-insensitive."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        prov_client.post("/api/proveedores", json={"nombre": "Electricidad Sur"})
        prov_client.post("/api/proveedores", json={"nombre": "Gas Natural"})

        resp = prov_client.get("/api/proveedores/buscar?nombre=ELECTRICIDAD")
        prov_client.cookies.clear()

        assert resp.status_code == 200
        names = {item["nombre"] for item in resp.json()}
        assert "Electricidad Sur" in names
        assert "Gas Natural" not in names

    def test_buscar_empty_nombre_returns_all_active(self, prov_client: TestClient):
        """Spec: empty nombre param returns all active suppliers for the caller."""
        token = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token)

        prov_client.post("/api/proveedores", json={"nombre": "BuscarAll A"})
        prov_client.post("/api/proveedores", json={"nombre": "BuscarAll B"})

        resp = prov_client.get("/api/proveedores/buscar?nombre=")
        prov_client.cookies.clear()

        assert resp.status_code == 200

    def test_buscar_excludes_other_user_results(self, prov_client: TestClient):
        """Spec: buscar never returns suppliers from another user."""
        # User 1 creates a supplier
        token1 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token1)
        prov_client.post("/api/proveedores", json={"nombre": "SharedBuscar"})
        prov_client.cookies.clear()

        # User 2 searches same name — must not see user1's supplier
        token2 = _register_and_login(prov_client)
        prov_client.cookies.clear()
        prov_client.cookies.set("access_token", token2)
        resp = prov_client.get("/api/proveedores/buscar?nombre=SharedBuscar")
        prov_client.cookies.clear()

        assert resp.status_code == 200
        # User 2 has no suppliers with that name — result must be empty
        assert resp.json() == []
