"""
Integration tests for /api/pagos endpoints (Task 5.1 — TDD RED, then GREEN).

Tests run against real Postgres (testcontainers) via FastAPI TestClient with
session dependency override (same pattern as test_factura_integration.py).

Covers:
- Unauthenticated → 401
- POST /api/pagos → 201 with full PagoResponse body
- POST /api/pagos with factura_id → 422 (RN-PAG-01 triple enforcement)
- POST /api/pagos with future fecha → 422
- POST /api/pagos with monto <= 0 → 422
- POST /api/pagos with foreign proveedor_id → 404
- GET /api/pagos → list
- GET /api/pagos?proveedor_id=<own> → filtered list
- GET /api/pagos?proveedor_id=<foreign> → 404
- GET /api/pagos/{id} (own) → 200
- GET /api/pagos/{id} (foreign) → 404
- PATCH /api/pagos/{id} → 200, fields updated
- PATCH /api/pagos/{id} with factura_id → 422
- PATCH /api/pagos/{id} (foreign) → 404
- DELETE /api/pagos/{id} → 204
- DELETE /api/pagos/{id} (foreign) → 404
- DELETE /api/pagos/{id} (already soft-deleted) → 404
"""

import uuid
from datetime import date, timedelta
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
def pago_client(engine, env_vars) -> TestClient:
    """Integration client with DB override and rate-limit store reset.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.routers.pagos import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


# ── Auth helpers ──────────────────────────────────────────────────────────────


def _unique_email():
    return f"pago_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.7"


def _register_and_login(client: TestClient) -> tuple[str, dict]:
    """Register a new user and return (access_token, headers)."""
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
    return token, {"Cookie": f"access_token={token}"}


def _create_proveedor(client: TestClient, headers: dict) -> dict:
    resp = client.post(
        "/api/proveedores/",
        json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _create_pago(
    client: TestClient,
    headers: dict,
    proveedor_id: str,
    monto: str = "100.00",
    fecha: str | None = None,
) -> dict:
    resp = client.post(
        "/api/pagos/",
        json={
            "proveedor_id": proveedor_id,
            "monto": monto,
            "fecha": fecha or date.today().isoformat(),
            "metodo": "EFECTIVO",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


# ── Unauthenticated ───────────────────────────────────────────────────────────


class TestUnauthenticated:
    def test_list_requires_auth(self, pago_client: TestClient):
        resp = pago_client.get("/api/pagos/")
        assert resp.status_code == 401

    def test_create_requires_auth(self, pago_client: TestClient):
        resp = pago_client.post("/api/pagos/", json={})
        assert resp.status_code == 401

    def test_get_requires_auth(self, pago_client: TestClient):
        resp = pago_client.get(f"/api/pagos/{uuid.uuid4()}")
        assert resp.status_code == 401

    def test_patch_requires_auth(self, pago_client: TestClient):
        resp = pago_client.patch(f"/api/pagos/{uuid.uuid4()}", json={})
        assert resp.status_code == 401

    def test_delete_requires_auth(self, pago_client: TestClient):
        resp = pago_client.delete(f"/api/pagos/{uuid.uuid4()}")
        assert resp.status_code == 401


# ── POST /api/pagos ───────────────────────────────────────────────────────────


class TestCreatePago:
    def test_create_minimal_pago(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "500.00",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
            },
            headers=headers,
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["monto"] == "500.00"
        assert data["origen"] == "MANUAL"
        assert data["comprobante_url"] is None
        assert data["metodo"] == "EFECTIVO"
        assert data["usuario_id"] is not None
        assert data["proveedor_id"] == prov["id"]

    def test_create_with_comprobante_url(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "250.00",
                "fecha": date.today().isoformat(),
                "metodo": "TRANSFERENCIA",
                "comprobante_url": "https://example.com/x.pdf",
            },
            headers=headers,
        )

        assert resp.status_code == 201
        assert resp.json()["comprobante_url"] == "https://example.com/x.pdf"

    def test_create_with_factura_id_rejected_422(self, pago_client: TestClient):
        """RN-PAG-01: schema's extra=forbid rejects factura_id at the wire."""
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "100.00",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
                "factura_id": str(uuid.uuid4()),
            },
            headers=headers,
        )

        assert resp.status_code == 422
        assert "factura_id" in str(resp.json()).lower()

    def test_create_future_fecha_rejected_422(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "100.00",
                "fecha": (date.today() + timedelta(days=1)).isoformat(),
                "metodo": "EFECTIVO",
            },
            headers=headers,
        )

        assert resp.status_code == 422

    def test_create_monto_zero_rejected_422(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "0",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
            },
            headers=headers,
        )

        assert resp.status_code == 422

    def test_create_monto_negative_rejected_422(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "-50.00",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
            },
            headers=headers,
        )

        assert resp.status_code == 422

    def test_create_invalid_metodo_rejected_422(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov["id"],
                "monto": "100.00",
                "fecha": date.today().isoformat(),
                "metodo": "CRIPTOMONEDA",
            },
            headers=headers,
        )

        assert resp.status_code == 422

    def test_create_foreign_proveedor_returns_404(self, pago_client: TestClient):
        _, headers_a = _register_and_login(pago_client)
        _, headers_b = _register_and_login(pago_client)
        prov_b = _create_proveedor(pago_client, headers_b)

        resp = pago_client.post(
            "/api/pagos/",
            json={
                "proveedor_id": prov_b["id"],
                "monto": "100.00",
                "fecha": date.today().isoformat(),
                "metodo": "EFECTIVO",
            },
            headers=headers_a,
        )

        assert resp.status_code == 404


