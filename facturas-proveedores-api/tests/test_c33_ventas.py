"""
C-33 — sales, and the invariant that makes the fiado work.

What needs proving here is not that a sale can be recorded. It is:

1. The pair (forma_pago, cliente_id) holds in BOTH directions — a fiado with no
   customer is money owed by nobody, and a cash sale carrying a customer is
   noise someone will later read as debt.
2. Correcting a sale validates the RESULTING pair, not the fields that arrived.
   Switching to EFECTIVO without mentioning the customer must end with no
   customer, not with a cash sale dragging one.
3. A fiado is a sale — it shows up in the day's list next to the cash ones, and
   deleting it takes its charge off the customer's account.
4. Nothing crosses between negocios.
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo
from datetime import datetime

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import make_anon_client, make_teammate_client, make_user_client

_HOY = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    # SQLModel's create_all does not know about the CHECK (it lives in migration
    # 0010), so it is added here to match production behaviour.
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
def app_with_db(engine, env_vars):
    from app.core.deps import reset_rate_limit_store
    from app.main import app
    from app.routers.auth import get_db as get_db_auth
    from app.routers.clientes import get_db as get_db_clientes
    from app.routers.usuarios import get_db as get_db_usuarios
    from app.routers.ventas import get_db as get_db_ventas

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_clientes] = override_get_db
    app.dependency_overrides[get_db_ventas] = override_get_db

    yield app

    app.dependency_overrides.clear()


def _cliente(usuario: TestClient, nombre: str | None = None) -> dict:
    respuesta = usuario.post(
        "/api/clientes", json={"nombre": nombre or f"Cliente {uuid.uuid4().hex[:6]}"}
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _venta(usuario: TestClient, **campos):
    cuerpo = {
        "monto": "1000.00",
        "fecha": str(_HOY),
        "forma_pago": "EFECTIVO",
        **campos,
    }
    return usuario.post("/api/ventas", json=cuerpo)


class TestVentaAlContado:
    def test_alta_minima(self, app_with_db):
        u = make_user_client(app_with_db, prefix="v1")
        respuesta = _venta(u, monto="2500.50")

        assert respuesta.status_code == 201, respuesta.text
        cuerpo = respuesta.json()
        assert cuerpo["cliente_id"] is None
        assert cuerpo["forma_pago"] == "EFECTIVO"
        assert Decimal(cuerpo["monto"]) == Decimal("2500.50")

    @pytest.mark.parametrize("monto", ["0", "0.00", "-100.00"])
    def test_monto_no_positivo_rechazado(self, app_with_db, monto):
        u = make_user_client(app_with_db, prefix="v2")
        assert _venta(u, monto=monto).status_code == 422

    def test_fecha_futura_rechazada(self, app_with_db):
        u = make_user_client(app_with_db, prefix="v3")
        manana = _HOY + timedelta(days=1)
        assert _venta(u, fecha=str(manana)).status_code == 422

    def test_fecha_de_hoy_aceptada(self, app_with_db):
        """El borde: hoy NO es futuro."""
        u = make_user_client(app_with_db, prefix="v4")
        assert _venta(u, fecha=str(_HOY)).status_code == 201

    def test_la_granularidad_no_esta_impuesta(self, app_with_db):
        """D-35: diez ventas de mil o una de diez mil, el modelo no distingue."""
        u = make_user_client(app_with_db, prefix="v5")
        for _ in range(3):
            assert _venta(u, monto="1000.00").status_code == 201
        assert _venta(u, monto="3000.00").status_code == 201


class TestInvarianteBidireccional:
    """El corazón del change: el par (forma_pago, cliente_id)."""

    def test_fiado_con_cliente_ok(self, app_with_db):
        u = make_user_client(app_with_db, prefix="inv1")
        cliente = _cliente(u)

        respuesta = _venta(
            u, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente["id"], monto="800.00"
        )
        assert respuesta.status_code == 201, respuesta.text
        assert respuesta.json()["cliente_id"] == cliente["id"]

    def test_fiado_sin_cliente_rechazado(self, app_with_db):
        """Deuda de nadie: plata que el negocio cree que le deben, sin a quién cobrarle."""
        u = make_user_client(app_with_db, prefix="inv2")
        respuesta = _venta(u, forma_pago="CUENTA_CORRIENTE")

        assert respuesta.status_code == 422
        assert "cliente" in str(respuesta.json()["detail"]).lower()

    @pytest.mark.parametrize("forma", ["EFECTIVO", "TRANSFERENCIA", "TARJETA", "OTRO"])
    def test_venta_no_fiada_con_cliente_rechazada(self, app_with_db, forma):
        """La otra dirección: ruido que alguien va a leer como deuda."""
        u = make_user_client(app_with_db, prefix=f"inv3{forma[:3].lower()}")
        cliente = _cliente(u)

        respuesta = _venta(u, forma_pago=forma, cliente_id=cliente["id"])
        assert respuesta.status_code == 422

    def test_cliente_de_otro_negocio_rechazado(self, app_with_db):
        uno = make_user_client(app_with_db, prefix="inv4a")
        otro = make_user_client(app_with_db, prefix="inv4b")
        ajeno = _cliente(otro)

        respuesta = _venta(uno, forma_pago="CUENTA_CORRIENTE", cliente_id=ajeno["id"])
        assert respuesta.status_code == 404

    def test_la_base_rechaza_aunque_se_saltee_la_aplicacion(self, app_with_db, engine):
        """D1: la garantía vive en el CHECK, no solo en el service."""
        u = make_user_client(app_with_db, prefix="inv5")

        for forma, cliente in (("CUENTA_CORRIENTE", None), ("EFECTIVO", uuid.uuid4())):
            with pytest.raises(IntegrityError):
                with engine.begin() as conn:
                    conn.execute(
                        text(
                            "INSERT INTO venta (id, negocio_id, cliente_id, fecha, "
                            "monto, forma_pago, created_at, updated_at) "
                            "VALUES (:id, :neg, :cli, :f, 100.00, :fp, now(), now())"
                        ),
                        {
                            "id": uuid.uuid4(),
                            "neg": uuid.UUID(u.negocio_id),
                            "cli": cliente,
                            "f": _HOY,
                            "fp": forma,
                        },
                    )


class TestCorregirUnaVenta:
    def test_pasar_de_fiado_a_contado_limpia_el_cliente(self, app_with_db):
        """D2: sin mencionar cliente_id, el par resultante igual queda coherente."""
        u = make_user_client(app_with_db, prefix="pat1")
        cliente = _cliente(u)
        venta = _venta(
            u, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente["id"]
        ).json()

        respuesta = u.patch(f"/api/ventas/{venta['id']}", json={"forma_pago": "EFECTIVO"})

        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.json()["cliente_id"] is None

    def test_pasar_a_fiado_sin_cliente_rechazado(self, app_with_db):
        u = make_user_client(app_with_db, prefix="pat2")
        venta = _venta(u).json()

        respuesta = u.patch(
            f"/api/ventas/{venta['id']}", json={"forma_pago": "CUENTA_CORRIENTE"}
        )
        assert respuesta.status_code == 422

    def test_pasar_a_fiado_con_cliente_ok(self, app_with_db):
        u = make_user_client(app_with_db, prefix="pat3")
        cliente = _cliente(u)
        venta = _venta(u).json()

        respuesta = u.patch(
            f"/api/ventas/{venta['id']}",
            json={"forma_pago": "CUENTA_CORRIENTE", "cliente_id": cliente["id"]},
        )
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.json()["cliente_id"] == cliente["id"]

    def test_editar_el_monto_no_toca_la_forma_de_pago(self, app_with_db):
        u = make_user_client(app_with_db, prefix="pat4")
        cliente = _cliente(u)
        venta = _venta(
            u, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente["id"]
        ).json()

        respuesta = u.patch(f"/api/ventas/{venta['id']}", json={"monto": "4321.00"})

        assert respuesta.status_code == 200
        cuerpo = respuesta.json()
        assert cuerpo["forma_pago"] == "CUENTA_CORRIENTE"
        assert cuerpo["cliente_id"] == cliente["id"]
        assert Decimal(cuerpo["monto"]) == Decimal("4321.00")


class TestElFiadoEsUnaVenta:
    def test_aparece_junto_a_las_de_contado(self, app_with_db):
        u = make_user_client(app_with_db, prefix="fia1")
        cliente = _cliente(u)
        _venta(u, monto="100.00")
        _venta(u, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente["id"], monto="200.00")

        listado = u.get("/api/ventas").json()
        formas = {v["forma_pago"] for v in listado}

        assert "EFECTIVO" in formas and "CUENTA_CORRIENTE" in formas

    def test_el_filtro_por_forma_de_pago_separa_el_fiado(self, app_with_db):
        u = make_user_client(app_with_db, prefix="fia2")
        cliente = _cliente(u)
        _venta(u, monto="100.00")
        _venta(u, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente["id"], monto="200.00")

        fiadas = u.get("/api/ventas?forma_pago=CUENTA_CORRIENTE").json()

        assert len(fiadas) == 1
        assert Decimal(fiadas[0]["monto"]) == Decimal("200.00")

    def test_no_existe_tabla_de_cargos(self, engine):
        """D-33: el cargo ES la venta."""
        from sqlalchemy import inspect

        tablas = set(inspect(engine).get_table_names())
        assert not {t for t in tablas if "cargo" in t.lower()}

    def test_eliminar_una_fiada_le_quita_el_cargo_al_cliente(self, app_with_db):
        u = make_user_client(app_with_db, prefix="fia3")
        cliente = _cliente(u)
        venta = _venta(
            u, forma_pago="CUENTA_CORRIENTE", cliente_id=cliente["id"], monto="500.00"
        ).json()

        assert u.delete(f"/api/ventas/{venta['id']}").status_code == 204

        restantes = u.get(
            f"/api/ventas?forma_pago=CUENTA_CORRIENTE&cliente_id={cliente['id']}"
        ).json()
        assert restantes == []

    def test_el_soft_delete_conserva_la_fila(self, app_with_db, engine):
        u = make_user_client(app_with_db, prefix="fia4")
        venta = _venta(u).json()
        u.delete(f"/api/ventas/{venta['id']}")

        with engine.connect() as conn:
            borrada = conn.execute(
                text("SELECT deleted_at FROM venta WHERE id = :id"),
                {"id": uuid.UUID(venta["id"])},
            ).scalar()

        assert borrada is not None, "el borrado fue físico, no soft"


class TestFiltros:
    def test_rango_de_fechas_incluye_los_extremos(self, app_with_db):
        u = make_user_client(app_with_db, prefix="fil1")
        ayer = _HOY - timedelta(days=1)
        anteayer = _HOY - timedelta(days=2)
        for f in (anteayer, ayer, _HOY):
            _venta(u, fecha=str(f), monto="100.00")

        rango = u.get(f"/api/ventas?desde={ayer}&hasta={_HOY}").json()
        fechas = {v["fecha"] for v in rango}

        assert fechas == {str(ayer), str(_HOY)}, "los extremos deben estar incluidos"

    def test_filtro_por_cliente(self, app_with_db):
        u = make_user_client(app_with_db, prefix="fil2")
        uno = _cliente(u)
        otro = _cliente(u)
        _venta(u, forma_pago="CUENTA_CORRIENTE", cliente_id=uno["id"], monto="111.00")
        _venta(u, forma_pago="CUENTA_CORRIENTE", cliente_id=otro["id"], monto="222.00")

        del_uno = u.get(f"/api/ventas?cliente_id={uno['id']}").json()

        assert len(del_uno) == 1
        assert Decimal(del_uno[0]["monto"]) == Decimal("111.00")

    def test_cliente_ajeno_da_404_no_lista_vacia(self, app_with_db):
        """Una lista vacía confirmaría que el id existe. 404 no dice nada."""
        uno = make_user_client(app_with_db, prefix="fil3a")
        otro = make_user_client(app_with_db, prefix="fil3b")
        ajeno = _cliente(otro)

        assert uno.get(f"/api/ventas?cliente_id={ajeno['id']}").status_code == 404


class TestAislamientoYSesion:
    def test_venta_de_otro_negocio_da_404(self, app_with_db):
        uno = make_user_client(app_with_db, prefix="ais1a")
        otro = make_user_client(app_with_db, prefix="ais1b")
        ajena = _venta(otro).json()

        assert uno.get(f"/api/ventas/{ajena['id']}").status_code == 404
        assert uno.patch(f"/api/ventas/{ajena['id']}", json={"monto": "1.00"}).status_code == 404
        assert uno.delete(f"/api/ventas/{ajena['id']}").status_code == 404
        assert otro.get(f"/api/ventas/{ajena['id']}").status_code == 200

    def test_los_companeros_ven_las_ventas_del_otro(self, app_with_db, engine):
        duenio = make_user_client(app_with_db, prefix="ais2")
        empleado = make_teammate_client(app_with_db, engine, duenio)

        _venta(empleado, monto="777.00")

        listado = duenio.get("/api/ventas").json()
        assert any(Decimal(v["monto"]) == Decimal("777.00") for v in listado)

    def test_el_payload_no_puede_fijar_el_negocio(self, app_with_db):
        uno = make_user_client(app_with_db, prefix="ais3a")
        otro = make_user_client(app_with_db, prefix="ais3b")

        respuesta = uno.post(
            "/api/ventas",
            json={
                "monto": "100.00",
                "fecha": str(_HOY),
                "forma_pago": "EFECTIVO",
                "negocio_id": otro.negocio_id,
            },
        )
        assert respuesta.status_code == 422

    def test_sin_sesion_401(self, app_with_db):
        anonimo = make_anon_client(app_with_db)
        assert anonimo.get("/api/ventas").status_code == 401

    def test_usuario_desactivado_401(self, app_with_db, engine):
        u = make_user_client(app_with_db, prefix="ais4")
        assert u.get("/api/ventas").status_code == 200

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(u.usuario_id)},
            )

        assert u.get("/api/ventas").status_code == 401

    def test_la_barra_final_no_redirige(self, app_with_db):
        u = make_user_client(app_with_db, prefix="ais5")

        sin = u.get("/api/ventas", follow_redirects=False)
        con = u.get("/api/ventas/", follow_redirects=False)

        assert sin.status_code == 200 and con.status_code == 200
        assert sin.json() == con.json()
