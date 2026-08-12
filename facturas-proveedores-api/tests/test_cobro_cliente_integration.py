"""
Integration tests for /api/cobros (C-35). Task 8.2, 8.3, 8.6, 8.7.

HTTP-level tests against the real FastAPI app + Postgres (testcontainers),
following the test_pago_integration.py / test_c33_ventas.py pattern.
"""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_anon_client, make_teammate_client, make_user_client


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


def _cobro_payload(cliente_id: str, **overrides) -> dict:
    payload = {
        "cliente_id": cliente_id,
        "monto": "100.00",
        "fecha": str(date.today()),
        "metodo": "EFECTIVO",
    }
    payload.update(overrides)
    return payload


class TestCrudFeliz:
    """Task 8.2 — create, read, list, patch, delete through the HTTP layer."""

    def test_ciclo_completo(self, app_with_db):
        u = make_user_client(app_with_db, prefix="cc1")
        cliente = _cliente(u)
        _fiado(u, cliente["id"], "1000.00")

        creado = u.post("/api/cobros", json=_cobro_payload(cliente["id"], monto="300.00"))
        assert creado.status_code == 201, creado.text
        cobro_id = creado.json()["id"]
        assert creado.json()["negocio_id"] == u.negocio_id

        leido = u.get(f"/api/cobros/{cobro_id}")
        assert leido.status_code == 200
        assert leido.json()["monto"] == "300.00"

        listado = u.get("/api/cobros")
        assert listado.status_code == 200
        assert listado.json()["total"] == 1

        editado = u.patch(f"/api/cobros/{cobro_id}", json={"monto": "500.00"})
        assert editado.status_code == 200
        assert editado.json()["monto"] == "500.00"

        eliminado = u.delete(f"/api/cobros/{cobro_id}")
        assert eliminado.status_code == 204

        tras_borrar = u.get(f"/api/cobros/{cobro_id}")
        assert tras_borrar.status_code == 404

    def test_payload_no_puede_fijar_el_dueno(self, app_with_db):
        u = make_user_client(app_with_db, prefix="cc2")
        cliente = _cliente(u)
        _fiado(u, cliente["id"])

        resp = u.post(
            "/api/cobros",
            json=_cobro_payload(cliente["id"], negocio_id=str(uuid.uuid4())),
        )
        assert resp.status_code == 422


class TestRnCcc04Http:
    """Task 8.3 — the RN-CCC-04 rejection, distinguishable from other 422s."""

    def test_pago_supera_saldo_da_422_con_mensaje_accionable(self, app_with_db):
        u = make_user_client(app_with_db, prefix="cc3")
        cliente = _cliente(u)
        _fiado(u, cliente["id"], "1000.00")

        resp = u.post("/api/cobros", json=_cobro_payload(cliente["id"], monto="1500.00"))
        assert resp.status_code == 422
        detail = str(resp.json()["detail"])
        assert "1000" in detail

    def test_se_distingue_del_422_por_monto_invalido(self, app_with_db):
        u = make_user_client(app_with_db, prefix="cc4")
        cliente = _cliente(u)
        _fiado(u, cliente["id"], "1000.00")

        resp_saldo = u.post("/api/cobros", json=_cobro_payload(cliente["id"], monto="5000.00"))
        resp_monto = u.post("/api/cobros", json=_cobro_payload(cliente["id"], monto="0.00"))

        assert resp_saldo.status_code == 422
        assert resp_monto.status_code == 422
        assert resp_saldo.json()["detail"] != resp_monto.json()["detail"]


class TestNoRedirectC27:
    """Task 8.6 — /api/cobros and /api/cobros/ both answer without 307."""

    @pytest.mark.parametrize("path", ["/api/cobros", "/api/cobros/"])
    def test_get_responde_directo(self, app_with_db, path):
        u = make_user_client(app_with_db, prefix="cc5")
        resp = u.get(path, follow_redirects=False)
        assert resp.status_code == 200

    @pytest.mark.parametrize("path", ["/api/cobros", "/api/cobros/"])
    def test_post_responde_directo(self, app_with_db, path):
        u = make_user_client(app_with_db, prefix="cc6")
        cliente = _cliente(u)
        _fiado(u, cliente["id"])
        resp = u.post(path, json=_cobro_payload(cliente["id"]), follow_redirects=False)
        assert resp.status_code == 201


class TestCompartidoEntreMiembros:
    """Task 8.7 — two members of the same negocio share the data."""

    def test_un_miembro_ve_el_cobro_de_otro(self, app_with_db, engine):
        u = make_user_client(app_with_db, prefix="cc7")
        colega = make_teammate_client(app_with_db, engine, u)

        cliente = _cliente(u)
        _fiado(u, cliente["id"], "1000.00")
        creado = u.post("/api/cobros", json=_cobro_payload(cliente["id"], monto="200.00"))
        assert creado.status_code == 201

        listado = colega.get("/api/cobros")
        assert listado.status_code == 200
        ids = {item["id"] for item in listado.json()["items"]}
        assert creado.json()["id"] in ids


class TestAislamiento:
    def test_cobro_de_otro_negocio_404_en_get_patch_delete(self, app_with_db):
        u_a = make_user_client(app_with_db, prefix="cc8a")
        u_b = make_user_client(app_with_db, prefix="cc8b")

        cliente_b = _cliente(u_b)
        _fiado(u_b, cliente_b["id"], "1000.00")
        cobro_b = u_b.post("/api/cobros", json=_cobro_payload(cliente_b["id"], monto="100.00"))
        assert cobro_b.status_code == 201
        cobro_id = cobro_b.json()["id"]

        assert u_a.get(f"/api/cobros/{cobro_id}").status_code == 404
        assert u_a.patch(f"/api/cobros/{cobro_id}", json={"monto": "1.00"}).status_code == 404
        assert u_a.delete(f"/api/cobros/{cobro_id}").status_code == 404

    def test_filtro_por_cliente_ajeno_da_404_no_lista_vacia(self, app_with_db):
        u_a = make_user_client(app_with_db, prefix="cc9a")
        u_b = make_user_client(app_with_db, prefix="cc9b")
        cliente_b = _cliente(u_b)

        resp = u_a.get("/api/cobros", params={"cliente_id": cliente_b["id"]})
        assert resp.status_code == 404

    def test_cliente_id_no_modificable_por_patch(self, app_with_db):
        u = make_user_client(app_with_db, prefix="cc10")
        cliente_1 = _cliente(u)
        cliente_2 = _cliente(u)
        _fiado(u, cliente_1["id"], "1000.00")

        creado = u.post("/api/cobros", json=_cobro_payload(cliente_1["id"], monto="100.00"))
        assert creado.status_code == 201

        resp = u.patch(
            f"/api/cobros/{creado.json()['id']}", json={"cliente_id": cliente_2["id"]}
        )
        assert resp.status_code == 422


class TestUnauthenticated:
    def test_sin_sesion_da_401(self, app_with_db):
        anon = make_anon_client(app_with_db)
        resp = anon.get("/api/cobros")
        assert resp.status_code == 401
