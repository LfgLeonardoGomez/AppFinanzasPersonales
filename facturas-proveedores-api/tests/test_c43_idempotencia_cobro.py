"""
C-43 Fase A — idempotency for `POST /api/cobros`. THE case that breaks if the
C-42 recipe is copied verbatim (design.md D2 / proposal §Why).

`test_cobro_cliente_service.py` and `test_cobro_cliente_integration.py` stay
untouched: every one of their tests posts WITHOUT `Idempotency-Key`, and that
suite staying green is the proof this change does not alter the no-header
path, INCLUDING the RN-CCC-04 balance check (task 1.2).

Why this file cannot just mirror test_c43_idempotencia_pago.py: RN-CCC-04's
balance validation (`_saldo_disponible`) is STATEFUL — it reads `venta` and
`cobro_cliente` and returns SUM(fiados) - SUM(cobros). A cobro that cancels
more than half of what is owed consumes that balance the moment it commits,
so copying the "validate → INSERT → catch IntegrityError" order verbatim
would make the replay branch of a legitimate retry UNREACHABLE: the balance
check runs first, sees the balance already consumed by the original cobro,
and rejects with 422 before ever reaching the INSERT that would have
recognized the replay. `CobroClienteService.crear` resolves this with a
fast-path lookup by key BEFORE the balance check — the unique index still
guarantees uniqueness, and the IntegrityError branch still resolves genuine
concurrency (task 8.9 proves that branch stays reachable, for real, against
Postgres).
"""

import threading
import time
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

import app.models  # noqa: F401
from app.models.cobro_cliente import CobroCliente
from app.models.enums import FormaPago, MetodoCobro
from app.schemas.cobro_cliente import CobroClienteCreate
from app.services.cobro_cliente_service import CobroClienteService
from tests.conftest import crear_negocio, make_anon_client, make_user_client

_HOY = date.today()


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)

    with eng.begin() as conn:
        conn.execute(text("DROP INDEX IF EXISTS uq_cobro_cliente_negocio_idempotency_key"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX uq_cobro_cliente_negocio_idempotency_key "
                "ON cobro_cliente (negocio_id, idempotency_key) "
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
    from app.routers.clientes import get_db as get_db_clientes
    from app.routers.cobros import get_db as get_db_cobros
    from app.routers.ventas import get_db as get_db_ventas

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_cobros] = override_get_db
    app.dependency_overrides[get_db_clientes] = override_get_db
    app.dependency_overrides[get_db_ventas] = override_get_db

    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _cliente_db(session: Session, negocio_id: uuid.UUID):
    from app.models.cliente import Cliente

    c = Cliente(
        negocio_id=negocio_id,
        nombre="Cliente Test",
        nombre_normalizado=f"cliente test {uuid.uuid4().hex[:8]}",
    )
    session.add(c)
    session.flush()
    return c


def _fiado_db(session: Session, negocio_id: uuid.UUID, cliente_id: uuid.UUID, monto: Decimal):
    from app.models.venta import Venta

    v = Venta(
        negocio_id=negocio_id,
        cliente_id=cliente_id,
        monto=monto,
        fecha=_HOY,
        forma_pago=FormaPago.CUENTA_CORRIENTE,
    )
    session.add(v)
    session.flush()
    return v


def _make_create(**overrides) -> CobroClienteCreate:
    payload = {
        "cliente_id": uuid.uuid4(),
        "monto": Decimal("100.00"),
        "fecha": _HOY,
        "metodo": MetodoCobro.EFECTIVO,
    }
    payload.update(overrides)
    return CobroClienteCreate(**payload)


def _cliente_api(usuario: TestClient) -> dict:
    resp = usuario.post(
        "/api/clientes", json={"nombre": f"Cliente {uuid.uuid4().hex[:6]}"}
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _fiado_api(usuario: TestClient, cliente_id: str, monto: str = "1000.00") -> dict:
    resp = usuario.post(
        "/api/ventas/",
        json={
            "monto": monto,
            "fecha": str(_HOY),
            "forma_pago": "CUENTA_CORRIENTE",
            "cliente_id": cliente_id,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _cobro_api(usuario: TestClient, cliente_id: str, headers: dict | None = None, **campos):
    cuerpo = {
        "cliente_id": cliente_id,
        "monto": "100.00",
        "fecha": str(_HOY),
        "metodo": "EFECTIVO",
        **campos,
    }
    return usuario.post("/api/cobros/", json=cuerpo, headers=headers or {})


# ── Modelo ────────────────────────────────────────────────────────────────────


class TestModelo:
    def test_persiste_la_clave_y_no_gana_columnas_derivadas(self, session, engine):
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        session.commit()

        key = uuid.uuid4()
        cobro = CobroCliente(
            negocio_id=negocio.id,
            cliente_id=cliente.id,
            monto=Decimal("50.00"),
            fecha=_HOY,
            metodo=MetodoCobro.EFECTIVO,
            idempotency_key=key,
        )
        session.add(cobro)
        session.commit()
        session.refresh(cobro)

        assert cobro.idempotency_key == key

        columnas = {c["name"] for c in inspect(engine).get_columns("cobro_cliente")}
        assert "saldo" not in columnas
        assert "estado" not in columnas
        assert "venta_id" not in columnas


# ── 8.x — CobroClienteService ─────────────────────────────────────────────────


class TestCrearSinClave:
    def test_se_comporta_exactamente_como_antes_incluida_la_validacion_de_saldo(self, session):
        """8.1"""
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("500.00"))
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("500.00")))
        session.commit()
        assert cobro.idempotency_key is None

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("1.00")))
        assert excinfo.value.status_code == 422


