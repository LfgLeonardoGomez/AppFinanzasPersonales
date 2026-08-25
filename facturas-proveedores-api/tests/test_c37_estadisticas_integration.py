"""
Integration tests for /api/estadisticas (C-37) — tasks 4.x, 5.x, 6.x, 7.x, 8.x.

Runs against real Postgres (testcontainers) via FastAPI TestClient, same
pattern as test_c33_ventas.py / test_factura_integration.py.

The single test this whole change exists to protect (design.md D3, Risks):
a fiado cobrado must count as a sale exactly once, and a factura pagada must
count as a purchase exactly once — see
`TestAgregacionVentas.test_fiado_cobrado_cuenta_una_sola_vez_trampa_de_dominio`
and `TestAgregacionCompras.test_factura_pagada_cuenta_una_sola_vez_trampa_de_dominio`.
"""

import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_anon_client, make_user_client

# A fixed month safely in the past relative to any plausible test run date,
# with no ambiguity about month length or DST — used for period-boundary
# assertions (tasks 4.6, 5.6).
_ENE = date(2026, 1, 1)
_ENE_FIN = date(2026, 1, 31)
_FEB = date(2026, 2, 1)


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    # SQLModel's create_all does not apply the CHECK from migration 0010
    # (same workaround as test_c33_ventas.py) — needed because these tests
    # create fiados (CUENTA_CORRIENTE ventas).
    with eng.begin() as conn:
        conn.execute(
            text(
                "ALTER TABLE venta DROP CONSTRAINT IF EXISTS ck_venta_fiado_tiene_cliente"
            )
        )
        conn.execute(
            text(
                "ALTER TABLE venta ADD CONSTRAINT ck_venta_fiado_tiene_cliente "
                "CHECK ((forma_pago = 'CUENTA_CORRIENTE') = (cliente_id IS NOT NULL))"
            )
        )
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def est_app(engine, env_vars):
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.estadisticas import get_db

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db] = override_get_db

    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


@pytest.fixture
def user(est_app) -> TestClient:
    return make_user_client(est_app, prefix="est")


# ── Domain helpers ────────────────────────────────────────────────────────────


