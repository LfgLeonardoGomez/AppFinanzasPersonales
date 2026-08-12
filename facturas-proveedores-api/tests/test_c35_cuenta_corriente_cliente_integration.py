"""
Integration tests for `GET /api/clientes/{cliente_id}/cuenta-corriente` (C-35).

Task 8.4, 8.5. Mirrors test_cuenta_corriente_integration.py (the supplier
equivalent) exactly.
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
    from app.routers.clientes import get_db as get_db_clientes
    from app.routers.usuarios import get_db as get_db_usuarios
    from app.routers.ventas import get_db as get_db_ventas
    from app.routers.cobros import get_db as get_db_cobros

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_clientes] = override_get_db
    app.dependency_overrides[get_db_ventas] = override_get_db
    app.dependency_overrides[get_db_cobros] = override_get_db

    yield app

    app.dependency_overrides.clear()


def _cliente(usuario: TestClient, nombre: str | None = None) -> dict:
    resp = usuario.post(
        "/api/clientes", json={"nombre": nombre or f"Cliente {uuid.uuid4().hex[:6]}"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _fiado(usuario: TestClient, cliente_id: str, monto: str = "1000.00") -> dict:
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


def _cobro(usuario: TestClient, cliente_id: str, monto: str) -> dict:
    resp = usuario.post(
        "/api/cobros",
        json={
            "cliente_id": cliente_id,
            "monto": monto,
            "fecha": str(date.today()),
            "metodo": "EFECTIVO",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestUnauthenticated:
    def test_sin_sesion_da_401(self, app_with_db):
        anon = make_anon_client(app_with_db)
        resp = anon.get(f"/api/clientes/{uuid.uuid4()}/cuenta-corriente")
        assert resp.status_code == 401


class TestPropio:
    def test_cliente_vacio_saldo_cero_listas_vacias(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ccc1")
        cliente = _cliente(u)

        resp = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        assert resp.status_code == 200
        data = resp.json()
        assert data["cliente_id"] == cliente["id"]
        assert data["saldo"] == "0.00"
        assert data["ventas_con_estado"] == []
        assert data["historial"] == []

    def test_fiado_y_cobro_parcial(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ccc2")
        cliente = _cliente(u)
        venta = _fiado(u, cliente["id"], "1000.00")
        cobro = _cobro(u, cliente["id"], "300.00")

        resp = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        assert resp.status_code == 200
        data = resp.json()
        assert data["saldo"] == "700.00"
        assert len(data["ventas_con_estado"]) == 1
        assert data["ventas_con_estado"][0]["id"] == venta["id"]
        assert data["ventas_con_estado"][0]["estado"] == "PARCIAL"
        assert len(data["historial"]) == 2
        assert data["historial"][0]["tipo"] == "VENTA"
        assert data["historial"][1]["tipo"] == "COBRO"
        assert data["historial"][1]["id"] == cobro["id"]
        assert data["historial"][-1]["saldo_acumulado"] == data["saldo"]

    def test_respuesta_estable_entre_llamadas(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ccc3")
        cliente = _cliente(u)
        _fiado(u, cliente["id"], "500.00")
        _cobro(u, cliente["id"], "200.00")

        r1 = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        r2 = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        assert r1.status_code == r2.status_code == 200
        assert r1.json() == r2.json()


class TestNotFound:
    def test_cliente_ajeno_da_404(self, app_with_db):
        u_a = make_user_client(app_with_db, prefix="ccc4a")
        u_b = make_user_client(app_with_db, prefix="ccc4b")
        cliente_b = _cliente(u_b)

        resp = u_a.get(f"/api/clientes/{cliente_b['id']}/cuenta-corriente")
        assert resp.status_code == 404

    def test_cliente_inexistente_da_404(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ccc5")
        resp = u.get(f"/api/clientes/{uuid.uuid4()}/cuenta-corriente")
        assert resp.status_code == 404

    def test_cliente_eliminado_da_404(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ccc6")
        cliente = _cliente(u)
        del_resp = u.delete(f"/api/clientes/{cliente['id']}")
        assert del_resp.status_code == 204

        resp = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        assert resp.status_code == 404


class TestMethodNotAllowed:
    def test_post_da_405(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ccc7")
        cliente = _cliente(u)
        resp = u.post(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        assert resp.status_code == 405