class TestCrearConClave:
    def test_clave_nueva_se_reporta_como_creada(self, session):
        """8.2"""
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("500.00"))
        session.commit()

        svc = CobroClienteService(session)
        cobro = svc.crear(
            negocio.id,
            _make_create(cliente_id=cliente.id, monto=Decimal("300.00")),
            idempotency_key=uuid.uuid4(),
        )
        session.commit()

        assert cobro.id is not None
        assert cobro.es_repeticion is False

    def test_reintento_de_un_cobro_que_saldo_la_cuenta_entera_no_es_422(self, session):
        """
        8.3 — TEST CENTRAL DEL CHANGE. Debe fallar contra una implementación
        que copie el orden de C-42 al pie de la letra (validar saldo antes
        de buscar por clave): ese orden vería el saldo ya consumido por el
        cobro original y rechazaría el reintento con 422, en vez de
        devolver la repetición.
        """
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()
        datos = _make_create(cliente_id=cliente.id, monto=Decimal("1000.00"))

        svc = CobroClienteService(session)
        primero = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()
        assert primero.es_repeticion is False

        # El reintento NO debe ver un 422 por saldo insuficiente.
        segundo = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        assert segundo.es_repeticion is True
        assert segundo.id == primero.id

        total = session.exec(
            select(CobroCliente).where(
                CobroCliente.negocio_id == negocio.id, CobroCliente.cliente_id == cliente.id
            )
        ).all()
        assert len(total) == 1

    def test_reintento_de_un_cobro_parcial_tambien_funciona(self, session):
        """8.4 — triangulación de 8.3: no depende de que el saldo llegue a cero."""
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()
        datos = _make_create(cliente_id=cliente.id, monto=Decimal("400.00"))

        svc = CobroClienteService(session)
        primero = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        segundo = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        assert segundo.es_repeticion is True
        assert segundo.id == primero.id

    def test_la_regla_de_saldo_sigue_viva_para_claves_nuevas(self, session):
        """
        8.5 — mitad que impide que 8.3 se convierta en un agujero: un cobro
        con clave NUEVA que supera el saldo sigue dando 422, no persiste
        nada, y la clave queda libre.
        """
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("500.00"))
        session.commit()
        key = uuid.uuid4()

        svc = CobroClienteService(session)
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                _make_create(cliente_id=cliente.id, monto=Decimal("600.00")),
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 422

        total = session.exec(
            select(CobroCliente).where(CobroCliente.negocio_id == negocio.id)
        ).all()
        assert total == []

        # La clave sigue libre para un envío corregido.
        cobro = svc.crear(
            negocio.id,
            _make_create(cliente_id=cliente.id, monto=Decimal("500.00")),
            idempotency_key=key,
        )
        session.commit()
        assert cobro.es_repeticion is False

    @pytest.mark.parametrize(
        "campo,valor_nuevo",
        [
            ("monto", Decimal("50.00")),
            ("fecha", _HOY - timedelta(days=1)),
            ("metodo", MetodoCobro.TRANSFERENCIA),
        ],
    )
    def test_clave_repetida_con_dato_distinto_es_409(self, session, campo, valor_nuevo):
        """8.6 y su triangulación."""
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()

        campos_base = dict(cliente_id=cliente.id, monto=Decimal("100.00"), fecha=_HOY, metodo=MetodoCobro.EFECTIVO)

        svc = CobroClienteService(session)
        original = svc.crear(negocio.id, _make_create(**campos_base), idempotency_key=key)
        session.commit()

        campos_repetidos = {**campos_base, campo: valor_nuevo}
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, _make_create(**campos_repetidos), idempotency_key=key)

        assert excinfo.value.status_code == 409
        assert excinfo.value.detail["cobro_existente"]["id"] == str(original.id)

    def test_clave_repetida_con_cliente_distinto_es_409(self, session):
        """8.6 — triangulación con cliente_id."""
        negocio = crear_negocio(session)
        cliente_a = _cliente_db(session, negocio.id)
        cliente_b = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente_a.id, Decimal("1000.00"))
        _fiado_db(session, negocio.id, cliente_b.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()

        svc = CobroClienteService(session)
        svc.crear(negocio.id, _make_create(cliente_id=cliente_a.id, monto=Decimal("100.00")), idempotency_key=key)
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id, _make_create(cliente_id=cliente_b.id, monto=Decimal("100.00")), idempotency_key=key
            )
        assert excinfo.value.status_code == 409

    def test_la_clave_de_un_cobro_eliminado_no_se_recicla(self, session):
        """8.7"""
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()

        svc = CobroClienteService(session)
        creado = svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("100.00")), idempotency_key=key)
        session.commit()

        svc.eliminar(negocio.id, creado.id)
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, _make_create(cliente_id=cliente.id, monto=Decimal("100.00")), idempotency_key=key)
        assert excinfo.value.status_code == 409
        session.rollback()

        items, total = svc.listar(negocio.id)
        assert total == 0

    def test_la_misma_clave_en_dos_negocios_crea_dos_cobros(self, session):
        """8.8"""
        negocio_a = crear_negocio(session, nombre="A")
        negocio_b = crear_negocio(session, nombre="B")
        cliente_a = _cliente_db(session, negocio_a.id)
        cliente_b = _cliente_db(session, negocio_b.id)
        _fiado_db(session, negocio_a.id, cliente_a.id, Decimal("1000.00"))
        _fiado_db(session, negocio_b.id, cliente_b.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()

        svc = CobroClienteService(session)
        cobro_a = svc.crear(negocio_a.id, _make_create(cliente_id=cliente_a.id, monto=Decimal("111.00")), idempotency_key=key)
        session.commit()
        cobro_b = svc.crear(negocio_b.id, _make_create(cliente_id=cliente_b.id, monto=Decimal("222.00")), idempotency_key=key)
        session.commit()

        assert cobro_a.id != cobro_b.id

        items_a, _ = svc.listar(negocio_a.id)
        items_b, _ = svc.listar(negocio_b.id)
        assert {c.id for c in items_a} == {cobro_a.id}
        assert {c.id for c in items_b} == {cobro_b.id}

    def test_la_validacion_de_cliente_ajeno_corre_antes_que_la_idempotencia(self, session):
        """8.11"""
        negocio_a = crear_negocio(session, nombre="A")
        negocio_b = crear_negocio(session, nombre="B")
        cliente_ajeno = _cliente_db(session, negocio_b.id)
        session.commit()
        key = uuid.uuid4()

        svc = CobroClienteService(session)
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio_a.id, _make_create(cliente_id=cliente_ajeno.id), idempotency_key=key)
        assert excinfo.value.status_code == 404

        total = session.exec(select(CobroCliente).where(CobroCliente.negocio_id == negocio_a.id)).all()
        assert total == []

    def test_integrity_error_de_otra_constraint_se_propaga(self, session, monkeypatch):
        """8.10"""
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("1000.00"))
        session.commit()

        svc = CobroClienteService(session)

        class _FakeDiag:
            constraint_name = "alguna_otra_constraint"

        class _FakeOrig:
            diag = _FakeDiag()

        def _boom(**kwargs):
            raise IntegrityError("INSERT", {}, _FakeOrig())

        monkeypatch.setattr(svc._repo, "create", _boom)

        with pytest.raises(IntegrityError):
            svc.crear(
                negocio.id,
                _make_create(cliente_id=cliente.id, monto=Decimal("100.00")),
                idempotency_key=uuid.uuid4(),
            )