def _proveedor(client: TestClient) -> dict:
    resp = client.post(
        "/api/proveedores/",
        json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _factura(client: TestClient, proveedor_id: str, **overrides) -> dict:
    payload = {
        "proveedor_id": proveedor_id,
        "fecha_emision": _ENE.isoformat(),
        "monto_total": "100.00",
    }
    payload.update(overrides)
    resp = client.post("/api/facturas/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _pago(client: TestClient, proveedor_id: str, monto: str = "100.00", **overrides) -> dict:
    payload = {
        "proveedor_id": proveedor_id,
        "monto": monto,
        "fecha": _ENE.isoformat(),
        "metodo": "EFECTIVO",
    }
    payload.update(overrides)
    resp = client.post("/api/pagos/", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _cliente(client: TestClient) -> dict:
    resp = client.post("/api/clientes", json={"nombre": f"Cli {uuid.uuid4().hex[:6]}"})
    assert resp.status_code == 201, resp.text
    return resp.json()


def _venta(client: TestClient, **overrides) -> dict:
    payload = {
        "monto": "100.00",
        "fecha": _ENE.isoformat(),
        "forma_pago": "EFECTIVO",
    }
    payload.update(overrides)
    resp = client.post("/api/ventas", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _fiado(client: TestClient, cliente_id: str, monto: str = "100.00", **overrides) -> dict:
    return _venta(
        client, monto=monto, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente_id, **overrides
    )


def _cobro(client: TestClient, cliente_id: str, monto: str, **overrides) -> dict:
    payload = {
        "cliente_id": cliente_id,
        "monto": monto,
        "fecha": _ENE.isoformat(),
        "metodo": "EFECTIVO",
    }
    payload.update(overrides)
    resp = client.post("/api/cobros", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


def _compras(client: TestClient, **params) -> dict:
    q = {"desde": _ENE.isoformat(), "hasta": _ENE_FIN.isoformat(), "granularidad": "mes"}
    q.update(params)
    resp = client.get("/api/estadisticas/compras", params=q)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _ventas_stats(client: TestClient, **params) -> dict:
    q = {"desde": _ENE.isoformat(), "hasta": _ENE_FIN.isoformat(), "granularidad": "mes"}
    q.update(params)
    resp = client.get("/api/estadisticas/ventas", params=q)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _periodo_total(payload: dict, periodo_inicio: str) -> str:
    for p in payload["periodos"]:
        if p["periodo"] == periodo_inicio:
            return p["total"]
    raise AssertionError(f"periodo {periodo_inicio} ausente de {payload['periodos']}")


# ── 4.x — compras aggregation ────────────────────────────────────────────────


class TestAgregacionCompras:
    def test_suma_monto_total_agrupado_por_periodo(self, user):
        prov = _proveedor(user)
        _factura(user, prov["id"], monto_total="150.00")
        _factura(user, prov["id"], monto_total="50.00")

        data = _compras(user)
        assert _periodo_total(data, _ENE.isoformat()) == "200.00"

    def test_factura_pagada_cuenta_una_sola_vez_trampa_de_dominio(self, user):
        """
        D3 — the trap this whole change exists to guard: `factura.monto_total`
        is the purchase; `pago.monto` cancels it, and is NOT a second
        purchase. Verified by mutation below (adding Pago to the aggregation
        makes this fail — see the mutation check run separately).
        """
        prov = _proveedor(user)
        _factura(user, prov["id"], monto_total="300.00")
        _pago(user, prov["id"], monto="300.00")

        data = _compras(user, proveedor_id=prov["id"])
        assert _periodo_total(data, _ENE.isoformat()) == "300.00"

    def test_factura_eliminada_no_cuenta(self, user):
        prov = _proveedor(user)
        factura = _factura(user, prov["id"], monto_total="80.00")

        del_resp = user.delete(f"/api/facturas/{factura['id']}")
        assert del_resp.status_code == 204

        data = _compras(user, proveedor_id=prov["id"])
        assert _periodo_total(data, _ENE.isoformat()) == "0.00"

    def test_acotar_por_proveedor(self, user):
        prov_a = _proveedor(user)
        prov_b = _proveedor(user)
        _factura(user, prov_a["id"], monto_total="40.00")
        _factura(user, prov_b["id"], monto_total="60.00")

        data_a = _compras(user, proveedor_id=prov_a["id"])
        data_b = _compras(user, proveedor_id=prov_b["id"])
        data_todos = _compras(user)

        total_a = _periodo_total(data_a, _ENE.isoformat())
        total_b = _periodo_total(data_b, _ENE.isoformat())
        total_todos = _periodo_total(data_todos, _ENE.isoformat())

        assert total_a == "40.00"
        assert total_b == "60.00"
        assert total_todos == "100.00"

    def test_proveedor_de_otro_negocio_da_404(self, user, est_app):
        otro = make_user_client(est_app, prefix="estx")
        prov_ajeno = _proveedor(otro)

        resp = user.get(
            "/api/estadisticas/compras",
            params={
                "desde": _ENE.isoformat(),
                "hasta": _ENE_FIN.isoformat(),
                "granularidad": "mes",
                "proveedor_id": prov_ajeno["id"],
            },
        )
        assert resp.status_code == 404

    def test_movimientos_de_borde_cuentan_en_periodo_correcto(self, user):
        prov = _proveedor(user)
        _factura(user, prov["id"], monto_total="10.00", fecha_emision=_ENE.isoformat())
        _factura(user, prov["id"], monto_total="20.00", fecha_emision=_ENE_FIN.isoformat())

        data = _compras(user, proveedor_id=prov["id"])
        assert len(data["periodos"]) == 1
        assert _periodo_total(data, _ENE.isoformat()) == "30.00"


# ── 5.x — ventas aggregation + desglose ──────────────────────────────────────


class TestAgregacionVentas:
    def test_suma_monto_agrupado_por_periodo(self, user):
        _venta(user, monto="70.00")
        _venta(user, monto="30.00")

        data = _ventas_stats(user)
        assert _periodo_total(data, _ENE.isoformat()) == "100.00"

    def test_fiado_cobrado_cuenta_una_sola_vez_trampa_de_dominio(self, user):
        """
        The single most important test in this change (design.md D3, task
        5.2). A fiado is already a sale the day it happens (RN-VTA-02); its
        cobro is the same money arriving, not a second sale. Verified by
        mutation separately (including CobroCliente in the aggregation makes
        this fail).
        """
        cliente = _cliente(user)
        _fiado(user, cliente["id"], monto="500.00")
        _cobro(user, cliente["id"], monto="500.00")

        data = _ventas_stats(user)
        assert _periodo_total(data, _ENE.isoformat()) == "500.00"

    def test_desglose_suma_el_total(self, user):
        cliente = _cliente(user)
        _venta(user, monto="10.00", forma_pago="EFECTIVO")
        _venta(user, monto="20.00", forma_pago="TRANSFERENCIA")
        _venta(user, monto="30.00", forma_pago="TARJETA")
        _venta(user, monto="40.00", forma_pago="OTRO")
        _fiado(user, cliente["id"], monto="50.00")

        data = _ventas_stats(user)
        periodo = next(p for p in data["periodos"] if p["periodo"] == _ENE.isoformat())

        suma_desglose = sum(float(v) for v in periodo["desglose"].values())
        assert suma_desglose == float(periodo["total"])
        assert periodo["total"] == "150.00"

    def test_cuenta_corriente_aparece_en_desglose(self, user):
        cliente = _cliente(user)
        _fiado(user, cliente["id"], monto="90.00")

        data = _ventas_stats(user)
        periodo = next(p for p in data["periodos"] if p["periodo"] == _ENE.isoformat())
        assert periodo["desglose"]["CUENTA_CORRIENTE"] == "90.00"

    # Soft-deleted-sale coverage lives in `TestVentaEliminadaAislada` below,
    # on its OWN negocio — this class shares one `user` fixture per test but
    # earlier tests in the same class already posted other ventas into the
    # same período, so a "total went to zero" assertion here would be
    # meaningless (it would still be nonzero from those other rows).

    def test_movimientos_de_borde_cuentan_en_periodo_correcto(self, user):
        # Monday 2026-01-05 .. Sunday 2026-01-11 (ISO week, D4).
        inicio_semana = date(2026, 1, 5)
        fin_semana = date(2026, 1, 11)
        _venta(user, monto="15.00", fecha=inicio_semana.isoformat())
        _venta(user, monto="25.00", fecha=fin_semana.isoformat())

        resp = user.get(
            "/api/estadisticas/ventas",
            params={
                "desde": inicio_semana.isoformat(),
                "hasta": fin_semana.isoformat(),
                "granularidad": "semana",
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["periodos"]) == 1
        assert data["periodos"][0]["total"] == "40.00"


class TestVentaEliminadaAislada:
    """Own negocio, so the zero assertion cannot be masked by another test."""

    def test_venta_eliminada_no_cuenta_ni_en_total_ni_en_desglose(self, est_app):
        u = make_user_client(est_app, prefix="estdel")
        venta = _venta(u, monto="65.00")

        del_resp = u.delete(f"/api/ventas/{venta['id']}")
        assert del_resp.status_code == 204

        data = _ventas_stats(u)
        periodo = next(p for p in data["periodos"] if p["periodo"] == _ENE.isoformat())
        assert periodo["total"] == "0.00"
        assert periodo["desglose"]["EFECTIVO"] == "0.00"


# ── 6.x — tope de períodos ────────────────────────────────────────────────────


class TestTopeDePeriodos:
    def test_rango_largo_granularidad_diaria_se_rechaza_422(self, user):
        resp = user.get(
            "/api/estadisticas/ventas",
            params={"desde": "2020-01-01", "hasta": "2026-01-01", "granularidad": "dia"},
        )
        assert resp.status_code == 422
        body = resp.json()
        detalle = body["detail"]
        assert "periodos_estimados" in detalle
        assert "tope" in detalle
        assert detalle["periodos_estimados"] > detalle["tope"]

    def test_mismo_rango_granularidad_gruesa_funciona(self, user):
        resp = user.get(
            "/api/estadisticas/ventas",
            params={"desde": "2020-01-01", "hasta": "2026-01-01", "granularidad": "mes"},
        )
        assert resp.status_code == 200

    def test_al_exceder_tope_no_hay_serie_ni_recortada(self, user):
        resp = user.get(
            "/api/estadisticas/ventas",
            params={"desde": "2020-01-01", "hasta": "2026-01-01", "granularidad": "dia"},
        )
        assert resp.status_code == 422
        assert "periodos" not in resp.json()

    def test_tope_es_sobre_cantidad_no_sobre_longitud_del_rango(self, user):
        # 5+ years by month: comfortably under the tope.
        resp_mes = user.get(
            "/api/estadisticas/compras",
            params={"desde": "2020-01-01", "hasta": "2026-01-01", "granularidad": "mes"},
        )
        assert resp_mes.status_code == 200
        # Same range by day: well over it.
        resp_dia = user.get(
            "/api/estadisticas/compras",
            params={"desde": "2020-01-01", "hasta": "2026-01-01", "granularidad": "dia"},
        )
        assert resp_dia.status_code == 422


# ── 7.x — resumen / EstadisticasService composition ──────────────────────────


class TestResumen:
    def test_devuelve_compras_ventas_y_diferencia(self, est_app):
        u = make_user_client(est_app, prefix="estr1")
        prov = _proveedor(u)
        _factura(u, prov["id"], monto_total="100.00")
        _venta(u, monto="150.00")

        resp = u.get(
            "/api/estadisticas/resumen",
            params={"desde": _ENE.isoformat(), "hasta": _ENE_FIN.isoformat()},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["compras"] == "100.00"
        assert data["ventas"] == "150.00"
        assert data["diferencia"] == "50.00"

    def test_no_tiene_tope_de_periodos_a_diferencia_de_compras_y_ventas(self, est_app):
        """
        Non-obvious design decision (service docstring): `resumen` has no
        `granularidad` param and never zero-fills or returns periods, so a
        range that would 422 on /compras or /ventas (D5's tope) must still
        succeed here — it is a scalar, not a series.
        """
        u = make_user_client(est_app, prefix="estrtope")

        # Same range that TestTopeDePeriodos proves rejects /ventas?granularidad=dia.
        rechazado = u.get(
            "/api/estadisticas/ventas",
            params={"desde": "2020-01-01", "hasta": "2026-01-01", "granularidad": "dia"},
        )
        assert rechazado.status_code == 422

        resp = u.get(
            "/api/estadisticas/resumen",
            params={"desde": "2020-01-01", "hasta": "2026-01-01"},
        )
        assert resp.status_code == 200
        assert "periodos" not in resp.json()

    def test_coincide_con_los_totales_individuales(self, est_app):
        u = make_user_client(est_app, prefix="estr2")
        prov = _proveedor(u)
        cliente = _cliente(u)
        _factura(u, prov["id"], monto_total="120.00")
        _factura(u, prov["id"], monto_total="30.00", fecha_emision=_FEB.isoformat())
        _venta(u, monto="200.00")
        _fiado(u, cliente["id"], monto="80.00", fecha=_FEB.isoformat())

        desde, hasta = _ENE.isoformat(), date(2026, 2, 28).isoformat()

        compras = _compras(u, desde=desde, hasta=hasta)
        ventas = _ventas_stats(u, desde=desde, hasta=hasta)
        resumen_resp = u.get(
            "/api/estadisticas/resumen", params={"desde": desde, "hasta": hasta}
        )
        assert resumen_resp.status_code == 200
        resumen = resumen_resp.json()

        suma_compras = sum(float(p["total"]) for p in compras["periodos"])
        suma_ventas = sum(float(p["total"]) for p in ventas["periodos"])

        assert suma_compras == float(resumen["compras"])
        assert suma_ventas == float(resumen["ventas"])

    def test_no_expone_margen_ni_rentabilidad(self, est_app):
        u = make_user_client(est_app, prefix="estr3")
        resp = u.get(
            "/api/estadisticas/resumen",
            params={"desde": _ENE.isoformat(), "hasta": _ENE_FIN.isoformat()},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "margen" not in data
        assert "rentabilidad" not in data
        assert set(data.keys()) == {"desde", "hasta", "compras", "ventas", "diferencia"}

    def test_aislamiento_por_negocio(self, est_app):
        u_a = make_user_client(est_app, prefix="estraisa")
        u_b = make_user_client(est_app, prefix="estraisb")

        _venta(u_a, monto="500.00")
        _venta(u_b, monto="999.00")

        resp_a = u_a.get(
            "/api/estadisticas/resumen",
            params={"desde": _ENE.isoformat(), "hasta": _ENE_FIN.isoformat()},
        )
        assert resp_a.status_code == 200
        assert resp_a.json()["ventas"] == "500.00"


# ── 8.x — router end to end ───────────────────────────────────────────────────


class TestRouterEndToEnd:
    def test_get_ventas_con_rango_y_granularidad(self, est_app):
        u = make_user_client(est_app, prefix="este2e1")
        _venta(u, monto="55.00")

        data = _ventas_stats(u)
        assert data["granularidad"] == "mes"
        assert len(data["periodos"]) == 1
        assert "desglose" in data["periodos"][0]

    def test_get_compras_con_y_sin_proveedor(self, est_app):
        u = make_user_client(est_app, prefix="este2e2")
        prov = _proveedor(u)
        _factura(u, prov["id"], monto_total="45.00")

        con_filtro = _compras(u, proveedor_id=prov["id"])
        sin_filtro = _compras(u)
        assert con_filtro["proveedor_id"] == prov["id"]
        assert sin_filtro["proveedor_id"] is None

    def test_get_resumen(self, est_app):
        u = make_user_client(est_app, prefix="este2e3")
        resp = u.get(
            "/api/estadisticas/resumen",
            params={"desde": _ENE.isoformat(), "hasta": _ENE_FIN.isoformat()},
        )
        assert resp.status_code == 200

    def test_granularidad_no_soportada_da_422(self, user):
        resp = user.get(
            "/api/estadisticas/ventas",
            params={
                "desde": _ENE.isoformat(),
                "hasta": _ENE_FIN.isoformat(),
                "granularidad": "anio",
            },
        )
        assert resp.status_code == 422

    def test_sin_sesion_da_401(self, est_app):
        anon = make_anon_client(est_app)
        resp = anon.get(
            "/api/estadisticas/ventas",
            params={
                "desde": _ENE.isoformat(),
                "hasta": _ENE_FIN.isoformat(),
                "granularidad": "mes",
            },
        )
        assert resp.status_code == 401
