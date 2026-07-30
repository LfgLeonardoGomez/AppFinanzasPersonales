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

c-22: identity is per-client, never a hand-written Cookie header. Each user
drives its own logged-in client (`make_user_client`), so "user A" and "user B"
cannot silently collapse into the same identity — which is exactly what made
the cross-tenant 404 assertions vacuous before. See tests/test_multiuser_harness.py.
"""

import uuid
from datetime import date, timedelta

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
def fac_app(engine, env_vars):
    """The app wired to the throwaway Postgres, with the rate-limit store reset.

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

    # One context-managed client so the app's lifespan runs once per module.
    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


@pytest.fixture
def user(fac_app) -> TestClient:
    """A logged-in client; its session lives only in its own cookie jar."""
    return make_user_client(fac_app, prefix="fac")


# ── Auth helpers ──────────────────────────────────────────────────────────────


def _create_proveedor(client: TestClient) -> dict:
    resp = client.post(
        "/api/proveedores/",
        json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
    )
    assert resp.status_code == 201
    return resp.json()


def _create_pago(
    client: TestClient,
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
    )
    assert resp.status_code == 201
    return resp.json()


def _create_factura(client: TestClient, proveedor_id: str, **overrides) -> dict:
    """Create an invoice with sensible defaults; overrides win."""
    payload = {
        "proveedor_id": proveedor_id,
        "fecha_emision": date.today().isoformat(),
        "monto_total": "100.00",
    }
    payload.update(overrides)
    resp = client.post("/api/facturas/", json=payload)
    assert resp.status_code == 201
    return resp.json()


# ── Unauthenticated ───────────────────────────────────────────────────────────


class TestUnauthenticated:
    """Each test uses a client with a guaranteed-empty jar, so a 401 proves the
    absence of a session instead of depending on test execution order."""

    def test_list_requires_auth(self, fac_app):
        resp = make_anon_client(fac_app).get("/api/facturas/")
        assert resp.status_code == 401

    def test_create_requires_auth(self, fac_app):
        resp = make_anon_client(fac_app).post("/api/facturas/", json={})
        assert resp.status_code == 401

    def test_get_requires_auth(self, fac_app):
        resp = make_anon_client(fac_app).get(f"/api/facturas/{uuid.uuid4()}")
        assert resp.status_code == 401


# ── POST /api/facturas ────────────────────────────────────────────────────────


class TestCreateFactura:
    def test_create_minimal_factura(self, user: TestClient):
        prov = _create_proveedor(user)

        resp = user.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "500.00",
            },
        )

        assert resp.status_code == 201
        data = resp.json()
        assert data["monto_total"] == "500.00"
        assert data["estado"] == "PENDIENTE"
        assert data["items"] == []
        assert data["items_sum_mismatch"] is False
        assert data["origen"] == "MANUAL"

    def test_create_with_items(self, user: TestClient):
        prov = _create_proveedor(user)

        resp = user.post(
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
        )

        assert resp.status_code == 201
        data = resp.json()
        assert len(data["items"]) == 1
        assert data["items"][0]["descripcion"] == "Producto A"
        assert data["items_sum_mismatch"] is False

    def test_create_items_sum_mismatch_flag(self, user: TestClient):
        """items sum (100) != monto_total (500) → items_sum_mismatch=True, not block."""
        prov = _create_proveedor(user)

        resp = user.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "500.00",
                "items": [
                    {"descripcion": "Item", "cantidad": "1", "precio_unitario": "100.00"}
                ],
            },
        )

        assert resp.status_code == 201
        assert resp.json()["items_sum_mismatch"] is True

    def test_create_monto_zero_rejected(self, user: TestClient):
        prov = _create_proveedor(user)

        resp = user.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "0.00",
            },
        )
        assert resp.status_code == 422

    def test_create_future_fecha_rejected(self, user: TestClient):
        prov = _create_proveedor(user)

        resp = user.post(
            "/api/facturas/",
            json={
                "proveedor_id": prov["id"],
                "fecha_emision": (date.today() + timedelta(days=1)).isoformat(),
                "monto_total": "100.00",
            },
        )
        assert resp.status_code == 422

    def test_create_foreign_proveedor_returns_404(self, fac_app):
        client_a = make_user_client(fac_app, prefix="fac_a")
        client_b = make_user_client(fac_app, prefix="fac_b")
        prov_b = _create_proveedor(client_b)
        # ProveedorResponse does not expose usuario_id; ownership is proven by
        # A being unable to reach B's proveedor at all.
        assert client_a.get(f"/api/proveedores/{prov_b['id']}").status_code == 404

        resp = client_a.post(  # User A tries to use User B's proveedor
            "/api/facturas/",
            json={
                "proveedor_id": prov_b["id"],
                "fecha_emision": date.today().isoformat(),
                "monto_total": "100.00",
            },
        )
        assert resp.status_code == 404