class TestSesionUtilizableTrasElFastPath:
    def test_la_repeticion_secuencial_usa_el_fast_path_no_el_integrity_error(self, session):
        """
        Sanity check distinto del de pago/venta: en cobros, una repetición
        SECUENCIAL (misma sesión, la primera ya commiteada) resuelve por el
        fast-path de design.md D2 — la lectura por clave la encuentra ANTES
        de la validación de saldo, así que el `INSERT` ni se intenta y la
        rama de `IntegrityError`/`rollback()` nunca se ejecuta acá. Esa
        rama solo es alcanzable bajo concurrencia real, que es lo que 8.9
        prueba con dos hilos y dos transacciones Postgres separadas. Este
        test solo confirma que el camino secuencial (el más común) deja la
        sesión perfectamente utilizable después.
        """
        negocio = crear_negocio(session)
        cliente = _cliente_db(session, negocio.id)
        _fiado_db(session, negocio.id, cliente.id, Decimal("1000.00"))
        session.commit()
        key = uuid.uuid4()
        datos = _make_create(cliente_id=cliente.id, monto=Decimal("100.00"))

        svc = CobroClienteService(session)
        svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        repeticion = svc.crear(negocio.id, datos, idempotency_key=key)
        assert repeticion.es_repeticion is True

        de_nuevo = session.exec(select(CobroCliente).where(CobroCliente.id == repeticion.id)).one()
        assert de_nuevo.id == repeticion.id


