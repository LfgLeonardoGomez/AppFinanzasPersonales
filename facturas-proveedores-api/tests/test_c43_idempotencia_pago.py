"""
C-43 Fase A — idempotency for `POST /api/pagos`.

`test_pago_integration.py` and `test_pago_service.py` stay untouched: every
one of their tests posts WITHOUT `Idempotency-Key`, and that suite staying
green is the proof this change does not alter the no-header path (task 1.2,
design.md Migration Plan step 3). This file is entirely new coverage.

Mirrors `test_c42_idempotencia_venta.py`'s structure and technique (tasks.md
groups 4/5):

- `TestModelo`        — the column persists and nothing derived leaks in.
- `TestPagoService`    — direct service-level tests against a real Session,
  including the one genuine concurrency test in this file: two OS threads,
  two DB sessions, two Postgres transactions (4.9).
- `TestEndpoint`       — the same behaviors through the HTTP surface, plus
  what only the router owns: the header and the status code (group 5).
"""

import threading
import time
import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, select

from sqlalchemy import text

import app.models  # noqa: F401 — register all SQLModel tables
from app.models.enums import MetodoPago, OrigenDocumento
from app.models.pago import Pago
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.pago import PagoCreate
from app.services.pago_service import PagoService
from tests.conftest import crear_negocio, make_anon_client, make_user_client

_HOY = date.today()