# ── GET /api/pagos ────────────────────────────────────────────────────────────


class TestListPagos:
    def test_list_returns_user_pagos(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        _create_pago(pago_client, headers, prov["id"], "100.00")
        _create_pago(pago_client, headers, prov["id"], "200.00")

        resp = pago_client.get("/api/pagos/", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        # Spec mandates the paginated envelope {items, total, page, page_size}.
        assert isinstance(data, dict)
        assert {"items", "total", "page", "page_size"} <= set(data)
        # User is freshly registered and created exactly 2 pagos (isolated by usuario_id).
        assert data["total"] == 2
        items = data["items"]
        assert len(items) == 2

    def test_list_filters_by_proveedor(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov1 = _create_proveedor(pago_client, headers)
        prov2 = _create_proveedor(pago_client, headers)
        _create_pago(pago_client, headers, prov1["id"], "100.00")
        _create_pago(pago_client, headers, prov2["id"], "200.00")

        resp = pago_client.get(
            "/api/pagos/",
            params={"proveedor_id": prov1["id"]},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        if isinstance(data, dict) and "items" in data:
            items = data["items"]
        else:
            items = data
        for item in items:
            assert item["proveedor_id"] == prov1["id"]

    def test_list_foreign_proveedor_returns_404(self, pago_client: TestClient):
        _, headers_a = _register_and_login(pago_client)
        _, headers_b = _register_and_login(pago_client)
        prov_b = _create_proveedor(pago_client, headers_b)

        resp = pago_client.get(
            "/api/pagos/",
            params={"proveedor_id": prov_b["id"]},
            headers=headers_a,
        )
        assert resp.status_code == 404

    def test_list_user_isolation(self, pago_client: TestClient):
        _, headers_a = _register_and_login(pago_client)
        _, headers_b = _register_and_login(pago_client)
        prov_a = _create_proveedor(pago_client, headers_a)
        pago_a = _create_pago(pago_client, headers_a, prov_a["id"])

        resp = pago_client.get("/api/pagos/", headers=headers_b)
        assert resp.status_code == 200
        data = resp.json()
        if isinstance(data, dict) and "items" in data:
            items = data["items"]
        else:
            items = data
        ids = [p["id"] for p in items]
        assert pago_a["id"] not in ids


# ── GET /api/pagos/{id} ───────────────────────────────────────────────────────


class TestGetPago:
    def test_get_own_pago(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.get(f"/api/pagos/{pago['id']}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == pago["id"]
        assert data["monto"] == "100.00"

    def test_get_foreign_pago_returns_404(self, pago_client: TestClient):
        _, headers_a = _register_and_login(pago_client)
        _, headers_b = _register_and_login(pago_client)
        prov_a = _create_proveedor(pago_client, headers_a)
        pago_a = _create_pago(pago_client, headers_a, prov_a["id"])

        resp = pago_client.get(f"/api/pagos/{pago_a['id']}", headers=headers_b)
        assert resp.status_code == 404

    def test_get_nonexistent_pago_returns_404(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        resp = pago_client.get(f"/api/pagos/{uuid.uuid4()}", headers=headers)
        assert resp.status_code == 404


# ── PATCH /api/pagos/{id} ─────────────────────────────────────────────────────


class TestUpdatePago:
    def test_partial_update_monto(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.patch(
            f"/api/pagos/{pago['id']}",
            json={"monto": "500.00"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["monto"] == "500.00"
        assert data["id"] == pago["id"]

    def test_update_with_factura_id_rejected_422(self, pago_client: TestClient):
        """RN-PAG-01: PATCH schema also rejects factura_id via extra=forbid."""
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.patch(
            f"/api/pagos/{pago['id']}",
            json={"factura_id": str(uuid.uuid4())},
            headers=headers,
        )
        assert resp.status_code == 422
        assert "factura_id" in str(resp.json()).lower()

    def test_update_with_proveedor_id_rejected_422(self, pago_client: TestClient):
        """D7: PATCH cannot re-link a payment to a different supplier."""
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.patch(
            f"/api/pagos/{pago['id']}",
            json={"proveedor_id": str(uuid.uuid4())},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_update_future_fecha_rejected_422(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.patch(
            f"/api/pagos/{pago['id']}",
            json={"fecha": (date.today() + timedelta(days=1)).isoformat()},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_update_monto_zero_rejected_422(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.patch(
            f"/api/pagos/{pago['id']}",
            json={"monto": "0"},
            headers=headers,
        )
        assert resp.status_code == 422

    def test_update_foreign_pago_returns_404(self, pago_client: TestClient):
        _, headers_a = _register_and_login(pago_client)
        _, headers_b = _register_and_login(pago_client)
        prov_a = _create_proveedor(pago_client, headers_a)
        pago_a = _create_pago(pago_client, headers_a, prov_a["id"])

        resp = pago_client.patch(
            f"/api/pagos/{pago_a['id']}",
            json={"monto": "999.00"},
            headers=headers_b,
        )
        assert resp.status_code == 404

    def test_update_nonexistent_pago_returns_404(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        resp = pago_client.patch(
            f"/api/pagos/{uuid.uuid4()}",
            json={"monto": "500.00"},
            headers=headers,
        )
        assert resp.status_code == 404


# ── DELETE /api/pagos/{id} ────────────────────────────────────────────────────


class TestDeletePago:
    def test_soft_delete_returns_204(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        resp = pago_client.delete(f"/api/pagos/{pago['id']}", headers=headers)
        assert resp.status_code == 204

        # GET returns 404 after soft-delete
        get_resp = pago_client.get(f"/api/pagos/{pago['id']}", headers=headers)
        assert get_resp.status_code == 404

    def test_delete_foreign_pago_returns_404(self, pago_client: TestClient):
        _, headers_a = _register_and_login(pago_client)
        _, headers_b = _register_and_login(pago_client)
        prov_a = _create_proveedor(pago_client, headers_a)
        pago_a = _create_pago(pago_client, headers_a, prov_a["id"])

        resp = pago_client.delete(f"/api/pagos/{pago_a['id']}", headers=headers_b)
        assert resp.status_code == 404

    def test_delete_already_deleted_returns_404(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)
        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        # First delete → 204
        resp1 = pago_client.delete(f"/api/pagos/{pago['id']}", headers=headers)
        assert resp1.status_code == 204

        # Second delete → 404
        resp2 = pago_client.delete(f"/api/pagos/{pago['id']}", headers=headers)
        assert resp2.status_code == 404

    def test_delete_nonexistent_returns_404(self, pago_client: TestClient):
        _, headers = _register_and_login(pago_client)
        resp = pago_client.delete(f"/api/pagos/{uuid.uuid4()}", headers=headers)
        assert resp.status_code == 404


# ── End-to-end with FacturaService (C-08 contract preserved) ────────────────


class TestFifoIntegration:
    """
    Verify the C-08 integration test contract: the C-08 POST /api/pagos
    stub (now backed by PagoService) still allows creating payments that
    feed the FIFO pool for the FacturaService. This protects the C-08
    integration test in test_factura_integration.py.
    """

    def test_crear_pago_feeds_factura_estado(self, pago_client: TestClient):
        """
        1. Create an invoice of 100.
        2. Create a pago of 100 for the same proveedor.
        3. GET the invoice → estado should be PAGADA.
        """
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        # Create invoice
        fac_resp = pago_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        assert fac_resp.status_code == 201
        fac_id = fac_resp.json()["id"]

        # Initially PENDIENTE
        get1 = pago_client.get(f"/api/facturas/{fac_id}", headers=headers).json()
        assert get1["estado"] == "PENDIENTE"

        # Create pago via the migrated POST /api/pagos endpoint
        _create_pago(pago_client, headers, prov["id"], "100.00")

        # Now PAGADA
        get2 = pago_client.get(f"/api/facturas/{fac_id}", headers=headers).json()
        assert get2["estado"] == "PAGADA"

    def test_delete_pago_reverses_factura_estado(self, pago_client: TestClient):
        """
        1. Create invoice (100) + pago (100) → PAGADA.
        2. DELETE the pago → invoice returns to PENDIENTE.
        """
        _, headers = _register_and_login(pago_client)
        prov = _create_proveedor(pago_client, headers)

        fac_resp = pago_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac_id = fac_resp.json()["id"]

        pago = _create_pago(pago_client, headers, prov["id"], "100.00")

        # PAGADA
        get1 = pago_client.get(f"/api/facturas/{fac_id}", headers=headers).json()
        assert get1["estado"] == "PAGADA"

        # Delete pago
        del_resp = pago_client.delete(f"/api/pagos/{pago['id']}", headers=headers)
        assert del_resp.status_code == 204

        # Now PENDIENTE
        get2 = pago_client.get(f"/api/facturas/{fac_id}", headers=headers).json()
        assert get2["estado"] == "PENDIENTE"
