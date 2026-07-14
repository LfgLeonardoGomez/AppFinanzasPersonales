"""
Integration tests for /api/facturas endpoints (Task 6.1 — TDD RED, then GREEN).

Tests run against real Postgres (testcontainers) via FastAPI TestClient with
session dependency override (same pattern as test_proveedor_integration.py).

Covers:
- Unauthenticated request → 401
- POST /api/facturas → 201 with estado in response
- GET /api/facturas → list with estado and items
- GET /api/facturas/{id} → full response with items + estado
- PATCH /api/facturas/{id} → updated response
- DELETE /api/facturas/{id} → 204
- Foreign id → 404
- GET /api/facturas?estado=PAGADA → filtered after FIFO
- items_sum_mismatch=True when items sum != monto_total
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
def fac_client(engine, env_vars) -> TestClient:
    """Integration client with DB override and rate-limit store reset.

    C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings` is
    no longer cached.
    """
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.routers.facturas import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


# ── Auth helpers ──────────────────────────────────────────────────────────────


def _unique_email():
    return f"fac_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.3"


def _register_and_login(client: TestClient) -> tuple[str, str]:
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
) -> dict:
    resp = client.post(
        "/api/pagos/",
        json={
            "proveedor_id": proveedor_id,
            "monto": monto,
            "fecha": date.today().isoformat(),
            "metodo": "EFECTIVO",
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


# ── Unauthenticated ───────────────────────────────────────────────────────────


class TestUnauthenticated:
    def test_list_requires_auth(self, fac_client: TestClient):
        resp = fac_client.get("/api/facturas/")
        assert resp.status_code == 401

    def test_create_requires_auth(self, fac_client: TestClient):
        resp = fac_client.post("/api/facturas/", json={})
        assert resp.status_code == 401

    def test_get_requires_auth(self, fac_client: TestClient):
        resp = fac_client.get(f"/api/facturas/{uuid.uuid4()}")
        assert resp.status_code == 401


# ── POST /api/facturas ────────────────────────────────────────────────────────


class TestCreateFactura:
    def test_create_minimal_factura(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "500.00",
            },
            headers=headers,
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["monto_total"] == "500.00"
        assert data["estado"] == "PENDIENTE"
        assert data["items"] == []
        assert data["items_sum_mismatch"] is False
        assert data["origen"] == "MANUAL"

    def test_create_with_items(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "200.00",
                "items": [
                    {
                        "descripcion": "Producto A",
                        "cantidad": "2",
                        "precio_unitario": "100.00",
                    }
                ],
            },
            headers=headers,
        )

        assert resp.status_code == 201
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["descripcion"] == "Producto A"
        assert data["items_sum_mismatch"] is False

    def test_create_items_sum_mismatch_flag(self, fac_client: TestClient):
        """items sum (100) != monto_total (500) → items_sum_mismatch=True, not block."""
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "500.00",
                "items": [
                    {"descripcion": "Item", "cantidad": "1", "precio_unitario": "100.00"}
                ],
            },
            headers=headers,
        )

        assert resp.status_code == 201
        assert resp.json()["items_sum_mismatch"] is True

    def test_create_monto_zero_rejected(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "0.00",
            },
            headers=headers,
        )
        assert resp.status_code == 422

    def test_create_future_fecha_rejected(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": (date.today() + timedelta(days=1)).isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        assert resp.status_code == 422

    def test_create_foreign_proveedor_returns_404(self, fac_client: TestClient):
        _, headers_a = _register_and_login(fac_client)
        _, headers_b = _register_and_login(fac_client)
        prov_b = _create_proveedor(fac_client, headers_b)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov_b["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers_a,  # User A tries to use User B's proveedor
        )
        assert resp.status_code == 404


# ── GET /api/facturas ─────────────────────────────────────────────────────────


class TestListFacturas:
    def test_list_returns_user_facturas(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )

        resp = fac_client.get("/api/facturas/", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all("estado" in item for item in data)

    def test_list_with_estado_filter(self, fac_client: TestClient):
        """
        Create 2 facturas, pay only the first. Filter by PAGADA → 1 result.
        Estado filter applied AFTER FIFO (not SQL WHERE).
        """
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        # Older invoice first
        resp1 = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": (date.today() - timedelta(days=1)).isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac1_id = resp1.json()["id"]

        # Newer invoice
        resp2 = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "200.00",
            },
            headers=headers,
        )
        fac2_id = resp2.json()["id"]

        # Pay exactly the first one
        _create_pago(fac_client, headers, prov["id"], "100.00")

        # Filter by PAGADA → should get only fac1
        resp = fac_client.get(
            "/api/facturas/",
            params={"estado": "PAGADA"},
            headers=headers,
        )
        assert resp.status_code == 200
        pagadas = resp.json()
        pagada_ids = [f["id"] for f in pagadas]
        assert fac1_id in pagada_ids
        assert fac2_id not in pagada_ids

    def test_list_by_proveedor_filter(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov1 = _create_proveedor(fac_client, headers)
        prov2 = _create_proveedor(fac_client, headers)

        resp1 = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov1["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac1_id = resp1.json()["id"]

        resp2 = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov2["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "200.00",
            },
            headers=headers,
        )
        fac2_id = resp2.json()["id"]

        resp = fac_client.get(
            "/api/facturas/",
            params={"proveedor_id": prov1["id"]},
            headers=headers,
        )
        assert resp.status_code == 200
        ids = [f["id"] for f in resp.json()]
        assert fac1_id in ids
        assert fac2_id not in ids

    def test_list_user_isolation(self, fac_client: TestClient):
        _, headers_a = _register_and_login(fac_client)
        _, headers_b = _register_and_login(fac_client)
        prov_a = _create_proveedor(fac_client, headers_a)

        resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov_a["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers_a,
        )
        fac_a_id = resp.json()["id"]

        resp_b = fac_client.get("/api/facturas/", headers=headers_b)
        assert resp_b.status_code == 200
        ids_b = [f["id"] for f in resp_b.json()]
        assert fac_a_id not in ids_b


# ── GET /api/facturas/{id} ────────────────────────────────────────────────────


class TestGetFactura:
    def test_get_returns_full_response(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        create_resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "300.00",
                "numero": "F-999",
                "items": [
                    {"descripcion": "X", "cantidad": "1", "precio_unitario": "300.00"}
                ],
            },
            headers=headers,
        )
        fac_id = create_resp.json()["id"]

        resp = fac_client.get(f"/api/facturas/{fac_id}", headers=headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == fac_id
        assert data["numero"] == "F-999"
        assert data["estado"] == "PENDIENTE"
        assert len(data["items"]) == 1

    def test_get_foreign_returns_404(self, fac_client: TestClient):
        _, headers_a = _register_and_login(fac_client)
        _, headers_b = _register_and_login(fac_client)
        prov_a = _create_proveedor(fac_client, headers_a)

        create_resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov_a["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers_a,
        )
        fac_id = create_resp.json()["id"]

        resp = fac_client.get(f"/api/facturas/{fac_id}", headers=headers_b)
        assert resp.status_code == 404

    def test_get_nonexistent_returns_404(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        resp = fac_client.get(f"/api/facturas/{uuid.uuid4()}", headers=headers)
        assert resp.status_code == 404


# ── PATCH /api/facturas/{id} ──────────────────────────────────────────────────


class TestUpdateFactura:
    def test_partial_update(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        create_resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac_id = create_resp.json()["id"]

        resp = fac_client.patch(
            f"/api/facturas/{fac_id}",
            json={"numero": "F-UPDATED", "monto_total": "250.00"},
            headers=headers,
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["numero"] == "F-UPDATED"
        assert data["monto_total"] == "250.00"
        assert "estado" in data

    def test_update_foreign_returns_404(self, fac_client: TestClient):
        _, headers_a = _register_and_login(fac_client)
        _, headers_b = _register_and_login(fac_client)
        prov_a = _create_proveedor(fac_client, headers_a)

        create_resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov_a["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers_a,
        )
        fac_id = create_resp.json()["id"]

        resp = fac_client.patch(
            f"/api/facturas/{fac_id}",
            json={"numero": "HACKED"},
            headers=headers_b,
        )
        assert resp.status_code == 404


# ── DELETE /api/facturas/{id} ─────────────────────────────────────────────────


class TestDeleteFactura:
    def test_soft_delete_returns_204(self, fac_client: TestClient):
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        create_resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac_id = create_resp.json()["id"]

        resp = fac_client.delete(f"/api/facturas/{fac_id}", headers=headers)
        assert resp.status_code == 204

        # Verify soft-deleted (GET returns 404)
        get_resp = fac_client.get(f"/api/facturas/{fac_id}", headers=headers)
        assert get_resp.status_code == 404

    def test_delete_foreign_returns_404(self, fac_client: TestClient):
        _, headers_a = _register_and_login(fac_client)
        _, headers_b = _register_and_login(fac_client)
        prov_a = _create_proveedor(fac_client, headers_a)

        create_resp = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov_a["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers_a,
        )
        fac_id = create_resp.json()["id"]

        resp = fac_client.delete(f"/api/facturas/{fac_id}", headers=headers_b)
        assert resp.status_code == 404


# ── End-to-end FIFO estado ────────────────────────────────────────────────────


class TestFifoEndToEnd:
    def test_fifo_estado_changes_when_pagos_added(self, fac_client: TestClient):
        """
        Integration FIFO test:
        1. Create 2 invoices (100 each).
        2. Get both → both PENDIENTE.
        3. Add pago of 150 → first PAGADA, second PARCIAL.
        4. Add another pago of 50 → second PAGADA.
        """
        _, headers = _register_and_login(fac_client)
        prov = _create_proveedor(fac_client, headers)

        # Create older invoice first
        resp1 = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": (date.today() - timedelta(days=1)).isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac1_id = resp1.json()["id"]

        resp2 = fac_client.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
            headers=headers,
        )
        fac2_id = resp2.json()["id"]

        # Both should be PENDIENTE
        g1 = fac_client.get(f"/api/facturas/{fac1_id}", headers=headers).json()
        g2 = fac_client.get(f"/api/facturas/{fac2_id}", headers=headers).json()
        assert g1["estado"] == "PENDIENTE"
        assert g2["estado"] == "PENDIENTE"

        # Add pago of 150 → fac1 PAGADA, fac2 PARCIAL
        _create_pago(fac_client, headers, prov["id"], "150.00")

        g1 = fac_client.get(f"/api/facturas/{fac1_id}", headers=headers).json()
        g2 = fac_client.get(f"/api/facturas/{fac2_id}", headers=headers).json()
        assert g1["estado"] == "PAGADA"
        assert g2["estado"] == "PARCIAL"

        # Add pago of 50 → fac2 PAGADA
        _create_pago(fac_client, headers, prov["id"], "50.00")

        g2 = fac_client.get(f"/api/facturas/{fac2_id}", headers=headers).json()
        assert g2["estado"] == "PAGADA"