# ── GET /api/facturas ─────────────────────────────────────────────────────────


class TestListFacturas:
    def test_list_returns_user_facturas(self, user: TestClient):
        prov = _create_proveedor(user)
        _create_factura(user, prov["id"])

        resp = user.get("/api/facturas/")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert all("estado" in item for item in data)

    def test_list_with_estado_filter(self, user: TestClient):
        """
        Create 2 facturas, pay only the first. Filter by PAGADA → 1 result.
        Estado filter applied AFTER FIFO (not SQL WHERE).
        """
        prov = _create_proveedor(user)

        # Older invoice first
        fac1_id = _create_factura(
            user,
            prov["id"],
            fecha_emision=(date.today() - timedelta(days=1)).isoformat(),
            monto_total="100.00",
        )["id"]

        # Newer invoice
        fac2_id = _create_factura(user, prov["id"], monto_total="200.00")["id"]

        # Pay exactly the first one
        _create_pago(user, prov["id"], "100.00")

        # Filter by PAGADA → should get only fac1
        resp = user.get(
            "/api/facturas/",
            params={"estado": "PAGADA"},
        )
        assert resp.status_code == 200
        pagadas = resp.json()
        pagada_ids = [f["id"] for f in pagadas]
        assert fac1_id in pagada_ids
        assert fac2_id not in pagada_ids

    def test_list_by_proveedor_filter(self, user: TestClient):
        prov1 = _create_proveedor(user)
        prov2 = _create_proveedor(user)

        fac1_id = _create_factura(user, prov1["id"], monto_total="100.00")["id"]
        fac2_id = _create_factura(user, prov2["id"], monto_total="200.00")["id"]

        resp = user.get(
            "/api/facturas/",
            params={"proveedor_id": prov1["id"]},
        )
        assert resp.status_code == 200
        ids = [f["id"] for f in resp.json()]
        assert fac1_id in ids
        assert fac2_id not in ids

    def test_list_user_isolation(self, fac_app):
        client_a = make_user_client(fac_app, prefix="fac_a")
        client_b = make_user_client(fac_app, prefix="fac_b")
        prov_a = _create_proveedor(client_a)

        fac_a_id = _create_factura(client_a, prov_a["id"])["id"]

        resp_b = client_b.get("/api/facturas/")
        assert resp_b.status_code == 200
        ids_b = [f["id"] for f in resp_b.json()]
        assert fac_a_id not in ids_b


# ── GET /api/facturas/{id} ────────────────────────────────────────────────────


