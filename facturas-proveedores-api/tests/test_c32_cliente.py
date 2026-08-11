"""
C-32 — the Cliente entity and the uniqueness rule that gives it meaning.

Two halves matter here and they pull in opposite directions:

- equivalent names must NOT coexist, or one person's debt splits across two
  accounts and the ledger stops meaning anything;
- a soft-deleted customer must RELEASE its name, or the shop can never re-add
  someone it removed and there is no visible explanation why.

Both come from the same partial unique index, which is why the delete-then-
recreate case is tested as carefully as the duplicate one.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from app.core.normalizacion import normalizar_nombre
from tests.conftest import make_teammate_client, make_user_client


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    # SQLModel's create_all does not know about the partial index (it lives in
    # migration 0008), so it is created here to match production behaviour.
    with eng.begin() as conn:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS "
                "uq_cliente_negocio_nombre_normalizado_activo "
                "ON cliente (negocio_id, nombre_normalizado) WHERE deleted_at IS NULL"
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

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_auth] = override_get_db
    app.dependency_overrides[get_db_usuarios] = override_get_db
    app.dependency_overrides[get_db_clientes] = override_get_db

    yield app

    app.dependency_overrides.clear()


def _crear(cliente: TestClient, nombre: str, **extra):
    return cliente.post("/api/clientes", json={"nombre": nombre, **extra})


class TestAltaMinima:
    def test_alta_solo_con_nombre(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="cli1")
        respuesta = _crear(usuario, "Juan Pérez")

        assert respuesta.status_code == 201, respuesta.text
        cuerpo = respuesta.json()
        assert cuerpo["nombre"] == "Juan Pérez"
        assert cuerpo["telefono"] is None
        assert cuerpo["notas"] is None

    def test_el_nombre_se_guarda_tal_cual_se_tipeo(self, app_with_db):
        """El negocio le muestra esto a su propio cliente; "juan perez" queda mal."""
        usuario = make_user_client(app_with_db, prefix="cli2")
        cuerpo = _crear(usuario, "Juan Pérez").json()

        assert cuerpo["nombre"] == "Juan Pérez"
        assert cuerpo["nombre_normalizado"] == "juan perez"

    def test_nombre_vacio_rechazado(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="cli3")
        assert _crear(usuario, "   ").status_code == 422

    def test_el_payload_no_puede_inyectar_la_normalizacion(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="cli4")
        respuesta = usuario.post(
            "/api/clientes",
            json={"nombre": "Ana Gómez", "nombre_normalizado": "otra cosa"},
        )
        # extra="forbid": el campo derivado no se acepta ni para ignorarlo.
        assert respuesta.status_code == 422

    def test_el_payload_no_puede_fijar_el_negocio(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="cli5")
        ajeno = make_user_client(app_with_db, prefix="cli5b")

        respuesta = usuario.post(
            "/api/clientes", json={"nombre": "Forjado", "negocio_id": ajeno.negocio_id}
        )
        assert respuesta.status_code == 422


class TestUnicidadNormalizada:
    def test_nombre_equivalente_rechazado(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="uni1")
        assert _crear(usuario, "Juan Pérez").status_code == 201

        for variante in ("juan perez", "JUAN PÉREZ", "  Juan   Perez  "):
            respuesta = _crear(usuario, variante)
            assert respuesta.status_code == 409, f"{variante!r} no fue rechazado"

    def test_el_conflicto_identifica_al_existente(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="uni2")
        original = _crear(usuario, "María López").json()

        conflicto = _crear(usuario, "maria lopez")
        assert conflicto.status_code == 409

        detalle = conflicto.json()["detail"]
        assert detalle["cliente_existente"]["id"] == original["id"]
        assert detalle["cliente_existente"]["nombre"] == "María López"

    def test_dos_negocios_pueden_tener_el_mismo_nombre(self, app_with_db):
        uno = make_user_client(app_with_db, prefix="uni3a")
        otro = make_user_client(app_with_db, prefix="uni3b")

        assert _crear(uno, "Juan Pérez").status_code == 201
        assert _crear(otro, "Juan Pérez").status_code == 201

    def test_nombres_distintos_conviven(self, app_with_db):
        """La otra mitad: la normalización no debe fusionar personas distintas."""
        usuario = make_user_client(app_with_db, prefix="uni4")

        assert _crear(usuario, "Juan Perez").status_code == 201
        assert _crear(usuario, "Juan Peres").status_code == 201
        assert _crear(usuario, "Juan").status_code == 201
        assert _crear(usuario, "Peña").status_code == 201
        assert _crear(usuario, "Pena").status_code == 201

    def test_renombrar_hacia_una_colision_se_rechaza(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="uni5")
        _crear(usuario, "Ana Gómez")
        otro = _crear(usuario, "Beto Ruiz").json()

        respuesta = usuario.patch(f"/api/clientes/{otro['id']}", json={"nombre": "ana gomez"})
        assert respuesta.status_code == 409

        sin_cambios = usuario.get(f"/api/clientes/{otro['id']}").json()
        assert sin_cambios["nombre"] == "Beto Ruiz"

    def test_renombrarse_a_si_mismo_es_valido(self, app_with_db):
        """Corregir mayúsculas del propio cliente no puede chocar consigo mismo."""
        usuario = make_user_client(app_with_db, prefix="uni6")
        cliente = _crear(usuario, "juan perez").json()

        respuesta = usuario.patch(
            f"/api/clientes/{cliente['id']}", json={"nombre": "Juan Pérez"}
        )
        assert respuesta.status_code == 200, respuesta.text
        assert respuesta.json()["nombre"] == "Juan Pérez"


class TestSoftDeleteLiberaElNombre:
    """La mitad del contrato que un índice único común NO da (D3)."""

    def test_eliminar_libera_el_nombre(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="del1")
        cliente = _crear(usuario, "Cliente Que Se Va").json()

        assert usuario.delete(f"/api/clientes/{cliente['id']}").status_code == 204

        recreado = _crear(usuario, "Cliente Que Se Va")
        assert recreado.status_code == 201, (
            "un cliente eliminado siguió bloqueando su propio nombre"
        )
        assert recreado.json()["id"] != cliente["id"]

    def test_el_eliminado_desaparece_de_listado_y_busqueda(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="del2")
        cliente = _crear(usuario, "Fantasma Invisible").json()
        usuario.delete(f"/api/clientes/{cliente['id']}")

        listado = usuario.get("/api/clientes").json()
        assert all(c["id"] != cliente["id"] for c in listado)

        busqueda = usuario.get("/api/clientes/buscar?nombre=fantasma").json()
        assert busqueda == []

    def test_la_fila_sobrevive_al_soft_delete(self, app_with_db, engine):
        usuario = make_user_client(app_with_db, prefix="del3")
        cliente = _crear(usuario, "Persiste En Base").json()
        usuario.delete(f"/api/clientes/{cliente['id']}")

        with engine.connect() as conn:
            fila = conn.execute(
                text("SELECT deleted_at FROM cliente WHERE id = :id"),
                {"id": uuid.UUID(cliente["id"])},
            ).scalar()

        assert fila is not None, "el borrado fue físico, no soft"

    def test_el_eliminado_devuelve_404(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="del4")
        cliente = _crear(usuario, "Ya No Está").json()
        usuario.delete(f"/api/clientes/{cliente['id']}")

        assert usuario.get(f"/api/clientes/{cliente['id']}").status_code == 404


class TestBusqueda:
    def test_la_coincidencia_exacta_va_primero(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="bus1")
        _crear(usuario, "Juan Pérez")
        _crear(usuario, "Juan")

        resultados = usuario.get("/api/clientes/buscar?nombre=juan").json()

        assert len(resultados) == 2
        assert resultados[0]["nombre"] == "Juan", (
            "la coincidencia exacta no encabezó el resultado"
        )

    def test_la_busqueda_ignora_acentos_y_mayusculas(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="bus2")
        _crear(usuario, "Ramón Gutiérrez")

        for consulta in ("ramon", "RAMÓN", "gutierrez"):
            resultados = usuario.get(f"/api/clientes/buscar?nombre={consulta}").json()
            assert any(c["nombre"] == "Ramón Gutiérrez" for c in resultados), consulta

    def test_la_busqueda_no_cruza_negocios(self, app_with_db):
        uno = make_user_client(app_with_db, prefix="bus3a")
        otro = make_user_client(app_with_db, prefix="bus3b")
        _crear(otro, "Secreto Ajeno")

        resultados = uno.get("/api/clientes/buscar?nombre=secreto").json()
        assert resultados == []

    def test_buscar_no_es_ensombrecido_por_el_id(self, app_with_db):
        """`/buscar` se declara antes que `/{cliente_id}` — si no, 422."""
        usuario = make_user_client(app_with_db, prefix="bus4")
        assert usuario.get("/api/clientes/buscar?nombre=x").status_code == 200


class TestAislamientoYSesion:
    def test_cliente_de_otro_negocio_da_404(self, app_with_db):
        uno = make_user_client(app_with_db, prefix="ais1a")
        otro = make_user_client(app_with_db, prefix="ais1b")
        ajeno = _crear(otro, "Cliente Ajeno").json()

        assert uno.get(f"/api/clientes/{ajeno['id']}").status_code == 404
        assert uno.patch(f"/api/clientes/{ajeno['id']}", json={"nombre": "X"}).status_code == 404
        assert uno.delete(f"/api/clientes/{ajeno['id']}").status_code == 404

        assert otro.get(f"/api/clientes/{ajeno['id']}").status_code == 200

    def test_los_companeros_comparten_la_cartera(self, app_with_db, engine):
        duenio = make_user_client(app_with_db, prefix="ais2")
        empleado = make_teammate_client(app_with_db, engine, duenio)

        cliente = _crear(duenio, "Cliente Del Local").json()

        visto = empleado.get(f"/api/clientes/{cliente['id']}")
        assert visto.status_code == 200
        assert visto.json()["nombre"] == "Cliente Del Local"

    def test_sin_sesion_401(self, app_with_db):
        from tests.conftest import make_anon_client

        anonimo = make_anon_client(app_with_db)
        assert anonimo.get("/api/clientes").status_code == 401

    def test_usuario_desactivado_401(self, app_with_db, engine):
        usuario = make_user_client(app_with_db, prefix="ais3")
        assert usuario.get("/api/clientes").status_code == 200

        with engine.begin() as conn:
            conn.execute(
                text("UPDATE usuario SET desactivado = true WHERE id = :id"),
                {"id": uuid.UUID(usuario.usuario_id)},
            )

        assert usuario.get("/api/clientes").status_code == 401

    def test_la_barra_final_no_redirige(self, app_with_db):
        usuario = make_user_client(app_with_db, prefix="ais4")

        sin = usuario.get("/api/clientes", follow_redirects=False)
        con = usuario.get("/api/clientes/", follow_redirects=False)

        assert sin.status_code == 200
        assert con.status_code == 200
        assert sin.json() == con.json()


class TestCarrera:
    """D4: entre el chequeo y el insert hay una ventana. El índice la cierra."""

    def test_un_duplicado_concurrente_da_409_y_no_500(self, app_with_db, engine):
        usuario = make_user_client(app_with_db, prefix="race")

        # Simula al competidor: inserta directo, saltándose el chequeo del service.
        normalizado = normalizar_nombre("Cliente Concurrente")
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO cliente (id, negocio_id, nombre, nombre_normalizado, "
                    "created_at, updated_at) "
                    "VALUES (:id, :neg, :nom, :norm, now(), now())"
                ),
                {
                    "id": uuid.uuid4(),
                    "neg": uuid.UUID(usuario.negocio_id),
                    "nom": "Cliente Concurrente",
                    "norm": normalizado,
                },
            )

        respuesta = _crear(usuario, "cliente concurrente")
        assert respuesta.status_code == 409, (
            f"el segundo en llegar recibió {respuesta.status_code}, no un 409"
        )
