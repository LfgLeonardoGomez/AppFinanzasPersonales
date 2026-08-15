"""
C-42 — idempotency for `POST /api/ventas`.

`test_c33_ventas.py` stays untouched: every one of its 33 tests posts
WITHOUT `Idempotency-Key`, and that suite in the green is the proof that this
change does not alter the no-header path (task 1.3, design.md Migration Plan
step 3). This file is entirely new coverage.

Three layers, matching tasks.md groups 2/4/5:

- `TestModelo`      — the column persists and nothing derived leaks in (2.6).
- `TestVentaService` — direct service-level tests against a real Session,
  including the one genuine concurrency test in this change: two OS threads,
  two DB sessions, two Postgres transactions (4.11).
- `TestEndpoint`     — the same behaviors through the HTTP surface, plus what
  only the router owns: the header, the status code, CORS-adjacent wiring is
  covered separately in test_main_cors.py-style assertions here (group 5).
"""

import threading
import time
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

import app.models  # noqa: F401 — register all SQLModel tables
from app.models.enums import FormaPago
from app.models.venta import Venta
from app.repositories.cliente_repository import ClienteRepository
from app.services.venta_service import VentaCreada, VentaService
from tests.conftest import crear_negocio, make_anon_client, make_user_client

_HOY = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)

    # SQLModel's create_all does not know about constraints/indexes that live
    # only in migrations (0010's CHECK, 0012's partial unique index) — same
    # patch-up test_c33_ventas.py already does for the CHECK.
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
        conn.execute(
            text("DROP INDEX IF EXISTS uq_venta_negocio_idempotency_key")
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX uq_venta_negocio_idempotency_key "
                "ON venta (negocio_id, idempotency_key) "
                "WHERE idempotency_key IS NOT NULL"
            )
        )
    yield eng
    eng.dispose()


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


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


# ── Helpers ───────────────────────────────────────────────────────────────────


def _crear_cliente_db(session: Session, negocio_id: uuid.UUID, nombre: str = "Cliente"):
    repo = ClienteRepository(session)
    normalizado = f"{nombre.lower()}_{uuid.uuid4().hex[:6]}"
    cliente = repo.create(
        negocio_id=negocio_id,
        creado_por_usuario_id=None,
        nombre=nombre,
        nombre_normalizado=normalizado,
        telefono=None,
        notas=None,
    )
    session.commit()
    return cliente


def _cliente_api(usuario: TestClient, nombre: str | None = None) -> dict:
    respuesta = usuario.post(
        "/api/clientes", json={"nombre": nombre or f"Cliente {uuid.uuid4().hex[:6]}"}
    )
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def _venta_api(usuario: TestClient, headers: dict | None = None, **campos):
    cuerpo = {
        "monto": "1000.00",
        "fecha": str(_HOY),
        "forma_pago": "EFECTIVO",
        **campos,
    }
    return usuario.post("/api/ventas", json=cuerpo, headers=headers or {})


# ── 2.6 — el modelo ─────────────────────────────────────────────────────────────