# ── Fixtures ──────────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)

    # SQLModel's create_all does not know about indexes that live only in
    # migrations (0013's partial unique index) — same patch-up
    # test_c42_idempotencia_venta.py does for 0012's.
    with eng.begin() as conn:
        conn.execute(text("DROP INDEX IF EXISTS uq_pago_negocio_idempotency_key"))
        conn.execute(
            text(
                "CREATE UNIQUE INDEX uq_pago_negocio_idempotency_key "
                "ON pago (negocio_id, idempotency_key) "
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
    from app.routers.pagos import get_db as get_db_pagos

    reset_rate_limit_store()

    def override_get_db():
        with Session(engine) as s:
            yield s

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


def _make_create(**overrides) -> PagoCreate:
    payload = {
        "proveedor_id": uuid.uuid4(),
        "monto": Decimal("1000.00"),
        "fecha": _HOY,
        "metodo": MetodoPago.EFECTIVO,
    }
    payload.update(overrides)
    return PagoCreate(**payload)


def _proveedor_api(usuario: TestClient) -> dict:
    resp = usuario.post(
        "/api/proveedores/",
        json={"nombre": f"Prov {uuid.uuid4().hex[:6]}", "categoria": "OTRO"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


def _pago_api(usuario: TestClient, proveedor_id: str, headers: dict | None = None, **campos):
    cuerpo = {
        "proveedor_id": proveedor_id,
        "monto": "1000.00",
        "fecha": str(_HOY),
        "metodo": "EFECTIVO",
        **campos,
    }
    return usuario.post("/api/pagos/", json=cuerpo, headers=headers or {})


# ── 2.7/2.8 (already covered by migration test) — model roundtrip ─────────────


class TestModelo:
    def test_persiste_la_clave_y_no_gana_columnas_derivadas(self, session, engine):
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        key = uuid.uuid4()
        pago = Pago(
            negocio_id=negocio.id,
            proveedor_id=proveedor.id,
            monto=Decimal("123.45"),
            fecha=_HOY,
            metodo=MetodoPago.EFECTIVO,
            origen=OrigenDocumento.MANUAL,
            idempotency_key=key,
        )
        session.add(pago)
        session.commit()
        session.refresh(pago)

        assert pago.idempotency_key == key

        columnas = {c["name"] for c in inspect(engine).get_columns("pago")}
        assert "saldo" not in columnas
        assert "estado" not in columnas
        assert "factura_id" not in columnas


# ── 4.x — PagoService ───────────────────────────────────────────────────────


class TestCrearSinClave:
    def test_se_comporta_exactamente_como_antes(self, session):
        """4.1"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = PagoService(session)
        pago = svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id))
        session.commit()

        assert pago.idempotency_key is None

    def test_dos_llamadas_iguales_sin_clave_producen_dos_pagos(self, session):
        """4.1, triangulación."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = PagoService(session)
        for _ in range(2):
            svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id))
        session.commit()

        total = session.exec(
            select(Pago).where(Pago.negocio_id == negocio.id)
        ).all()
        assert len(total) == 2

    def test_integrity_error_sin_clave_se_propaga_sin_tocar(self, session, monkeypatch):
        """4.1 — un IntegrityError sin clave sigue propagándose sin tocar."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = PagoService(session)

        def _boom(**kwargs):
            raise IntegrityError("INSERT", {}, None)

        monkeypatch.setattr(svc._repo, "create", _boom)

        with pytest.raises(IntegrityError):
            svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id))


class TestCrearConClave:
    def test_clave_nueva_se_reporta_como_creada(self, session):
        """4.2"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = PagoService(session)
        pago = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id, monto=Decimal("700.00")),
            idempotency_key=uuid.uuid4(),
        )
        session.commit()

        assert pago.id is not None
        assert pago.idempotency_key is not None
        assert pago.es_repeticion is False

    def test_clave_repetida_con_los_mismos_datos_devuelve_el_original(self, session):
        """4.3"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()

        svc = PagoService(session)
        datos = _make_create(proveedor_id=proveedor.id, monto=Decimal("300.00"))

        primero = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        segundo = svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        assert primero.es_repeticion is False
        assert segundo.es_repeticion is True
        assert segundo.id == primero.id

        total = session.exec(
            select(Pago).where(
                Pago.negocio_id == negocio.id, Pago.idempotency_key == key
            )
        ).all()
        assert len(total) == 1

    def test_repetir_cinco_veces_deja_un_solo_pago(self, session):
        """4.3 — triangulación con más repeticiones."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        datos = _make_create(proveedor_id=proveedor.id, monto=Decimal("50.00"))

        svc = PagoService(session)
        ids = set()
        for _ in range(5):
            pago = svc.crear(negocio.id, datos, idempotency_key=key)
            session.commit()
            ids.add(pago.id)

        assert len(ids) == 1
        total = session.exec(
            select(Pago).where(
                Pago.negocio_id == negocio.id, Pago.idempotency_key == key
            )
        ).all()
        assert len(total) == 1

    @pytest.mark.parametrize(
        "campo,valor_nuevo",
        [
            ("monto", Decimal("999.00")),
            ("fecha", _HOY - timedelta(days=1)),
            ("metodo", MetodoPago.TRANSFERENCIA),
        ],
    )
    def test_clave_repetida_con_dato_distinto_es_409(self, session, campo, valor_nuevo):
        """4.4 y su triangulación (monto / fecha / metodo distintos)."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()

        campos_base = dict(
            proveedor_id=proveedor.id, monto=Decimal("300.00"), fecha=_HOY,
            metodo=MetodoPago.EFECTIVO,
        )

        svc = PagoService(session)
        original = svc.crear(negocio.id, _make_create(**campos_base), idempotency_key=key)
        session.commit()

        campos_repetidos = {**campos_base, campo: valor_nuevo}

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, _make_create(**campos_repetidos), idempotency_key=key)

        assert excinfo.value.status_code == 409
        assert excinfo.value.detail["pago_existente"]["id"] == str(original.id)

        session.rollback()
        conservado = session.exec(select(Pago).where(Pago.id == original.id)).one()
        assert getattr(conservado, campo) == campos_base[campo]

    def test_clave_repetida_con_proveedor_distinto_es_409(self, session):
        """4.4 — triangulación con proveedor_id distinto."""
        negocio = crear_negocio(session)
        prov_a = _crear_proveedor_db(session, negocio.id, "A")
        prov_b = _crear_proveedor_db(session, negocio.id, "B")
        key = uuid.uuid4()

        svc = PagoService(session)
        svc.crear(
            negocio.id,
            _make_create(proveedor_id=prov_a.id, monto=Decimal("300.00")),
            idempotency_key=key,
        )
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio.id,
                _make_create(proveedor_id=prov_b.id, monto=Decimal("300.00")),
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 409

    def test_origen_resuelto_omitido_es_repeticion_no_conflicto(self, session):
        """4.5 — el borde que rompe si se compara datos.origen crudo."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()

        svc = PagoService(session)
        original = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id, origen=OrigenDocumento.MANUAL),
            idempotency_key=key,
        )
        session.commit()
        assert original.origen == OrigenDocumento.MANUAL

        # El payload repetido NO manda origen (queda None → se resuelve a MANUAL).
        repeticion = svc.crear(
            negocio.id,
            _make_create(proveedor_id=proveedor.id),
            idempotency_key=key,
        )
        session.commit()

        assert repeticion.id == original.id

    def test_la_clave_de_un_pago_eliminado_no_se_recicla(self, session):
        """4.6"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()

        svc = PagoService(session)
        creado = svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id), idempotency_key=key)
        session.commit()

        svc.eliminar(negocio.id, creado.id)
        session.commit()

        with pytest.raises(HTTPException) as excinfo:
            svc.crear(negocio.id, _make_create(proveedor_id=proveedor.id), idempotency_key=key)
        assert excinfo.value.status_code == 409
        session.rollback()

        items, total = svc.listar(negocio.id)
        assert total == 0
        assert all(p.id != creado.id for p in items)

    def test_la_misma_clave_en_dos_negocios_crea_dos_pagos(self, session):
        """4.7"""
        negocio_a = crear_negocio(session, nombre="Negocio A")
        negocio_b = crear_negocio(session, nombre="Negocio B")
        prov_a = _crear_proveedor_db(session, negocio_a.id)
        prov_b = _crear_proveedor_db(session, negocio_b.id)
        key = uuid.uuid4()

        svc = PagoService(session)
        pago_a = svc.crear(
            negocio_a.id, _make_create(proveedor_id=prov_a.id, monto=Decimal("111.00")),
            idempotency_key=key,
        )
        session.commit()
        pago_b = svc.crear(
            negocio_b.id, _make_create(proveedor_id=prov_b.id, monto=Decimal("222.00")),
            idempotency_key=key,
        )
        session.commit()

        assert pago_a.id != pago_b.id

        # Mutación de referencia: si get_by_idempotency_key perdiera el filtro
        # por negocio_id, uno de estos listados mostraría el pago ajeno.
        items_a, _ = svc.listar(negocio_a.id)
        items_b, _ = svc.listar(negocio_b.id)
        assert {p.id for p in items_a} == {pago_a.id}
        assert {p.id for p in items_b} == {pago_b.id}

    def test_la_validacion_de_proveedor_corre_antes_que_la_idempotencia(self, session):
        """4.8 — proveedor ajeno con clave nueva sigue dando 404 y la clave queda libre."""
        negocio_a = crear_negocio(session, nombre="A")
        negocio_b = crear_negocio(session, nombre="B")
        prov_ajeno = _crear_proveedor_db(session, negocio_b.id)
        key = uuid.uuid4()

        svc = PagoService(session)
        with pytest.raises(HTTPException) as excinfo:
            svc.crear(
                negocio_a.id,
                _make_create(proveedor_id=prov_ajeno.id),
                idempotency_key=key,
            )
        assert excinfo.value.status_code == 404

        total = session.exec(select(Pago).where(Pago.negocio_id == negocio_a.id)).all()
        assert total == []

        # La clave sigue libre para un envío corregido.
        prov_propio = _crear_proveedor_db(session, negocio_a.id)
        pago = svc.crear(
            negocio_a.id, _make_create(proveedor_id=prov_propio.id), idempotency_key=key
        )
        session.commit()
        assert pago.id is not None

    def test_integrity_error_de_otra_constraint_se_propaga(self, session, monkeypatch):
        """4.11"""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)

        svc = PagoService(session)

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
                _make_create(proveedor_id=proveedor.id),
                idempotency_key=uuid.uuid4(),
            )


class TestSesionDespuesDeLaViolacion:
    def test_la_relectura_funciona_porque_hubo_rollback(self, session):
        """4.10 — mutación de referencia: sin el rollback(), esto falla con
        PendingRollbackError en vez de dar la repetición."""
        negocio = crear_negocio(session)
        proveedor = _crear_proveedor_db(session, negocio.id)
        key = uuid.uuid4()
        datos = _make_create(proveedor_id=proveedor.id)

        svc = PagoService(session)
        svc.crear(negocio.id, datos, idempotency_key=key)
        session.commit()

        repeticion = svc.crear(negocio.id, datos, idempotency_key=key)
        assert repeticion.id is not None
        assert repeticion.es_repeticion is True

        de_nuevo = session.exec(select(Pago).where(Pago.id == repeticion.id)).one()
        assert de_nuevo.id == repeticion.id


class TestCarreraReal:
    """4.9 — concurrencia real: dos hilos de sistema operativo, dos Session,
    la misma idempotency_key. Mismo patrón que test_c42_idempotencia_venta.py."""

    def test_dos_inserts_concurrentes_con_la_misma_clave_producen_un_solo_pago(self, engine):
        from sqlalchemy import text as _text

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
                svc_a = PagoService(session_a)
                pago = svc_a.crear(
                    negocio_id,
                    _make_create(proveedor_id=proveedor_id, monto=Decimal("500.00")),
                    idempotency_key=key,
                )
                listo_para_b.set()
                time.sleep(1.0)
                session_a.commit()
                resultados["a"] = {"id": pago.id, "es_repeticion": pago.es_repeticion}
            except Exception as exc:  # pragma: no cover
                errores["a"] = exc
                listo_para_b.set()
            finally:
                session_a.close()

        def hilo_b():
            assert listo_para_b.wait(timeout=10), "A nunca insertó"
            session_b = Session(engine)
            try:
                pids["b"] = session_b.execute(_text("SELECT pg_backend_pid()")).scalar()
                svc_b = PagoService(session_b)
                pago = svc_b.crear(
                    negocio_id,
                    _make_create(proveedor_id=proveedor_id, monto=Decimal("500.00")),
                    idempotency_key=key,
                )
                session_b.commit()
                resultados["b"] = {"id": pago.id, "es_repeticion": pago.es_repeticion}
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
                            _text(
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
        assert "a" in resultados and "b" in resultados, "algún hilo no terminó"
        assert resultados["a"]["id"] == resultados["b"]["id"]
        assert resultados["a"]["es_repeticion"] is False
        assert resultados["b"]["es_repeticion"] is True

        with Session(engine) as verify:
            filas = verify.exec(
                select(Pago).where(
                    Pago.negocio_id == negocio_id, Pago.idempotency_key == key
                )
            ).all()
        assert len(filas) == 1

        assert bloqueo_detectado.is_set(), (
            "nunca se observó al backend de B esperando un lock: la 'carrera' "
            "corrió en secuencia, probablemente por un runner sobrecargado. "
            "Esto NO es el escenario que el test dice cubrir."
        )


# ── 5.x — schema, router ────────────────────────────────────────────────────


class TestSchema:
    def test_pago_response_no_expone_la_clave(self):
        """5.1"""
        from app.schemas.pago import PagoResponse

        assert "idempotency_key" not in PagoResponse.model_fields


class TestEndpointClaveMalformada:
    def test_clave_no_uuid_es_422_y_no_persiste_nada(self, app_with_db, engine):
        """5.2"""
        u = make_user_client(app_with_db, prefix="c43pag_a")
        proveedor = _proveedor_api(u)
        respuesta = _pago_api(
            u, proveedor["id"], headers={"Idempotency-Key": "no-es-un-uuid"}
        )
        assert respuesta.status_code == 422

        with Session(engine) as s:
            total = s.exec(
                select(Pago).where(Pago.negocio_id == uuid.UUID(u.negocio_id))
            ).all()
        assert total == []


class TestEndpointReplay:
    def test_primer_post_201_segundo_post_200_con_header(self, app_with_db):
        """5.3"""
        u = make_user_client(app_with_db, prefix="c43pag_b")
        proveedor = _proveedor_api(u)
        key = str(uuid.uuid4())

        primero = _pago_api(u, proveedor["id"], headers={"Idempotency-Key": key})
        assert primero.status_code == 201, primero.text
        assert "Idempotent-Replay" not in primero.headers

        segundo = _pago_api(u, proveedor["id"], headers={"Idempotency-Key": key})
        assert segundo.status_code == 200, segundo.text
        assert segundo.headers.get("Idempotent-Replay") == "true"
        assert segundo.json()["id"] == primero.json()["id"]
        assert segundo.json()["proveedor_nombre"] == primero.json()["proveedor_nombre"]

    def test_el_pago_repetido_deja_el_fifo_igual(self, app_with_db):
        """5.4 — el daño que motiva el change entero."""
        u = make_user_client(app_with_db, prefix="c43pag_c")
        proveedor = _proveedor_api(u)

        factura = u.post(
            "/api/facturas/",
            json={
                "proveedor_id": proveedor["id"],
                "fecha_emision": str(_HOY),
                "monto_total": "1000.00",
            },
        )
        assert factura.status_code == 201, factura.text
        assert factura.json()["estado"] == "PENDIENTE"

        key = str(uuid.uuid4())
        for _ in range(2):
            respuesta = _pago_api(
                u, proveedor["id"], headers={"Idempotency-Key": key}, monto="1000.00"
            )
            assert respuesta.status_code in (200, 201), respuesta.text

        releida = u.get(f"/api/facturas/{factura.json()['id']}")
        assert releida.json()["estado"] == "PAGADA"

        listado = u.get(f"/api/pagos/?proveedor_id={proveedor['id']}")
        assert listado.json()["total"] == 1

    def test_sin_sesion_sigue_dando_401_antes_que_el_header(self, app_with_db):
        """5.5"""
        anonimo = make_anon_client(app_with_db)
        respuesta = anonimo.post(
            "/api/pagos/",
            json={
                "proveedor_id": str(uuid.uuid4()),
                "monto": "1.00",
                "fecha": str(_HOY),
                "metodo": "EFECTIVO",
            },
            headers={"Idempotency-Key": str(uuid.uuid4())},
        )
        assert respuesta.status_code == 401
