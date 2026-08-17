"""
C-43 Fase A — idempotency for `POST /api/facturas`.

`test_factura_integration.py` and `test_factura_service.py` stay untouched:
every one of their tests posts WITHOUT `Idempotency-Key`, and that suite
staying green is the proof this change does not alter the no-header path
(task 1.2). This file is entirely new coverage.

Facturas are NOT a copy-paste of pagos (design.md, table in Context): the
replay branch must recompute the FIFO `estado` and reread items at response
time (D4), and the "same data" comparison includes the items (D3). Groups
6/7.
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
from app.models.enums import EstadoFactura, OrigenDocumento
from app.models.factura import Factura
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.factura import FacturaCreate, FacturaItemCreate
from app.services.factura_service import FacturaService
from tests.conftest import crear_negocio, make_anon_client, make_user_client

_HOY = date.today()


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)

    with eng.begin() as conn:
        conn.execute(text("DROP INDEX IF EXISTS uq_factura_negocio_idempotency_key"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX uq_factura_negocio_idempotency_key "
                "ON factura (negocio_id, idempotency_key) "
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
    from app.routers.facturas import get_db as get_db_facturas
    from app.routers.pagos import get_db as get_db_pagos

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

    app.dependency_overrides[get_db_facturas] = override_get_db
    app.dependency_overrides[get_db_pagos] = override_get_db

    with TestClient(app, raise_server_exceptions=True):
        yield app

    app.dependency_overrides.clear()


# ── Helpers ───────────────────────────────────────────────────────────────────


def _crear_proveedor_db(session: Session, negocio_id: uuid.UUID, nombre: str = "Prov"):
    repo = ProveedorRepository(session)
    proveedor = repo.create(
        negocio_id=negocio_id,
        creado_por_usuario_id=None,
        nombre=f"{nombre} {uuid.uuid4().hex[:6]}",
        categoria="OTRO",
    )
    session.commit()
    return proveedor


def _make_create(**overrides) -> FacturaCreate:
    payload = {
        "proveedor_id": uuid.uuid4(),
        "fecha_emision": _HOY,
        "monto_total": Decimal("1000.00"),
    }
    payload.update(overrides)
    return FacturaCreate(**payload)


def _proveedor_api(usuario: TestClient) -> dict:
    resp = usuario.post(
        "/api/proveedores/",
        json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _factura_api(usuario: TestClient, proveedor_id: str, headers: dict | None = None, **campos):
    cuerpo = {
        "proveedor_id": proveedor_id,
        "fecha_emision": str(_HOY),
        "monto_total": "1000.00",
        **campos,
    }
    return usuario.post("/api/facturas/", json=cuerpo, headers=headers or {})


# ── Modelo ────────────────────────────────────────────────────────────────────


class TestModelo:
    def test_persiste_la_clave_y_no_gana_columnas_derivadas(self, session, engine):
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        key = uuid.uuid4()
        factura = Factura(
            negocio_id=negocio.id,
            proveedor_id=proveedor.id,
            fecha_emision=_HOY,
            monto_total=Decimal("123.45"),
            origen=OrigenDocumento.MANUAL,
            idempotency_key=key,
        )
        session.add(factura)
        session.commit()
        session.refresh(factura)

        assert factura.idempotency_key == key

        columnas = {c["name"] for c in inspect(engine).get_columns("factura")}
        assert "saldo" not in columnas
        assert "estado" not in columnas

        columnas_item = {c["name"] for c in inspect(engine).get_columns("factura_item")}
        assert "idempotency_key" not in columnas_item


# ── 6.x — FacturaService ─────────────────────────────────────────────────────


class TestCrearSinClave:
    def test_se_comporta_exactamente_como_antes(self, session):
        """6.1"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = FacturaService(session)
        result = svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id))
        session.commit()

        assert result.idempotency_key is None
        assert result.estado == EstadoFactura.PENDIENTE
        assert result.items_sum_mismatch is False


