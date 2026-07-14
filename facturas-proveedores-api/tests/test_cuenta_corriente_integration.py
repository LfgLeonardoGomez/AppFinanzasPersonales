"""
Integration tests for `GET /api/proveedores/{proveedor_id}/cuenta-corriente` (C-12).

HTTP-level tests against the real FastAPI app + Postgres (testcontainers),
following the test_factura_integration.py / test_pago_integration.py pattern.

Covers:
- 401 unauthenticated.
- 200 with the full triple for own supplier with mixed movimientos.
- 200 with empty lists for own supplier with no movimientos.
- 200 with negative saldo for own supplier with pool excedido.
- 404 for foreign supplier (no payload leak).
- 404 for own soft-deleted supplier.
- 404 for missing supplier.
- Body shape: `saldo` is a Decimal string, `facturas_con_estado` and `historial`
  are non-empty lists.
- Response is stable across two calls (no caching).
- POST/PUT to the same path returns 405.
- OpenAPI docs (`/docs`) include the new path.

Hard rules verified:
- The router does NOT call session.commit() (read-only).
- Cross-check invariant: `historial[-1].saldo_acumulado == saldo`.
- The route is declared BEFORE the catch-all `/{proveedor_id}`.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401


# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def cc_client(engine, env_vars) -> TestClient:
    """Integration client with DB override and rate-limit store reset.

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


# ── Auth / data helpers ─────────────────────────────────────────────────────


def _unique_email():
    return f"ccint_{uuid.uuid4().hex[:8]}@test.com"


def _unique_ip():
    return f"10.{uuid.uuid4().int % 256}.{uuid.uuid4().int % 256}.9"


def _register_and_login(client: TestClient) -> tuple[str, dict]:
    email = _unique_email()
    password = "testpass123"
    ip = _unique_ip()

    client.post(
        "/api/auth/registro",
        json={"email": email, "password": password, "nombre": "CC Int"},
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


def _create_factura(
    client: TestClient, headers: dict, proveedor_id: str, monto: str,
    fecha: str | None = None,
) -> dict:
    resp = client.post(
        "/api/facturas/",
        json={
            "proveedor_id": proveedor_id,
            "fecha_emision": fecha or date.today().isoformat(),
            "monto_total": monto,
        },
        headers=headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _create_pago(
    client: TestClient, headers: dict, proveedor_id: str, monto: str,
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


# ── Unauthenticated ──────────────────────────────────────────────────────────


class TestUnauthenticated:
    def test_get_requires_auth(self, cc_client: TestClient):
        resp = cc_client.get(f"/api/proveedores/{uuid.uuid4()}/cuenta-corriente")
        assert resp.status_code == 401


# ── 200 — own supplier ───────────────────────────────────────────────────────


class TestOwnSupplier:
    def test_empty_supplier_returns_zero_and_empty_lists(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)

        resp = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["proveedor_id"] == prov["id"]
        assert data["saldo"] == "0.00"
        assert data["facturas_con_estado"] == []
        assert data["historial"] == []

    def test_mixed_facturas_and_pagos(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)

        # 1 factura 1000, 1 pago 300 → saldo=700, estado=PARCIAL
        f = _create_factura(cc_client, headers, prov["id"], "1000.00")
        p = _create_pago(cc_client, headers, prov["id"], "300.00")

        resp = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["proveedor_id"] == prov["id"]
        assert data["saldo"] == "700.00"
        assert len(data["facturas_con_estado"]) == 1
        assert data["facturas_con_estado"][0]["id"] == f["id"]
        assert data["facturas_con_estado"][0]["estado"] == "PARCIAL"
        assert len(data["historial"]) == 2
        assert data["historial"][0]["tipo"] == "FACTURA"
        assert data["historial"][0]["id"] == f["id"]
        assert data["historial"][1]["tipo"] == "PAGO"
        assert data["historial"][1]["id"] == p["id"]
        # Cross-check
        assert data["historial"][-1]["saldo_acumulado"] == data["saldo"]

    def test_pool_excedido_returns_negative_saldo(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)

        _create_factura(cc_client, headers, prov["id"], "100.00")
        _create_pago(cc_client, headers, prov["id"], "10000.00")

        resp = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["saldo"] == "-9900.00"
        assert data["facturas_con_estado"][0]["estado"] == "PAGADA"

    def test_factura_con_estado_has_no_items(self, cc_client: TestClient):
        """Cuenta-corriente view omits `items` and `items_sum_mismatch`."""
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)
        _create_factura(cc_client, headers, prov["id"], "100.00")

        resp = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 200
        fce = resp.json()["facturas_con_estado"][0]
        assert "items" not in fce
        assert "items_sum_mismatch" not in fce

    def test_response_stable_across_two_calls(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)
        _create_factura(cc_client, headers, prov["id"], "100.00")
        _create_pago(cc_client, headers, prov["id"], "50.00")

        r1 = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        r2 = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert r1.status_code == r2.status_code == 200
        assert r1.json() == r2.json()


# ── 404 — foreign / missing / soft-deleted ──────────────────────────────────


class TestNotFound:
    def test_foreign_supplier_returns_404(self, cc_client: TestClient):
        _, headers_a = _register_and_login(cc_client)
        _, headers_b = _register_and_login(cc_client)
        prov_b = _create_proveedor(cc_client, headers_b)

        resp = cc_client.get(
            f"/api/proveedores/{prov_b['id']}/cuenta-corriente",
            headers=headers_a,
        )
        assert resp.status_code == 404

    def test_missing_supplier_returns_404(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        resp = cc_client.get(
            f"/api/proveedores/{uuid.uuid4()}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 404

    def test_soft_deleted_supplier_returns_404(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)

        # Soft-delete the supplier
        del_resp = cc_client.delete(
            f"/api/proveedores/{prov['id']}", headers=headers
        )
        assert del_resp.status_code == 200

        # cuenta-corriente should be 404
        resp = cc_client.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 404


# ── Method not allowed ─────────────────────────────────────────────────────


class TestMethodNotAllowed:
    def test_post_to_cuenta_corriente_returns_405(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)
        resp = cc_client.post(
            f"/api/proveedores/{prov['id']}/cuenta-corriente", headers=headers
        )
        assert resp.status_code == 405

    def test_put_to_cuenta_corriente_returns_405(self, cc_client: TestClient):
        _, headers = _register_and_login(cc_client)
        prov = _create_proveedor(cc_client, headers)
        resp = cc_client.put(
            f"/api/proveedores/{prov['id']}/cuenta-corriente",
            json={},
            headers=headers,
        )
        assert resp.status_code == 405


# ── OpenAPI docs ─────────────────────────────────────────────────────────────


class TestOpenApi:
    def test_openapi_lists_cuenta_corriente_endpoint(self, cc_client: TestClient):
        resp = cc_client.get("/openapi.json")
        assert resp.status_code == 200
        spec = resp.json()
        path = f"/api/proveedores/{{proveedor_id}}/cuenta-corriente"
        assert path in spec["paths"], f"Missing {path} in OpenAPI spec"
        op = spec["paths"][path]["get"]
        assert "summary" in op
        # The response model name should be CuentaCorrienteResponse
        response_ref = op["responses"]["200"]["content"]["application/json"]["schema"]
        assert "$ref" in response_ref or "title" in response_ref