class TestCarreraReal:
    """
    8.9 — EL test que prueba que la resolución anticipada no vuelve
    inalcanzable el camino de la violación. Dos hilos, dos sesiones, dos
    transacciones Postgres reales, la misma clave — y NINGUNO de los dos
    la encuentra en su fast-path (todavía no hay fila commiteada), así que
    los dos siguen al camino normal y colisionan en el INSERT. Si alguien
    borrara la rama de IntegrityError creyendo que el fast-path la
    reemplaza, este test degradaría a un 500 sin resolverse — exactamente
    lo que design.md D2 dice que puede pasar si se rompe esa garantía.
    """

    def test_dos_inserts_concurrentes_con_la_misma_clave_producen_un_solo_cobro(self, engine):
        with Session(engine) as setup:
            negocio = crear_negocio(setup, nombre=f"Carrera {uuid.uuid4().hex[:6]}")
            cliente = _cliente_db(setup, negocio.id)
            _fiado_db(setup, negocio.id, cliente.id, Decimal("1000.00"))
            setup.commit()
            negocio_id = negocio.id
            cliente_id = cliente.id

        key = uuid.uuid4()
        resultados: dict[str, dict] = {}
        errores: dict[str, Exception] = {}
        listo_para_b = threading.Event()
        pids: dict[str, int] = {}
        bloqueo_detectado = threading.Event()
        detener_watcher = threading.Event()

        def hilo_a():
            session_a = Session(engine)
            try:
                svc_a = CobroClienteService(session_a)
                cobro = svc_a.crear(
                    negocio_id,
                    _make_create(cliente_id=cliente_id, monto=Decimal("100.00")),
                    idempotency_key=key,
                )
                listo_para_b.set()
                time.sleep(1.0)
                session_a.commit()
                resultados["a"] = {"id": cobro.id, "es_repeticion": cobro.es_repeticion}
            except Exception as exc:  # pragma: no cover
                errores["a"] = exc
                listo_para_b.set()
            finally:
                session_a.close()

        def hilo_b():
            assert listo_para_b.wait(timeout=10), "A nunca insertó"
            session_b = Session(engine)
            try:
                pids["b"] = session_b.execute(text("SELECT pg_backend_pid()")).scalar()
                svc_b = CobroClienteService(session_b)
                cobro = svc_b.crear(
                    negocio_id,
                    _make_create(cliente_id=cliente_id, monto=Decimal("100.00")),
                    idempotency_key=key,
                )
                session_b.commit()
                resultados["b"] = {"id": cobro.id, "es_repeticion": cobro.es_repeticion}
            except Exception as exc:  # pragma: no cover
                errores["b"] = exc
            finally:
                session_b.close()

        def hilo_watcher():
            assert listo_para_b.wait(timeout=10), "A nunca insertó"
            deadline = time.monotonic() + 15
            session_w = Session(engine)
            try:
                while time.monotonic() < deadline and not detener_watcher.is_set():
                    pid = pids.get("b")
                    if pid is not None:
                        fila = session_w.execute(
                            text(
                                "SELECT wait_event_type FROM pg_stat_activity "
                                "WHERE pid = :pid"
                            ),
                            {"pid": pid},
                        ).first()
                        session_w.rollback()
                        if fila is not None and fila[0] == "Lock":
                            bloqueo_detectado.set()
                            return
                    time.sleep(0.01)
            except Exception as exc:  # pragma: no cover
                errores["watcher"] = exc
            finally:
                session_w.close()

        t_a = threading.Thread(target=hilo_a)
        t_b = threading.Thread(target=hilo_b)
        t_w = threading.Thread(target=hilo_watcher)
        t_a.start()
        t_b.start()
        t_w.start()
        t_a.join(timeout=20)
        t_b.join(timeout=20)
        detener_watcher.set()
        t_w.join(timeout=5)

        assert not errores, f"error inesperado en la carrera: {errores}"
        assert "a" in resultados and "b" in resultados
        assert resultados["a"]["id"] == resultados["b"]["id"]
        assert resultados["a"]["es_repeticion"] is False
        assert resultados["b"]["es_repeticion"] is True

        with Session(engine) as verify:
            filas = verify.exec(
                select(CobroCliente).where(
                    CobroCliente.negocio_id == negocio_id, CobroCliente.idempotency_key == key
                )
            ).all()
        assert len(filas) == 1

        assert bloqueo_detectado.is_set(), (
            "nunca se observó al backend de B esperando un lock: la 'carrera' "
            "corrió en secuencia, probablemente por un runner sobrecargado."
        )