class TestCrearConClave:
    def test_clave_nueva_se_reporta_como_creada(self, session):
        """6.2"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = FacturaService(session)
        result = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id, monto_total=Decimal("700.00")),
            idempotency_key=uuid.uuid4(),
        )
        session.commit()

        assert result.id is not None
        assert result.es_repeticion is False

    def test_clave_repetida_con_los_mismos_datos_e_items_devuelve_la_original(self, session):
        """6.3"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        datos = _make_create(
            proveedor_id=proveedor.id,
            items=[FacturaItemCreate(descripcion="Item A", cantidad=Decimal("2"), precio_unitario=Decimal("500.00"))],
        )

        svc = FacturaService(session)
        primero = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        segundo = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        assert primero.es_repeticion is False
        assert segundo.es_repeticion is True
        assert segundo.id == primero.id

        total = session.exec(
            select(Factura).where(
                Factura.negocio_id == negocio.id, Factura.idempotency_key == key
            )
        ).all()
        assert len(total) == 1

    def test_repetir_cinco_veces_deja_una_sola_factura(self, session):
        """6.3 — triangulación."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        datos = _make_create(proveedor_id=proveedor.id, monto_total=Decimal("50.00"))

        svc = FacturaService(session)
        ids = set()
        for _ in range(5):
            result = svc.crear(negocio.id, datos, idempotency_key=key)
            session.commit()
            ids.add(result.id)

        assert len(ids) == 1

    def test_la_repeticion_no_duplica_los_items(self, session):
        """6.4 — la implementación ingenua que re-corre create_with_items falla acá."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        items = [
            FacturaItemCreate(descripcion="A", cantidad=Decimal("1"), precio_unitario=Decimal("300.00")),
            FacturaItemCreate(descripcion="B", cantidad=Decimal("1"), precio_unitario=Decimal("300.00")),
            FacturaItemCreate(descripcion="C", cantidad=Decimal("1"), precio_unitario=Decimal("400.00")),
        ]
        datos = _make_create(proveedor_id=proveedor.id, items=items)

        svc = FacturaService(session)
        primero = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()
        assert len(primero.items) == 3

        segundo = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        assert len(segundo.items) == 3

    def test_item_corregido_es_409_no_repeticion(self, session):
        """6.5 — mismo monto_total, detalle de un item distinto."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        items_originales = [
            FacturaItemCreate(descripcion="Original", cantidad=Decimal("1"), precio_unitario=Decimal("1000.00")),
        ]

        svc = FacturaService(session)
        original = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id, items=items_originales),
            idempotency_key=key,
        )
        session.commit()

        items_corregidos = [
            FacturaItemCreate(descripcion="Corregido", cantidad=Decimal("1"), precio_unitario=Decimal("1000.00")),
        ]

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                _make_create(proveedor_id=proveedor.id, items=items_corregidos),
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 409
        assert excinfo.value.detail["factura_existente"]["id"] == str(original.id)

        session.rollback()
        items_guardados = session.exec(
            select(Factura).where(Factura.id == original.id)
        ).one()
        assert items_guardados.id == original.id

    @pytest.mark.parametrize(
        "descripcion_extra",
        ["item agregado"],
    )
    def test_item_agregado_es_409(self, session, descripcion_extra):
        """6.5 — triangulación: un item de más también es conflicto."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        base_item = FacturaItemCreate(
            descripcion="Base", cantidad=Decimal("1"), precio_unitario=Decimal("500.00")
        )

        svc = FacturaService(session)
        svc.crear(
            negocio.id,
            _make_create(
                proveedor_id=proveedor.id,
                monto_total=Decimal("500.00"),
                items=[base_item],
            ),
            idempotency_key=key,
        )
        session.commit()

        items_con_extra = [
            base_item,
            FacturaItemCreate(
                descripcion=descripcion_extra, cantidad=Decimal("1"), precio_unitario=Decimal("0.00")
            ),
        ]
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                _make_create(
                    proveedor_id=proveedor.id,
                    monto_total=Decimal("500.00"),
                    items=items_con_extra,
                ),
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 409

    def test_items_sum_mismatch_no_participa_de_la_comparacion(self, session):
        """6.6 — es salida derivada, no entrada."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        # monto_total no coincide con la suma de items -> items_sum_mismatch True,
        # pero repetir EXACTAMENTE el mismo payload sigue siendo una repetición.
        items = [
            FacturaItemCreate(descripcion="X", cantidad=Decimal("1"), precio_unitario=Decimal("100.00")),
        ]
        datos = _make_create(proveedor_id=proveedor.id, monto_total=Decimal("999.00"), items=items)

        svc = FacturaService(session)
        primero = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()
        assert primero.items_sum_mismatch is True

        segundo = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()
        assert segundo.es_repeticion is True
        assert segundo.id == primero.id

    def test_la_clave_de_una_factura_eliminada_no_se_recicla(self, session):
        """6.7"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()

        svc = FacturaService(session)
        creada = svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id), idempotency_key=key)
        session.commit()

        svc.eliminar(negocio.id, creada.id)
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id), idempotency_key=key)
        assert excinfo.value.status_code == 409
        session.rollback()

    def test_la_misma_clave_en_dos_negocios_crea_dos_facturas(self, session):
        """6.8"""
        negocio_a = crear_negocio(session, nombre="A")
        negocio_b = crear_negocio(session, nombre="B")
        prov_a = _crear_proveedor_db(session, negocio_a.id)
        prov_b = _crear_proveedor_db(session, negocio_b.id)
        key = uuid.uuid4()

        svc = FacturaService(session)
        result_a = svc.crear(
            negocio_a.id, _make_create(proveedor_id=prov_a.id, monto_total=Decimal("111.00")),
            idempotency_key=key,
        )
        session.commit()
        result_b = svc.crear(
            negocio_b.id, _make_create(proveedor_id=prov_b.id, monto_total=Decimal("222.00")),
            idempotency_key=key,
        )
        session.commit()

        assert result_a.id != result_b.id

    def test_la_validacion_de_proveedor_corre_antes_que_la_idempotencia(self, session):
        """6.9"""
        negocio_a = crear_negocio(session, nombre="A")
        negocio_b = crear_negocio(session, nombre="B")
        prov_ajeno = _crear_proveedor_db(session, negocio_b.id)
        key = uuid.uuid4()

        svc = FacturaService(session)
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio_a.id, _make_create(proveedor_id=prov_ajeno.id), idempotency_key=key)
        assert excinfo.value.status_code == 404

        total = session.exec(select(Factura).where(Factura.negocio_id == negocio_a.id)).all()
        assert total == []

        prov_propio = _crear_proveedor_db(session, negocio_a.id)
        result = svc.crear(negocio_a.id, _make_create(proveedor_id=prov_propio.id), idempotency_key=key)
        session.commit()
        assert result.id is not None

    def test_repeticion_recalcula_el_fifo_del_momento_de_responder(self, session):
        """
        6.10 — design.md D4, el test del riesgo central de facturas: entre el
        intento original y la repetición entró un pago, el estado cambia, y
        eso es CORRECTO — la garantía es "una sola fila", no "mismos bytes".
        """
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()

        svc = FacturaService(session)
        original = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id, monto_total=Decimal("1000.00")),
            idempotency_key=key,
        )
        session.commit()
        assert original.estado == EstadoFactura.PENDIENTE

        from app.schemas.pago import PagoCreate
        from app.services.pago_service import PagoService

        pago_svc = PagoService(session)
        pago_svc.crear(
            negocio.id,
            PagoCreate(
                proveedor_id=proveedor.id,
                monto=Decimal("1000.00"),
                fecha=_HOY,
                metodo="EFECTIVO",
            ),
        )
        session.commit()

        repeticion = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id, monto_total=Decimal("1000.00")),
            idempotency_key=key,
        )
        session.commit()

        assert repeticion.id == original.id
        assert repeticion.es_repeticion is True
        assert repeticion.estado == EstadoFactura.PAGADA

        total = session.exec(
            select(Factura).where(
                Factura.negocio_id == negocio.id, Factura.idempotency_key == key
            )
        ).all()
        assert len(total) == 1

    def test_repeticion_relee_los_items_de_la_base(self, session):
        """
        6.11 — verificable por mutación: si la rama de réplica devolviera
        `datos.items` (los `FacturaItemCreate` del pedido) en vez de
        `list_by_factura` (las filas `FacturaItem` persistidas), los items
        de la respuesta NO tendrían `id` ni `factura_id` reales — atributos
        que solo existen en la fila de la base. Comparar contra el `id`
        efectivamente persistido es la única forma de distinguir "releído"
        de "reconstruido desde el pedido" en un caso donde, además, los
        VALORES de ambos caminos coinciden (es justamente una repetición
        legítima, mismos datos).
        """
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        items = [FacturaItemCreate(descripcion="Original", cantidad=Decimal("1"), precio_unitario=Decimal("500.00"))]
        datos = _make_create(proveedor_id=proveedor.id, monto_total=Decimal("500.00"), items=items)

        svc = FacturaService(session)
        creada = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()
        assert len(creada.items) == 1
        item_persistido_id = creada.items[0].id

        repeticion = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        assert repeticion.es_repeticion is True
        assert len(repeticion.items) == 1
        # El item de la repetición ES el mismo registro persistido (mismo id
        # real de base), no un FacturaItemCreate del pedido reconstruido.
        assert repeticion.items[0].id == item_persistido_id
        assert repeticion.items[0].factura_id == repeticion.id

    def test_integrity_error_de_otra_constraint_se_propaga(self, session, monkeypatch):
        """6.13"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = FacturaService(session)

        class _FakeDiag:
            constraint_name = "alguna_otra_constraint"

        class _FakeOrig:
            diag = _FakeDiag()

        def _boom(**kwargs):
            raise IntegrityError("INSERT", {}, _FakeOrig())

        monkeypatch.setattr(svc._repo, "create_with_items", _boom)

        with pytest.raises(IntegrityError):
            svc.crear(
                negocio.id,
                _make_create(proveedor_id=proveedor.id),
                idempotency_key=uuid.uuid4(),
            )


class TestSesionDespuesDeLaViolacion:
    def test_la_relectura_funciona_porque_hubo_rollback(self, session):
        """6.13 — mutación de referencia: sin rollback(), PendingRollbackError."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        datos = _make_create(proveedor_id=proveedor.id)

        svc = FacturaService(session)
        svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        repeticion = svc.crear(negocio.id, datos, idempotency_key=key)
        assert repeticion.es_repeticion is True

        de_nuevo = session.exec(select(Factura).where(Factura.id == repeticion.id)).one()
        assert de_nuevo.id == repeticion.id


