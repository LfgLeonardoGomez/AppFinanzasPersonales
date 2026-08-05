"""
Regression tests for c-26 Slice A (D1):
FacturaResponse.proveedor_nombre is populated by the router on
create/get/update, mirroring app/routers/pagos.py's
`_resolve_proveedor_nombre` helper.

Before this change, `FacturaResponse` did not declare `proveedor_nombre`
at all (the proposal's premise that the field already existed on the
schema was wrong for this codebase — see the Slice A report). These
tests cover both the schema declaration and the populated value.

- Active supplier → proveedor_nombre is the supplier's name.
- Soft-deleted supplier → proveedor_nombre is None, never the id.
- Foreign invoice → still 404, no name leaked.

c-22: identity is per-client, never a hand-written Cookie header.
"""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_user_client


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def fac_app(engine, env_vars):
    from app.core.deps import reset_rate_limit_store
    reset_rate_limit_store()

    from app.main import app
    from app.routers.facturas import get_db

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


@pytest.fixture
def user(fac_app) -> TestClient:
    return make_user_client(fac_app, prefix="fac26")


def _create_proveedor(client: TestClient, nombre: str = "Proveedor Test") -> dict:
    resp = client.post(
        "/api/proveedores/",
        json={"nombre": nombre, "categoria": "OTRO"},
    )
    assert resp.status_code == 201
    return resp.json()


def _create_factura(client: TestClient, proveedor_id: str, **overrides) -> dict:
    payload = {
        "proveedor_id": proveedor_id,
        "fecha_emision": date.today().isoformat(),
        "monto_total": "100.00",
    }
    payload.update(overrides)
    resp = client.post("/api/facturas/", json=payload)
    assert resp.status_code == 201
    return resp.json()


# ── Schema declares the field ──────────────────────────────────────────────


class TestFacturaResponseSchema:
    def test_proveedor_nombre_field_exists_on_schema(self):
        """FacturaResponse declares proveedor_nombre (Optional, default None)."""
        from app.schemas.factura import FacturaResponse

        fields = FacturaResponse.model_fields
        assert "proveedor_nombre" in fields
        assert fields["proveedor_nombre"].default is None


# ── create/get/update populate the supplier's name ──────────────────────────


class TestProveedorNombrePopulated:
    def test_create_returns_supplier_name(self, user: TestClient):
        prov = _create_proveedor(user, nombre="pencamar")

        data = _create_factura(user, prov["id"])

        assert data["proveedor_nombre"] == "pencamar"

    def test_get_returns_supplier_name(self, user: TestClient):
        prov = _create_proveedor(user, nombre="Ferretería Sur")
        fac_id = _create_factura(user, prov["id"])["id"]

        resp = user.get(f"/api/facturas/{fac_id}")

        assert resp.status_code == 200
        assert resp.json()["proveedor_nombre"] == "Ferretería Sur"

    def test_update_returns_supplier_name(self, user: TestClient):
        prov = _create_proveedor(user, nombre="Distribuidora Norte")
        fac_id = _create_factura(user, prov["id"])["id"]

        resp = user.patch(
            f"/api/facturas/{fac_id}",
            json={"numero": "F-100"},
        )

        assert resp.status_code == 200
        assert resp.json()["proveedor_nombre"] == "Distribuidora Norte"

    def test_soft_deleted_supplier_yields_none_not_id(self, user: TestClient):
        prov = _create_proveedor(user, nombre="Va a desaparecer")
        fac_id = _create_factura(user, prov["id"])["id"]

        del_resp = user.delete(f"/api/proveedores/{prov['id']}")
        assert del_resp.status_code == 200

        resp = user.get(f"/api/facturas/{fac_id}")

        assert resp.status_code == 200
        data = resp.json()
        assert data["proveedor_nombre"] is None
        # The regression this guards against: falling back to the id.
        assert data["proveedor_nombre"] != prov["id"]


# ── Ownership is unaffected ──────────────────────────────────────────────────


class TestOwnershipUnaffected:
    def test_foreign_invoice_still_404_no_name_leaked(self, fac_app):
        client_a = make_user_client(fac_app, prefix="fac26_a")
        client_b = make_user_client(fac_app, prefix="fac26_b")
        prov_a = _create_proveedor(client_a, nombre="Solo de A")

        fac_id = _create_factura(client_a, prov_a["id"])["id"]

        resp = client_b.get(f"/api/facturas/{fac_id}")

        assert resp.status_code == 404
