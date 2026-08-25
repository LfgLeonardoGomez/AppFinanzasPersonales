"""
Integration tests for the C-39 export endpoints (design.md D4):

    GET /api/proveedores/{id}/cuenta-corriente/export
    GET /api/clientes/{id}/cuenta-corriente/export

HTTP-level tests against the real FastAPI app + Postgres (testcontainers).
Hits the REAL route (not just "the router has it registered") — the whole
point of D4 is that a route declared after the catch-all `/{id}` fails
SILENTLY (wrong handler, not a startup error), so only a real request proves
placement is correct (task 7.2).
"""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_anon_client, make_user_client


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def app_with_db(engine, env_vars):
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.auth import get_db as get_db_auth
    from app.routers.usuarios import get_db as get_db_usuarios
    from app.routers.proveedores import get_db as get_db_proveedores
    from app.routers.clientes import get_db as get_db_clientes
    from app.routers.facturas import get_db as get_db_facturas
    from app.routers.pagos import get_db as get_db_pagos
    from app.routers.ventas import get_db as get_db_ventas
    from app.routers.cobros import get_db as get_db_cobros

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    # Explicit literal assignments (NOT a loop over a tuple) — required by
    # tests/test_dependency_override_imports.py, the C-25 structural guard.
    # It statically resolves each `dependency_overrides[X]` back to X's
    # import via AST, and only handles a bare `ast.Name` slice; a loop
    # variable has no import to resolve and reads as a violation.
    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_proveedores] = override_get_db
    app.dependency_overrides[get_db_clientes] = override_get_db
    app.dependency_overrides[get_db_facturas] = override_get_db
    app.dependency_overrides[get_db_pagos] = override_get_db
    app.dependency_overrides[get_db_ventas] = override_get_db
    app.dependency_overrides[get_db_cobros] = override_get_db

    yield app

    app.dependency_overrides.clear()


# ── Helpers ──────────────────────────────────────────────────────────────────


def _proveedor(usuario: TestClient) -> dict:
    resp = usuario.post(
        "/api/proveedores/", json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _factura(usuario: TestClient, proveedor_id: str, monto: str = "1000.00") -> dict:
    resp = usuario.post(
        "/api/facturas/",
        json={"proveedor_id": proveedor_id, "fecha_emision": str(date.today()), "monto_total": monto},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _cliente(usuario: TestClient) -> dict:
    resp = usuario.post("/api/clientes", json={"nombre": f"Cliente {uuid.uuid4().hex[:6]}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _fiado(usuario: TestClient, cliente_id: str, monto: str = "500.00") -> dict:
    resp = usuario.post(
        "/api/ventas",
        json={
            "monto": monto,
            "fecha": str(date.today()),
            "forma_pago": "CUENTA_CORRIENTE",
            "cliente_id": cliente_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── 401 ──────────────────────────────────────────────────────────────────────


class TestUnauthenticated:
    def test_proveedor_export_sin_sesion_da_401(self, app_with_db):
        anon = make_anon_client(app_with_db)
        resp = anon.get(f"/api/proveedores/{uuid.uuid4()}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 401

    def test_cliente_export_sin_sesion_da_401(self, app_with_db):
        anon = make_anon_client(app_with_db)
        resp = anon.get(f"/api/clientes/{uuid.uuid4()}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 401


# ── PDF / XLSX (task 7.2, 7.3) ────────────────────────────────────────────────


class TestExportProveedor:
    def test_formato_pdf_devuelve_content_type_y_disposition(self, app_with_db):
        u = make_user_client(app_with_db, prefix="expprov1")
        prov = _proveedor(u)
        _factura(u, prov["id"], "1000.00")

        resp = u.get(f"/api/proveedores/{prov['id']}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert "attachment" in resp.headers["content-disposition"]
        assert resp.content.startswith(b"%PDF-")

    def test_formato_xlsx_devuelve_una_planilla(self, app_with_db):
        u = make_user_client(app_with_db, prefix="expprov2")
        prov = _proveedor(u)
        _factura(u, prov["id"], "1000.00")

        resp = u.get(f"/api/proveedores/{prov['id']}/cuenta-corriente/export?formato=xlsx")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )
        assert resp.content.startswith(b"PK")

    def test_formato_no_soportado_da_422(self, app_with_db):
        u = make_user_client(app_with_db, prefix="expprov3")
        prov = _proveedor(u)
        resp = u.get(f"/api/proveedores/{prov['id']}/cuenta-corriente/export?formato=csv")
        assert resp.status_code == 422

    def test_rango_sin_incluir_historial_da_422(self, app_with_db):
        u = make_user_client(app_with_db, prefix="expprov4")
        prov = _proveedor(u)
        resp = u.get(
            f"/api/proveedores/{prov['id']}/cuenta-corriente/export"
            "?formato=pdf&desde=2026-01-01&hasta=2026-01-31"
        )
        assert resp.status_code == 422

    def test_proveedor_ajeno_da_404(self, app_with_db):
        u_a = make_user_client(app_with_db, prefix="expprov5a")
        u_b = make_user_client(app_with_db, prefix="expprov5b")
        prov_b = _proveedor(u_b)

        resp = u_a.get(f"/api/proveedores/{prov_b['id']}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 404


class TestExportCliente:
    def test_formato_pdf_devuelve_content_type_y_disposition(self, app_with_db):
        u = make_user_client(app_with_db, prefix="expcli1")
        cliente = _cliente(u)
        _fiado(u, cliente["id"], "500.00")

        resp = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
        assert "attachment" in resp.headers["content-disposition"]

    def test_formato_xlsx_devuelve_una_planilla(self, app_with_db):
        u = make_user_client(app_with_db, prefix="expcli2")
        cliente = _cliente(u)
        _fiado(u, cliente["id"], "500.00")

        resp = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente/export?formato=xlsx")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        )

    def test_cliente_ajeno_da_404(self, app_with_db):
        u_a = make_user_client(app_with_db, prefix="expcli3a")
        u_b = make_user_client(app_with_db, prefix="expcli3b")
        cliente_b = _cliente(u_b)

        resp = u_a.get(f"/api/clientes/{cliente_b['id']}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 404


# ── D4 — la ruta real, no solo "el router la tiene registrada" ───────────────


class TestRutaDeclaradaAntesDelCatchAll:
    """
    task 7.2: si `/{id}/cuenta-corriente/export` estuviera declarada DESPUÉS
    de `/{id}` en el archivo fuente, FastAPI matchearía `/{id}` primero (con
    `id="cuenta-corriente"` en el path) y este request devolvería 404/422 de
    OTRO endpoint, nunca un PDF. Pegarle a la ruta real con datos reales es
    lo que detecta ese fallo silencioso — inspeccionar `app.routes` no lo
    detecta, porque el router SÍ tiene la ruta registrada en ambos casos.
    """

    def test_export_no_es_shadowed_por_get_id(self, app_with_db):
        u = make_user_client(app_with_db, prefix="exproute1")
        prov = _proveedor(u)

        resp = u.get(f"/api/proveedores/{prov['id']}/cuenta-corriente/export?formato=pdf")
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/pdf"