class TestCarreraReal:
    """6.12 — la colisión salta en el flush de `factura`, antes de que
    exista un solo item (create_with_items flushea la cabecera primero)."""

    def test_dos_inserts_concurrentes_con_la_misma_clave_producen_una_sola_factura(self, engine):
        with Session(engine) as setup:
            negocio = crear_negocio(setup, nombre=f"Carrera {uuid.uuid4().hex[:6]}")
            proveedor = _crear_proveedor_db(setup, negocio.id)
            negocio_id = negocio.id
            proveedor_id = proveedor.id

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
                svc_a = FacturaService(session_a)
                result = svc_a.crear(
                    negocio_id,
                    _make_create(proveedor_id=proveedor_id, monto_total=Decimal("500.00")),
                    idempotency_key=key,
                )
                listo_para_b.set()
                time.sleep(1.0)
                session_a.commit()
                resultados["a"] = {"id": result.id, "es_repeticion": result.es_repeticion}
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
                svc_b = FacturaService(session_b)
                result = svc_b.crear(
                    negocio_id,
                    _make_create(proveedor_id=proveedor_id, monto_total=Decimal("500.00")),
                    idempotency_key=key,
                )
                session_b.commit()
                resultados["b"] = {"id": result.id, "es_repeticion": result.es_repeticion}
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
                select(Factura).where(
                    Factura.negocio_id == negocio_id, Factura.idempotency_key == key
                )
            ).all()
        assert len(filas) == 1

        assert bloqueo_detectado.is_set(), (
            "nunca se observó al backend de B esperando un lock: la 'carrera' "
            "corrió en secuencia, probablemente por un runner sobrecargado."
        )