# ── 9.x — schema, router ─────────────────────────────────────────────────────


class TestSchema:
    def test_cobro_response_no_expone_la_clave(self):
        """9.1"""
        from app.schemas.cobro_cliente import CobroClienteResponse

        assert "idempotency_key" not in CobroClienteResponse.model_fields


class TestEndpointClaveMalformada:
    def test_clave_no_uuid_es_422_y_no_persiste_nada(self, app_with_db, engine):
        """9.1"""
        u = make_user_client(app_with_db, prefix="c43cob_a")
        cliente = _cliente_api(u)
        _fiado_api(u, cliente["id"])

        respuesta = _cobro_api(
            u, cliente["id"], headers={"Idempotency-Key": "no-es-un-uuid"}
        )
        assert respuesta.status_code == 422

        with Session(engine) as s:
            total = s.exec(
                select(CobroCliente).where(CobroCliente.negocio_id == uuid.UUID(u.negocio_id))
            ).all()
        assert total == []


class TestEndpointReplay:
    def test_primer_post_201_segundo_post_200_con_header_y_saldo_descuenta_una_sola_vez(self, app_with_db):
        """9.2 — el escenario que motiva design.md D2, extremo a extremo."""
        u = make_user_client(app_with_db, prefix="c43cob_b")
        cliente = _cliente_api(u)
        _fiado_api(u, cliente["id"], monto="1000.00")
        key = str(uuid.uuid4())

        primero = _cobro_api(u, cliente["id"], headers={"Idempotency-Key": key}, monto="1000.00")
        assert primero.status_code == 201, primero.text
        assert "Idempotent-Replay" not in primero.headers

        segundo = _cobro_api(u, cliente["id"], headers={"Idempotency-Key": key}, monto="1000.00")
        assert segundo.status_code == 200, segundo.text
        assert segundo.headers.get("Idempotent-Replay") == "true"
        assert segundo.json()["id"] == primero.json()["id"]

        cuenta = u.get(f"/api/clientes/{cliente['id']}/cuenta-corriente")
        if cuenta.status_code == 200:
            assert Decimal(str(cuenta.json()["saldo"])) == Decimal("0.00")
        else:
            listado = u.get(f"/api/cobros/?cliente_id={cliente['id']}")
            assert listado.json()["total"] == 1

    def test_sin_sesion_sigue_dando_401_antes_que_el_header(self, app_with_db):
        """9.1"""
        anonimo = make_anon_client(app_with_db)
        respuesta = anonimo.post(
            "/api/cobros/",
            json={
                "cliente_id": str(uuid.uuid4()),
                "monto": "1.00",
                "fecha": str(_HOY),
                "metodo": "EFECTIVO",
            },
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert respuesta.status_code == 401