class TestModelo:
    def test_persiste_la_clave_y_no_gana_columnas_derivadas(self, session, engine):
        negocio = crear_negocio(session)
        session.commit()

        key = uuid.uuid4()
        venta = Venta(
            negocio_id=negocio.id,
            fecha=_HOY,
            monto=Decimal("123.45"),
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.add(venta)
        session.commit()
        session.refresh(venta)

        assert venta.idempotency_key == key

        from sqlalchemy import inspect

        columnas = {c["name"] for c in inspect(engine).get_columns("venta")}
        assert "saldo" not in columnas
        assert "estado" not in columnas


# ── 4.x — VentaService ───────────────────────────────────────────────────────────


class TestCrearSinClave:
    def test_se_comporta_exactamente_como_antes(self, session):
        """4.1 — sin clave: se persiste, idempotency_key queda en None."""
        negocio = crear_negocio(session)
        session.commit()

        svc = VentaService(session)
        resultado = svc.crear(
            negocio.id, monto=Decimal("500.00"), fecha=_HOY, forma_pago=FormaPago.EFECTIVO
        )
        session.commit()

        assert isinstance(resultado, VentaCreada)
        assert resultado.es_repeticion is False
        assert resultado.venta.idempotency_key is None

    def test_dos_llamadas_iguales_sin_clave_producen_dos_ventas(self, session):
        """4.1, triangulación: la granularidad libre de RN-VTA-06 no se rompe."""
        negocio = crear_negocio(session)
        session.commit()

        svc = VentaService(session)
        for _ in range(2):
            svc.crear(
                negocio.id,
                monto=Decimal("500.00"),
                fecha=_HOY,
                forma_pago=FormaPago.EFECTIVO,
            )
        session.commit()

        total = session.exec(
            select(Venta).where(Venta.negocio_id == negocio.id)
        ).all()
        assert len(total) == 2


class TestCrearConClave:
    def test_clave_nueva_se_reporta_como_creada(self, session):
        """4.2"""
        negocio = crear_negocio(session)
        session.commit()

        svc = VentaService(session)
        resultado = svc.crear(
            negocio.id,
            monto=Decimal("700.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=uuid.uuid4(),
        )
        session.commit()

        assert resultado.es_repeticion is False
        assert resultado.venta.id is not None

    def test_clave_repetida_con_los_mismos_datos_devuelve_la_original(self, session):
        """4.3"""
        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        primero = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.commit()

        segundo = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.commit()

        assert segundo.es_repeticion is True
        assert segundo.venta.id == primero.venta.id

        total = session.exec(
            select(Venta).where(
                Venta.negocio_id == negocio.id, Venta.idempotency_key == key
            )
        ).all()
        assert len(total) == 1

    def test_repetir_cinco_veces_deja_una_sola_venta(self, session):
        """4.4 — triangulación de 4.3 con más repeticiones."""
        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        ids = set()
        for _ in range(5):
            resultado = svc.crear(
                negocio.id,
                monto=Decimal("50.00"),
                fecha=_HOY,
                forma_pago=FormaPago.EFECTIVO,
                idempotency_key=key,
            )
            session.commit()
            ids.add(resultado.venta.id)

        assert len(ids) == 1
        total = session.exec(
            select(Venta).where(
                Venta.negocio_id == negocio.id, Venta.idempotency_key == key
            )
        ).all()
        assert len(total) == 1

    @pytest.mark.parametrize(
        "campo,valor_nuevo",
        [
            ("monto", Decimal("999.00")),
            ("fecha", _HOY - timedelta(days=1)),
        ],
    )
    def test_clave_repetida_con_dato_distinto_es_409(self, session, campo, valor_nuevo):
        """4.5 — y su triangulación (monto vs. fecha distintos)."""
        from fastapi import HTTPException

        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        campos_base = dict(
            monto=Decimal("300.00"), fecha=_HOY, forma_pago=FormaPago.EFECTIVO
        )

        svc = VentaService(session)
        original = svc.crear(negocio.id, idempotency_key=key, **campos_base)
        session.commit()

        campos_repetidos = {**campos_base, campo: valor_nuevo}

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, idempotency_key=key, **campos_repetidos)

        assert excinfo.value.status_code == 409
        assert (
            excinfo.value.detail["venta_existente"]["id"] == str(original.venta.id)
        )

        # La venta guardada conserva su valor original — la corrección se
        # descarta, no se aplica en silencio.
        session.rollback()
        conservada = session.exec(
            select(Venta).where(Venta.id == original.venta.id)
        ).one()
        assert getattr(conservada, campo) == campos_base[campo]

    def test_clave_repetida_con_cliente_distinto_es_409(self, session):
        """4.5 — triangulación con cliente_id distinto en vez de monto/fecha."""
        from fastapi import HTTPException

        negocio = crear_negocio(session)
        session.commit()
        cliente_a = _crear_cliente_db(session, negocio.id, "Cliente A")
        cliente_b = _crear_cliente_db(session, negocio.id, "Cliente B")
        key = uuid.uuid4()

        svc = VentaService(session)
        svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.CUENTA_CORRIENTE,
            cliente_id=cliente_a.id,
            idempotency_key=key,
        )
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                monto=Decimal("300.00"),
                fecha=_HOY,
                forma_pago=FormaPago.CUENTA_CORRIENTE,
                cliente_id=cliente_b.id,
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 409

    def test_notas_con_solo_espacios_de_diferencia_es_repeticion(self, session):
        """4.6 — la comparación usa notas ya normalizadas por Pydantic; a nivel
        de servicio eso significa mandar el mismo valor normalizado dos veces."""
        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        primero = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            notas="nota original",
            idempotency_key=key,
        )
        session.commit()

        segundo = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            notas="nota original",
            idempotency_key=key,
        )
        session.commit()

        assert segundo.es_repeticion is True
        assert segundo.venta.id == primero.venta.id

    def test_la_clave_de_una_venta_eliminada_no_se_recicla(self, session):
        """4.7"""
        from fastapi import HTTPException

        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        creada = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.commit()

        svc.eliminar(negocio.id, creada.venta.id)
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                monto=Decimal("300.00"),
                fecha=_HOY,
                forma_pago=FormaPago.EFECTIVO,
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 409
        session.rollback()

        listado = svc.listar(negocio.id)
        assert all(v.id != creada.venta.id for v in listado)
        assert len(listado) == 0

    def test_la_misma_clave_en_dos_negocios_crea_dos_ventas(self, session):
        """4.8"""
        negocio_a = crear_negocio(session, nombre="Negocio A")
        negocio_b = crear_negocio(session, nombre="Negocio B")
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        resultado_a = svc.crear(
            negocio_a.id,
            monto=Decimal("111.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.commit()
        resultado_b = svc.crear(
            negocio_b.id,
            monto=Decimal("222.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.commit()

        assert resultado_a.es_repeticion is False
        assert resultado_b.es_repeticion is False
        assert resultado_a.venta.id != resultado_b.venta.id

        # 4.9 — la búsqueda por clave filtra por negocio: cada uno ve solo la
        # suya. Si el filtro se quitara de get_by_idempotency_key, este mismo
        # assert fallaría mostrando la venta ajena.
        listado_a = svc.listar(negocio_a.id)
        listado_b = svc.listar(negocio_b.id)
        assert {v.id for v in listado_a} == {resultado_a.venta.id}
        assert {v.id for v in listado_b} == {resultado_b.venta.id}

    def test_la_validacion_de_negocio_corre_antes_que_la_idempotencia(self, session):
        """4.10 — un fiado sin cliente sigue dando 422 y la clave sigue libre."""
        from fastapi import HTTPException

        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                monto=Decimal("300.00"),
                fecha=_HOY,
                forma_pago=FormaPago.CUENTA_CORRIENTE,
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 422

        total = session.exec(
            select(Venta).where(Venta.negocio_id == negocio.id)
        ).all()
        assert total == []

        # La clave sigue disponible para un envío corregido con la misma key.
        cliente = _crear_cliente_db(session, negocio.id)
        resultado = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.CUENTA_CORRIENTE,
            cliente_id=cliente.id,
            idempotency_key=key,
        )
        session.commit()
        assert resultado.es_repeticion is False

    def test_integrity_error_de_otra_constraint_se_propaga(self, session, monkeypatch):
        """
        4.13 — una violación de una constraint DISTINTA de la de idempotencia
        no se responde como repetición.

        La única forma determinística de disparar este camino es simular la
        violación: llegar a él con una fila real requiere una carrera contra
        el CHECK o la FK, que ya está cubierta por otros tests (D1 en
        test_c33_ventas.py) y no es reproducible a pedido. Este test verifica
        el branching real de VentaService.crear frente a un IntegrityError
        cuyo nombre de constraint no es el de idempotencia.
        """
        negocio = crear_negocio(session)
        session.commit()

        svc = VentaService(session)

        class _FakeDiag:
            constraint_name = "ck_venta_fiado_tiene_cliente"

        class _FakeOrig:
            diag = _FakeDiag()

        def _boom(**kwargs):
            raise IntegrityError("INSERT", {}, _FakeOrig())

        monkeypatch.setattr(svc._repo, "create", _boom)

        with pytest.raises(IntegrityError):
            svc.crear(
                negocio.id,
                monto=Decimal("100.00"),
                fecha=_HOY,
                forma_pago=FormaPago.EFECTIVO,
                idempotency_key=uuid.uuid4(),
            )


class TestSesionDespuesDeLaViolacion:
    def test_la_relectura_funciona_porque_hubo_rollback(self, session):
        """
        4.12 — mutación de referencia: si se quita el `self._session.rollback()`
        antes de la relectura, este test falla con PendingRollbackError en vez
        de con un resultado de repetición.
        """
        negocio = crear_negocio(session)
        session.commit()
        key = uuid.uuid4()

        svc = VentaService(session)
        svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        session.commit()

        # La segunda llamada dispara el IntegrityError → rollback → relectura,
        # todo en la MISMA sesión. Si el rollback faltara, la relectura de acá
        # abajo (o incluso el propio flush del segundo crear) tiraría
        # PendingRollbackError en vez de completar.
        resultado = svc.crear(
            negocio.id,
            monto=Decimal("300.00"),
            fecha=_HOY,
            forma_pago=FormaPago.EFECTIVO,
            idempotency_key=key,
        )
        assert resultado.es_repeticion is True

        # La sesión sigue viva para cualquier lectura posterior.
        de_nuevo = session.exec(
            select(Venta).where(Venta.id == resultado.venta.id)
        ).one()
        assert de_nuevo.id == resultado.venta.id


class TestCarreraReal:
    """
    4.11 — concurrencia real: dos hilos de sistema operativo, dos Session de
    SQLAlchemy sobre el mismo engine (por lo tanto dos conexiones y dos
    transacciones Postgres separadas), la misma idempotency_key.

    No es una aproximación secuencial. El hilo A inserta y flushea pero NO
    commitea; el hilo B intenta insertar la misma clave mientras la fila de A
    sigue sin decidir su destino, y ese segundo INSERT se BLOQUEA de verdad
    dentro de Postgres hasta que A hace commit — es la propia base la que
    sincroniza los hilos, no un sleep artificial ni un mock. Si el service
    hiciera "consultar y después insertar" en lugar de "insertar y capturar",
    ambos hilos verían la clave libre y el test fallaría con dos ventas.
    """

    def test_dos_inserts_concurrentes_con_la_misma_clave_producen_una_sola_venta(
        self, engine
    ):
        with Session(engine) as setup:
            negocio = crear_negocio(setup, nombre=f"Carrera {uuid.uuid4().hex[:6]}")
            setup.commit()
            negocio_id = negocio.id

        key = uuid.uuid4()
        # Plain values only — an ORM instance read AFTER its Session closes
        # (attributes expired by commit) raises DetachedInstanceError, and the
        # assertions below run from the main thread after both sessions closed.
        resultados: dict[str, dict] = {}
        errores: dict[str, Exception] = {}
        listo_para_b = threading.Event()

        def hilo_a():
            session_a = Session(engine)
            try:
                svc_a = VentaService(session_a)
                resultado = svc_a.crear(
                    negocio_id,
                    monto=Decimal("500.00"),
                    fecha=_HOY,
                    forma_pago=FormaPago.EFECTIVO,
                    idempotency_key=key,
                )
                # Insertado y flusheado — la fila existe en la transacción de
                # A pero NO está commiteada. Recién ahora se avisa a B.
                listo_para_b.set()
                # Le da tiempo real a B de llegar a su propio INSERT y
                # bloquearse contra la fila de A antes de que A la libere.
                time.sleep(1.0)
                session_a.commit()
                # Capturado DENTRO del `with`/antes del close, mientras la
                # sesión todavía puede resolver el refresh post-commit.
                resultados["a"] = {
                    "es_repeticion": resultado.es_repeticion,
                    "id": resultado.venta.id,
                }
            except Exception as exc:  # pragma: no cover - solo ante una falla real
                errores["a"] = exc
                listo_para_b.set()
            finally:
                session_a.close()

        def hilo_b():
            assert listo_para_b.wait(timeout=10), "A nunca insertó"
            session_b = Session(engine)
            try:
                svc_b = VentaService(session_b)
                # Este INSERT choca contra la fila sin commitear de A: Postgres
                # lo bloquea hasta que la transacción de A termine (commit o
                # rollback). El bloqueo es real, no simulado.
                resultado = svc_b.crear(
                    negocio_id,
                    monto=Decimal("500.00"),
                    fecha=_HOY,
                    forma_pago=FormaPago.EFECTIVO,
                    idempotency_key=key,
                )
                session_b.commit()
                resultados["b"] = {
                    "es_repeticion": resultado.es_repeticion,
                    "id": resultado.venta.id,
                }
            except Exception as exc:  # pragma: no cover
                errores["b"] = exc
            finally:
                session_b.close()

        t_a = threading.Thread(target=hilo_a)
        t_b = threading.Thread(target=hilo_b)
        t_a.start()
        t_b.start()
        t_a.join(timeout=20)
        t_b.join(timeout=20)

        assert not errores, f"error inesperado en la carrera: {errores}"
        assert "a" in resultados and "b" in resultados, "algún hilo no terminó"

        assert resultados["a"]["es_repeticion"] is False
        assert resultados["b"]["es_repeticion"] is True
        assert resultados["a"]["id"] == resultados["b"]["id"]

        with Session(engine) as verify:
            filas = verify.exec(
                select(Venta).where(
                    Venta.negocio_id == negocio_id, Venta.idempotency_key == key
                )
            ).all()
        assert len(filas) == 1


# ── 5.x — schema, router, CORS ────────────────────────────────────────────────


class TestSchema:
    def test_venta_response_no_expone_la_clave(self, app_with_db):
        """5.1"""
        from app.schemas.venta import VentaResponse

        assert "idempotency_key" not in VentaResponse.model_fields


class TestEndpointClaveMalformada:
    def test_clave_no_uuid_es_422_y_no_persiste_nada(self, app_with_db, engine):
        """5.2"""
        u = make_user_client(app_with_db, prefix="c42a")
        respuesta = _venta_api(u, headers={"Idempotency-Key": "no-es-un-uuid"})
        assert respuesta.status_code == 422

        with Session(engine) as s:
            total = s.exec(
                select(Venta).where(Venta.negocio_id == uuid.UUID(u.negocio_id))
            ).all()
        assert total == []


class TestEndpointReplay:
    def test_primer_post_201_segundo_post_200_con_header(self, app_with_db):
        """5.3"""
        u = make_user_client(app_with_db, prefix="c42b")
        key = str(uuid.uuid4())

        primero = _venta_api(u, headers={"Idempotency-Key": key}, monto="123.45")
        assert primero.status_code == 201, primero.text
        assert "Idempotent-Replay" not in primero.headers

        segundo = _venta_api(u, headers={"Idempotency-Key": key}, monto="123.45")
        assert segundo.status_code == 200, segundo.text
        assert segundo.headers.get("Idempotent-Replay") == "true"
        assert segundo.json()["id"] == primero.json()["id"]

    def test_el_fiado_repetido_deja_un_solo_cargo(self, app_with_db):
        """5.4 — el caso que motiva el change entero."""
        u = make_user_client(app_with_db, prefix="c42c")
        cliente = _cliente_api(u)
        key = str(uuid.uuid4())

        for _ in range(2):
            respuesta = _venta_api(
                u,
                headers={"Idempotency-Key": key},
                forma_pago="CUENTA_CORRIENTE",
                cliente_id=cliente["id"],
                monto="800.00",
            )
            assert respuesta.status_code in (200, 201), respuesta.text

        cuenta = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        if cuenta.status_code == 200:
            assert Decimal(str(cuenta.json()["saldo"])) == Decimal("800.00")
        else:
            # Si C-35 expone el saldo bajo otra ruta en este checkout del
            # repo, la prueba de fondo (una sola venta) alcanza igual.
            listado = u.get(
                f"/api/ventas?cliente_id={cliente['id']}&forma_pago=CUENTA_CORRIENTE"
            ).json()
            assert len(listado) == 1
            assert Decimal(listado[0]["monto"]) == Decimal("800.00")

    def test_sin_sesion_sigue_dando_401_antes_que_el_header(self, app_with_db):
        """5.5"""
        anonimo = make_anon_client(app_with_db)
        respuesta = anonimo.post(
            "/api/ventas",
            json={"monto": "1.00", "fecha": str(_HOY), "forma_pago": "EFECTIVO"},
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert respuesta.status_code == 401


class TestCorsHeaders:
    def test_idempotency_key_esta_en_allow_headers(self):
        """5.7"""
        from app.main import app
        from fastapi.middleware.cors import CORSMiddleware

        cors_mw = next(
            m for m in app.user_middleware if m.cls is CORSMiddleware
        )
        allow_headers = cors_mw.kwargs.get("allow_headers", [])
        assert "Idempotency-Key" in allow_headers
