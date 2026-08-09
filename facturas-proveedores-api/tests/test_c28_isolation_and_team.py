"""
C-28 — end-to-end proof of the new axis, from both sides.

Two halves, and both matter:

1. Cross-negocio: shop B must not reach shop A's data, on any verb, for any
   resource. 404, never 403, and A's row unchanged.
2. Same-negocio: two members of ONE shop must see and operate the SAME data,
   including rows the other one loaded. This is the half that did not exist
   before C-28 and is the entire point of the change — without it the swap
   would just be a rename.

Written against the HTTP surface on purpose: this is the boundary a real client
crosses, and the one where a scoping mistake actually leaks.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401 — register table metadata
from tests.conftest import make_teammate_client, make_user_client


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture(scope="module")
def app_with_db(engine, env_vars):
    """App wired to the test DB, with every router's get_db overridden.

    RN-TEST-01 / D-22: `get_db` is imported from each ROUTER module, not from
    `app.core.deps`, so the override key matches the object the registered
    routes actually depend on.
    """
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.actividad import get_db as get_db_actividad
    from app.routers.auth import get_db as get_db_auth
    from app.routers.facturas import get_db as get_db_facturas
    from app.routers.pagos import get_db as get_db_pagos
    from app.routers.proveedores import get_db as get_db_proveedores
    from app.routers.usuarios import get_db as get_db_usuarios

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    # Written out one by one, not in a loop: `test_dependency_override_imports`
    # walks the AST to prove each override key is imported from an
    # `app.routers.*` module (C-25), and it cannot trace a loop variable.
    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_proveedores] = override_get_db
    app.dependency_overrides[get_db_facturas] = override_get_db
    app.dependency_overrides[get_db_pagos] = override_get_db
    app.dependency_overrides[get_db_actividad] = override_get_db

    yield app

    app.dependency_overrides.clear()


def _crear_proveedor(client: TestClient, nombre: str = "Proveedor Test") -> dict:
    respuesta = client.post("/api/proveedores", json={"nombre": nombre})
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _crear_factura(client: TestClient, proveedor_id: str, monto="1000.00") -> dict:
    respuesta = client.post(
        "/api/facturas",
        json={
            "proveedor_id": proveedor_id,
            "fecha_emision": str(date(2026, 1, 10)),
            "monto_total": monto,
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _crear_pago(client: TestClient, proveedor_id: str, monto="250.00") -> dict:
    respuesta = client.post(
        "/api/pagos",
        json={
            "proveedor_id": proveedor_id,
            "monto": monto,
            "fecha": str(date(2026, 1, 12)),
            "metodo": "EFECTIVO",
        },
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


@pytest.fixture(scope="module")
def dos_negocios(app_with_db, engine):
    """Shop A (with data) and shop B (an outsider)."""
    a = make_user_client(app_with_db, prefix="negA")
    b = make_user_client(app_with_db, prefix="negB")

    proveedor = _crear_proveedor(a, "Distribuidora A")
    factura = _crear_factura(a, proveedor["id"])
    pago = _crear_pago(a, proveedor["id"])

    return {"a": a, "b": b, "proveedor": proveedor, "factura": factura, "pago": pago}


class TestCrossNegocioIsolation:
    """Task 8.1 — nothing crosses the tenant boundary."""

    def test_negocios_are_distinct(self, dos_negocios):
        assert dos_negocios["a"].negocio_id != dos_negocios["b"].negocio_id

    def test_outsider_listings_are_empty(self, dos_negocios):
        b = dos_negocios["b"]
        for ruta in ("/api/proveedores", "/api/facturas", "/api/pagos"):
            respuesta = b.get(ruta)
            assert respuesta.status_code == 200, respuesta.text
            cuerpo = respuesta.json()
            items = cuerpo["items"] if isinstance(cuerpo, dict) else cuerpo
            assert items == [], f"{ruta} filtró datos de otro negocio: {items}"

    @pytest.mark.parametrize(
        "recurso,ruta",
        [("proveedor", "/api/proveedores"), ("factura", "/api/facturas"), ("pago", "/api/pagos")],
    )
    def test_outsider_get_returns_404(self, dos_negocios, recurso, ruta):
        b = dos_negocios["b"]
        respuesta = b.get(f"{ruta}/{dos_negocios[recurso]['id']}")
        assert respuesta.status_code == 404, respuesta.text

    @pytest.mark.parametrize(
        "recurso,ruta,payload",
        [
            ("proveedor", "/api/proveedores", {"nombre": "Hackeado"}),
            ("factura", "/api/facturas", {"monto_total": "99999.00"}),
            ("pago", "/api/pagos", {"monto": "99999.00"}),
        ],
    )
    def test_outsider_patch_returns_404_and_changes_nothing(
        self, dos_negocios, recurso, ruta, payload
    ):
        a, b = dos_negocios["a"], dos_negocios["b"]
        recurso_id = dos_negocios[recurso]["id"]

        antes = a.get(f"{ruta}/{recurso_id}").json()
        respuesta = b.patch(f"{ruta}/{recurso_id}", json=payload)
        assert respuesta.status_code == 404, respuesta.text

        despues = a.get(f"{ruta}/{recurso_id}").json()
        assert despues == antes, f"el PATCH ajeno modificó el {recurso}"

    @pytest.mark.parametrize(
        "recurso,ruta",
        [("proveedor", "/api/proveedores"), ("factura", "/api/facturas"), ("pago", "/api/pagos")],
    )
    def test_outsider_delete_returns_404_and_changes_nothing(
        self, dos_negocios, recurso, ruta
    ):
        a, b = dos_negocios["a"], dos_negocios["b"]
        recurso_id = dos_negocios[recurso]["id"]

        respuesta = b.delete(f"{ruta}/{recurso_id}")
        assert respuesta.status_code == 404, respuesta.text
        assert a.get(f"{ruta}/{recurso_id}").status_code == 200

    def test_outsider_cannot_read_the_cuenta_corriente(self, dos_negocios):
        b = dos_negocios["b"]
        proveedor_id = dos_negocios["proveedor"]["id"]
        respuesta = b.get(f"/api/proveedores/{proveedor_id}/cuenta-corriente")
        assert respuesta.status_code == 404, respuesta.text

    def test_outsider_cannot_attach_to_a_foreign_proveedor(self, dos_negocios):
        b = dos_negocios["b"]
        proveedor_id = dos_negocios["proveedor"]["id"]

        factura = b.post(
            "/api/facturas",
            json={
                "proveedor_id": proveedor_id,
                "fecha_emision": str(date(2026, 1, 10)),
                "monto_total": "500.00",
            },
        )
        pago = b.post(
            "/api/pagos",
            json={
                "proveedor_id": proveedor_id,
                "monto": "500.00",
                "fecha": str(date(2026, 1, 12)),
                "metodo": "EFECTIVO",
            },
        )
        assert factura.status_code == 404, factura.text
        assert pago.status_code == 404, pago.text


class TestSameNegocioTeamwork:
    """Task 8.2 — the half the old per-user axis could not express."""

    @pytest.fixture(scope="class")
    def equipo(self, app_with_db, engine):
        duenio = make_user_client(app_with_db, prefix="duenio")
        empleado = make_teammate_client(app_with_db, engine, duenio)
        proveedor = _crear_proveedor(duenio, "Proveedor Compartido")
        return {"duenio": duenio, "empleado": empleado, "proveedor": proveedor}

    def test_teammates_share_one_negocio(self, equipo):
        assert equipo["duenio"].negocio_id == equipo["empleado"].negocio_id
        assert equipo["duenio"].usuario_id != equipo["empleado"].usuario_id

    def test_teammate_sees_a_supplier_they_did_not_create(self, equipo):
        respuesta = equipo["empleado"].get(f"/api/proveedores/{equipo['proveedor']['id']}")
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.json()["nombre"] == "Proveedor Compartido"

    def test_teammate_can_load_against_that_supplier(self, equipo):
        factura = _crear_factura(equipo["empleado"], equipo["proveedor"]["id"], "700.00")
        assert factura["proveedor_id"] == equipo["proveedor"]["id"]

    def test_owner_sees_what_the_teammate_loaded(self, equipo):
        _crear_pago(equipo["empleado"], equipo["proveedor"]["id"], "300.00")

        pagos = equipo["duenio"].get(
            f"/api/pagos?proveedor_id={equipo['proveedor']['id']}"
        )
        assert pagos.status_code == 200, pagos.text
        montos = [p["monto"] for p in pagos.json()["items"]]
        assert any(Decimal(m) == Decimal("300.00") for m in montos), (
            f"el dueño no ve el pago que cargó su empleado: {montos}"
        )

    def test_teammate_can_update_a_supplier_created_by_the_owner(self, equipo):
        respuesta = equipo["empleado"].patch(
            f"/api/proveedores/{equipo['proveedor']['id']}",
            json={"telefono": "1122334455"},
        )
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.json()["telefono"] == "1122334455"

    def test_cuenta_corriente_is_shared(self, equipo):
        cc_duenio = equipo["duenio"].get(
            f"/api/proveedores/{equipo['proveedor']['id']}/cuenta-corriente"
        )
        cc_empleado = equipo["empleado"].get(
            f"/api/proveedores/{equipo['proveedor']['id']}/cuenta-corriente"
        )

        assert cc_duenio.status_code == 200 and cc_empleado.status_code == 200
        assert cc_duenio.json()["saldo"] == cc_empleado.json()["saldo"]


class TestPayloadCannotForgeTheAxis:
    """Task 7.1 — the tenant key comes from the session, never from the wire."""

    def test_negocio_id_in_the_payload_is_ignored(self, dos_negocios, engine):
        from sqlalchemy import text

        a, b = dos_negocios["a"], dos_negocios["b"]

        respuesta = a.post(
            "/api/proveedores",
            json={"nombre": "Intento de forge", "negocio_id": b.negocio_id},
        )
        assert respuesta.status_code == 201, respuesta.text

        with engine.connect() as conn:
            negocio_real = conn.execute(
                text("SELECT negocio_id FROM proveedor WHERE id = :id"),
                {"id": uuid.UUID(respuesta.json()["id"])},
            ).scalar()

        assert str(negocio_real) == a.negocio_id
        assert str(negocio_real) != b.negocio_id

    def test_authorship_is_recorded_on_create(self, dos_negocios, engine):
        from sqlalchemy import text

        a = dos_negocios["a"]
        proveedor = _crear_proveedor(a, "Con autoría")

        with engine.connect() as conn:
            autor = conn.execute(
                text("SELECT creado_por_usuario_id FROM proveedor WHERE id = :id"),
                {"id": uuid.UUID(proveedor["id"])},
            ).scalar()

        assert str(autor) == a.usuario_id
