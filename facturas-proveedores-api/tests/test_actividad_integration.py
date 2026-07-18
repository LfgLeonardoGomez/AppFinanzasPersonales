"""
Integration tests for GET /api/actividad-reciente (Home redesign backend addition).

Tests run against real Postgres (testcontainers) via FastAPI TestClient with
session dependency override (same pattern as test_proveedor_integration.py /
test_pago_integration.py).

Covers:
- Unauthenticated request → 401
- Empty feed for a brand-new user → []
- Merged facturas + pagos, most-recent-first by fecha, tiebreak created_at desc
- Each item shape: tipo, id, proveedor_id, proveedor_nombre, monto, fecha, created_at
- limit query param: default 8, custom value, bounds (min 1, max 50) → 422 outside range
- Isolation: another user's facturas/pagos never appear
"""

import uuid
from datetime import date

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
def actividad_client(engine, env_vars) -> TestClient:
    """Integration client with DB override and rate-limit store reset."""
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.routers.actividad import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

    app.dependency_overrides.clear()


# ── Auth / fixture helpers ────────────────────────────────────────────────────


def _unique_email():
    return f"actividad_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.9"


def _register_and_login(client: TestClient) -> str:
    """Register a new user, return access_token, and leave the client logged in."""
    email = _unique_email()
    password = "testpass123"
    ip = _unique_ip()

    client.post(
        "/api/auth/registro",
        json={"email": email, "nombre": "Actividad Test", "password": password},
        headers={"X-Forwarded-For": ip},
    )
    resp = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"X-Forwarded-For": ip},
    )
    assert resp.status_code == 200
    return resp.cookies["access_token"]


def _create_proveedor(client: TestClient, nombre: str) -> dict:
    resp = client.post("/api/proveedores", json={"nombre": nombre})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_factura(
    client: TestClient,
    proveedor_id: str,
    fecha_emision: date,
    monto_total: str = "100.00",
) -> dict:
    resp = client.post(
        "/api/facturas",
        json={
            "proveedor_id": proveedor_id,
            "fecha_emision": fecha_emision.isoformat(),
            "monto_total": monto_total,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _create_pago(
    client: TestClient,
    proveedor_id: str,
    fecha: date,
    monto: str = "50.00",
) -> dict:
    resp = client.post(
        "/api/pagos",
        json={
            "proveedor_id": proveedor_id,
            "monto": monto,
            "fecha": fecha.isoformat(),
            "metodo": "EFECTIVO",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Authentication guard ──────────────────────────────────────────────────────


class TestAuthGuard:
    def test_without_auth_returns_401(self, actividad_client: TestClient):
        actividad_client.cookies.clear()
        resp = actividad_client.get("/api/actividad-reciente")
        assert resp.status_code == 401


# ── Empty feed ────────────────────────────────────────────────────────────────


class TestEmpty:
    def test_new_user_gets_empty_feed(self, actividad_client: TestClient):
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        resp = actividad_client.get("/api/actividad-reciente")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        assert resp.json() == []


# ── Merged feed content and ordering ─────────────────────────────────────────


class TestMergedFeed:
    def test_item_shape(self, actividad_client: TestClient):
        """Spec: each item carries tipo, id, proveedor_id, proveedor_nombre, monto, fecha, created_at."""
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        proveedor = _create_proveedor(actividad_client, "ShapeSupplier")
        _create_factura(actividad_client, proveedor["id"], date(2026, 6, 1), "150.00")

        resp = actividad_client.get("/api/actividad-reciente")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        item = data[0]
        assert item["tipo"] == "factura"
        assert item["proveedor_id"] == proveedor["id"]
        assert item["proveedor_nombre"] == "ShapeSupplier"
        assert item["monto"] == "150.00"
        assert item["fecha"] == "2026-06-01"
        assert "id" in item and "created_at" in item

    def test_pago_item_uses_monto_and_fecha(self, actividad_client: TestClient):
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        proveedor = _create_proveedor(actividad_client, "PagoShapeSupplier")
        _create_pago(actividad_client, proveedor["id"], date(2026, 6, 2), "75.00")

        resp = actividad_client.get("/api/actividad-reciente")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        item = data[0]
        assert item["tipo"] == "pago"
        assert item["monto"] == "75.00"
        assert item["fecha"] == "2026-06-02"

    def test_merged_and_sorted_most_recent_first(self, actividad_client: TestClient):
        """Spec: facturas + pagos merged, sorted by fecha desc."""
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        proveedor = _create_proveedor(actividad_client, "MergedSupplier")
        _create_factura(actividad_client, proveedor["id"], date(2026, 1, 1))
        _create_pago(actividad_client, proveedor["id"], date(2026, 5, 1))
        _create_factura(actividad_client, proveedor["id"], date(2026, 3, 1))

        resp = actividad_client.get("/api/actividad-reciente")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        fechas = [item["fecha"] for item in resp.json()]
        assert fechas == ["2026-05-01", "2026-03-01", "2026-01-01"]

    def test_limit_default_is_8(self, actividad_client: TestClient):
        """Spec: default limit is 8 — the 9th oldest movement is excluded."""
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        proveedor = _create_proveedor(actividad_client, "LimitSupplier")
        for month in range(1, 10):  # 9 facturas, one per month Jan..Sep 2025 (past)
            _create_factura(actividad_client, proveedor["id"], date(2025, month, 1))

        resp = actividad_client.get("/api/actividad-reciente")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 8
        fechas = [item["fecha"] for item in data]
        # Most recent 8 (Sep..Feb), the oldest (Jan) must be excluded.
        assert "2025-01-01" not in fechas
        assert fechas == sorted(fechas, reverse=True)

    def test_custom_limit_is_respected(self, actividad_client: TestClient):
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        proveedor = _create_proveedor(actividad_client, "CustomLimitSupplier")
        for month in range(1, 6):
            _create_factura(actividad_client, proveedor["id"], date(2026, month, 1))

        resp = actividad_client.get("/api/actividad-reciente?limit=2")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 2
        assert data[0]["fecha"] == "2026-05-01"
        assert data[1]["fecha"] == "2026-04-01"


# ── limit bounds ──────────────────────────────────────────────────────────────


class TestLimitBounds:
    def test_limit_below_min_returns_422(self, actividad_client: TestClient):
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        resp = actividad_client.get("/api/actividad-reciente?limit=0")
        actividad_client.cookies.clear()

        assert resp.status_code == 422

    def test_limit_above_max_returns_422(self, actividad_client: TestClient):
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        resp = actividad_client.get("/api/actividad-reciente?limit=51")
        actividad_client.cookies.clear()

        assert resp.status_code == 422

    def test_limit_at_max_is_accepted(self, actividad_client: TestClient):
        token = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token)

        resp = actividad_client.get("/api/actividad-reciente?limit=50")
        actividad_client.cookies.clear()

        assert resp.status_code == 200


# ── Isolation across users ─────────────────────────────────────────────────────


class TestIsolation:
    def test_other_users_activity_never_appears(self, actividad_client: TestClient):
        token1 = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token1)
        proveedor1 = _create_proveedor(actividad_client, "IsoUser1Supplier")
        _create_factura(actividad_client, proveedor1["id"], date(2026, 6, 15))
        _create_pago(actividad_client, proveedor1["id"], date(2026, 6, 16))
        actividad_client.cookies.clear()

        token2 = _register_and_login(actividad_client)
        actividad_client.cookies.clear()
        actividad_client.cookies.set("access_token", token2)

        resp = actividad_client.get("/api/actividad-reciente")
        actividad_client.cookies.clear()

        assert resp.status_code == 200
        assert resp.json() == []