# ── 7.x — schema, router ─────────────────────────────────────────────────────


class TestSchema:
    def test_factura_response_no_expone_la_clave(self):
        """7.1"""
        from app.schemas.factura import FacturaResponse

        assert "idempotency_key" not in FacturaResponse.model_fields


class TestEndpointClaveMalformada:
    def test_clave_no_uuid_es_422_y_no_persiste_nada(self, app_with_db, engine):
        """7.2"""
        u = make_user_client(app_with_db, prefix="c43fac_a")
        proveedor = _proveedor_api(u)
        respuesta = _factura_api(
            u, proveedor["id"], headers={"Idempotency-Key": "no-es-un-uuid"}
        )
        assert respuesta.status_code == 422

        with Session(engine) as s:
            total = s.exec(
                select(Factura).where(Factura.negocio_id == uuid.UUID(u.negocio_id))
            ).all()
        assert total == []


class TestEndpointReplay:
    def test_primer_post_201_segundo_post_200_con_header(self, app_with_db):
        """7.3"""
        u = make_user_client(app_with_db, prefix="c43fac_b")
        proveedor = _proveedor_api(u)
        key = str(uuid.uuid4())

        primero = _factura_api(
            u, proveedor["id"], headers={"Idempotency-Key": key},
            items=[{"descripcion": "Item", "cantidad": "2", "precio_unitario": "500.00"}],
        )
        assert primero.status_code == 201, primero.text
        assert "Idempotent-Replay" not in primero.headers

        segundo = _factura_api(
            u, proveedor["id"], headers={"Idempotency-Key": key},
            items=[{"descripcion": "Item", "cantidad": "2", "precio_unitario": "500.00"}],
        )
        assert segundo.status_code == 200, segundo.text
        assert segundo.headers.get("Idempotent-Replay") == "true"
        assert segundo.json()["id"] == primero.json()["id"]
        assert len(segundo.json()["items"]) == 1
        assert segundo.json()["proveedor_nombre"] == primero.json()["proveedor_nombre"]

    def test_el_reintento_no_desordena_el_fifo_del_proveedor(self, app_with_db):
        """7.3 — daño que motiva el change."""
        u = make_user_client(app_with_db, prefix="c43fac_c")
        proveedor = _proveedor_api(u)

        key = str(uuid.uuid4())
        for _ in range(2):
            respuesta = _factura_api(
                u, proveedor["id"], headers={"Idempotency-Key": key}, monto_total="1000.00"
            )
            assert respuesta.status_code in (200, 201), respuesta.text

        listado = u.get(f"/api/facturas/?proveedor_id={proveedor['id']}")
        assert len(listado.json()) == 1

    def test_sin_sesion_sigue_dando_401_antes_que_el_header(self, app_with_db):
        """7.4"""
        anonimo = make_anon_client(app_with_db)
        respuesta = anonimo.post(
            "/api/facturas/",
            json={
                "proveedor_id": str(uuid.uuid4()),
                "fecha_emision": str(_HOY),
                "monto_total": "1.00",
            },
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert respuesta.status_code == 401
