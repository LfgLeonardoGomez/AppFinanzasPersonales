"""
C-43 Fase A (tasks 9.4-9.6, design.md D6) — `cliente_service` stops guessing
which constraint fired.

`cliente_service.crear` catches a bare `IntegrityError` and answers 409
"nombre duplicado" — correct today only because `cliente` happens to carry a
single unique index. This change does NOT add idempotency to `cliente` (it
is already deduplicated by its own name index, C-32); it only closes the
`except`, using `es_violacion_de` against the real constraint name, same as
pago/factura/cobro/venta.

`test_c32_cliente.py` stays untouched and green — this file is new coverage
of the failure mode that test suite structurally cannot exercise (`cliente`
has only one unique index today, so a real row can't trigger a different
one; the technique is the same C-42 already documented in its task 4.13:
inject the IntegrityError via monkeypatch).
"""

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401
from tests.conftest import crear_negocio


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
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


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s


class _FakeDiag:
    def __init__(self, constraint_name):
        self.constraint_name = constraint_name


class _FakeOrig:
    def __init__(self, constraint_name):
        self.diag = _FakeDiag(constraint_name)


class TestCrearOtraConstraintSePropaga:
    def test_no_se_reporta_como_nombre_duplicado(self, session, monkeypatch):
        """9.4"""
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        session.commit()

        svc = ClienteService(session)

        def _boom(**kwargs):
            raise IntegrityError(
                "INSERT", {}, _FakeOrig("alguna_otra_constraint_que_no_es_la_del_nombre")
            )

        monkeypatch.setattr(svc._repo, "create", _boom)

        try:
            svc.crear(negocio.id, nombre="Cualquier Nombre")
            assert False, "esperaba que se propagara el IntegrityError"
        except IntegrityError:
            pass


class TestActualizarOtraConstraintSePropaga:
    def test_no_se_reporta_como_nombre_duplicado(self, session, monkeypatch):
        """9.4 — mismo arreglo en actualizar."""
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        session.commit()

        svc = ClienteService(session)
        cliente = svc.crear(negocio.id, nombre="Original")
        session.commit()

        def _boom():
            raise IntegrityError(
                "UPDATE", {}, _FakeOrig("alguna_otra_constraint_que_no_es_la_del_nombre")
            )

        # `actualizar` only wraps its OWN explicit `self._session.flush()` in
        # try/except — but SQLAlchemy's autoflush would otherwise fire the
        # patched flush() early, during the SELECT in
        # `get_by_nombre_normalizado` a few lines before the try block,
        # letting the fake IntegrityError escape uncaught for the wrong
        # reason. Disabling autoflush keeps the fake confined to the one
        # flush call this test means to exercise.
        session.autoflush = False
        monkeypatch.setattr(session, "flush", _boom)

        try:
            svc.actualizar(negocio.id, cliente.id, nombre="Renombrado")
            assert False, "esperaba que se propagara el IntegrityError"
        except IntegrityError:
            pass
        finally:
            session.autoflush = True


class TestLaConstraintDelNombreSigueDando409:
    def test_alta_duplicada_sigue_dando_409(self, session):
        """9.5 — triangulación: la violación real de la constraint del
        nombre sigue funcionando exactamente como antes."""
        from app.services.cliente_service import ClienteService
        from fastapi import HTTPException

        negocio = crear_negocio(session)
        session.commit()

        svc = ClienteService(session)
        svc.crear(negocio.id, nombre="Juan Perez")
        session.commit()

        try:
            svc.crear(negocio.id, nombre="juan perez")
            assert False, "esperaba 409"
        except HTTPException as exc:
            assert exc.status_code == 409
            assert "cliente_existente" in exc.detail

    def test_edicion_hacia_una_colision_sigue_dando_409(self, session):
        """9.5 — triangulación en edición."""
        from app.services.cliente_service import ClienteService
        from fastapi import HTTPException

        negocio = crear_negocio(session)
        session.commit()

        svc = ClienteService(session)
        svc.crear(negocio.id, nombre="Ana")
        session.commit()
        beto = svc.crear(negocio.id, nombre="Beto")
        session.commit()

        try:
            svc.actualizar(negocio.id, beto.id, nombre="ana")
            assert False, "esperaba 409"
        except HTTPException as exc:
            assert exc.status_code == 409