class TestGetFactura:
    def test_get_returns_full_response(self, user: TestClient):
        prov = _create_proveedor(user)

        fac_id = _create_factura(
            user,
            prov["id"],
            monto_total="300.00",
            numero="F-999",
            items=[{"descripcion": "X", "cantidad": "1", "precio_unitario": "300.00"}],
        )["id"]

        resp = user.get(f"/api/facturas/{fac_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == fac_id
        assert data["numero"] == "F-999"
        assert data["estado"] == "PENDIENTE"
        assert len(data["items"]) == 1

    def test_get_foreign_returns_404(self, fac_app):
        client_a = make_user_client(fac_app, prefix="fac_a")
        client_b = make_user_client(fac_app, prefix="fac_b")
        prov_a = _create_proveedor(client_a)

        fac_id = _create_factura(client_a, prov_a["id"])["id"]

        resp = client_b.get(f"/api/facturas/{fac_id}")
        assert resp.status_code == 404

    def test_get_nonexistent_returns_404(self, user: TestClient):
        resp = user.get(f"/api/facturas/{uuid.uuid4()}")
        assert resp.status_code == 404


# ── PATCH /api/facturas/{id} ──────────────────────────────────────────────────


class TestUpdateFactura:
    def test_partial_update(self, user: TestClient):
        prov = _create_proveedor(user)

        fac_id = _create_factura(user, prov["id"])["id"]

        resp = user.patch(
            f"/api/facturas/{fac_id}",
            json={"numero": "F-UPDATED", "monto_total": "250.00"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["numero"] == "F-UPDATED"
        assert data["monto_total"] == "250.00"
        assert "estado" in data

    def test_update_foreign_returns_404(self, fac_app):
        client_a = make_user_client(fac_app, prefix="fac_a")
        client_b = make_user_client(fac_app, prefix="fac_b")
        prov_a = _create_proveedor(client_a)

        fac_id = _create_factura(client_a, prov_a["id"])["id"]

        resp = client_b.patch(
            f"/api/facturas/{fac_id}",
            json={"numero": "HACKED"},
        )
        assert resp.status_code == 404


# ── DELETE /api/facturas/{id} ─────────────────────────────────────────────────


class TestDeleteFactura:
    def test_soft_delete_returns_204(self, user: TestClient):
        prov = _create_proveedor(user)

        fac_id = _create_factura(user, prov["id"])["id"]

        resp = user.delete(f"/api/facturas/{fac_id}")
        assert resp.status_code == 204

        # Verify soft-deleted (GET returns 404)
        get_resp = user.get(f"/api/facturas/{fac_id}")
        assert get_resp.status_code == 404

    def test_delete_foreign_returns_404(self, fac_app):
        client_a = make_user_client(fac_app, prefix="fac_a")
        client_b = make_user_client(fac_app, prefix="fac_b")
        prov_a = _create_proveedor(client_a)

        fac_id = _create_factura(client_a, prov_a["id"])["id"]

        resp = client_b.delete(f"/api/facturas/{fac_id}")
        assert resp.status_code == 404


# ── End-to-end FIFO estado ────────────────────────────────────────────────────


class TestFifoEndToEnd:
    def test_fifo_estado_changes_when_pagos_added(self, user: TestClient):
        """
        Integration FIFO test:
        1. Create 2 invoices (100 each).
        2. Get both → both PENDIENTE.
        3. Add pago of 150 → first PAGADA, second PARCIAL.
        4. Add another pago of 50 → second PAGADA.
        """
        prov = _create_proveedor(user)

        # Create older invoice first
        fac1_id = _create_factura(
            user,
            prov["id"],
            fecha_emision=(date.today() - timedelta(days=1)).isoformat(),
            monto_total="100.00",
        )["id"]

        fac2_id = _create_factura(user, prov["id"], monto_total="100.00")["id"]

        # Both should be PENDIENTE
        g1 = user.get(f"/api/facturas/{fac1_id}").json()
        g2 = user.get(f"/api/facturas/{fac2_id}").json()
        assert g1["estado"] == "PENDIENTE"
        assert g2["estado"] == "PENDIENTE"

        # Add pago of 150 → fac1 PAGADA, fac2 PARCIAL
        _create_pago(user, prov["id"], "150.00")

        g1 = user.get(f"/api/facturas/{fac1_id}").json()
        g2 = user.get(f"/api/facturas/{fac2_id}").json()
        assert g1["estado"] == "PAGADA"
        assert g2["estado"] == "PARCIAL"

        # Add pago of 50 → fac2 PAGADA
        _create_pago(user, prov["id"], "50.00")

        g2 = user.get(f"/api/facturas/{fac2_id}").json()
        assert g2["estado"] == "PAGADA"
