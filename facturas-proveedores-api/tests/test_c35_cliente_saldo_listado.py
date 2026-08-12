"""
Tests for D6 — each customer's on-demand balance in the customer listing
(C-35, scope extension, independently removable). Task 9.1-9.3.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine, event
from sqlmodel import Session, SQLModel

import app.models  # noqa: F401

from tests.conftest import crear_negocio


@pytest.fixture(scope="module")
def engine(db_url: str):
    eng = create_engine(db_url, echo=False)
    SQLModel.metadata.create_all(eng)
    yield eng
    SQLModel.metadata.drop_all(eng)


@pytest.fixture
def session(engine):
    with Session(engine) as s:
        yield s
        s.rollback()


def _cliente(session: Session, negocio_id: uuid.UUID, nombre: str | None = None):
    from app.models.cliente import Cliente

    n = nombre or f"Cliente {uuid.uuid4().hex[:6]}"
    c = Cliente(negocio_id=negocio_id, nombre=n, nombre_normalizado=n.lower())
    session.add(c)
    session.flush()
    return c


def _fiado(session: Session, negocio_id, cliente_id, monto: Decimal, fecha=None):
    from app.models.venta import Venta
    from app.models.enums import FormaPago

    v = Venta(
        negocio_id=negocio_id, cliente_id=cliente_id, monto=monto,
        fecha=fecha or date.today(), forma_pago=FormaPago.CUENTA_CORRIENTE,
    )
    session.add(v)
    session.flush()
    return v


def _cobro(session: Session, negocio_id, cliente_id, monto: Decimal, fecha=None):
    from app.models.cobro_cliente import CobroCliente
    from app.models.enums import MetodoCobro

    c = CobroCliente(
        negocio_id=negocio_id, cliente_id=cliente_id, monto=monto,
        fecha=fecha or date.today(), metodo=MetodoCobro.EFECTIVO,
    )
    session.add(c)
    session.flush()
    return c


class TestListadoReportaSaldos:
    def test_saldo_con_movimientos_y_sin_ellos(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        con_deuda = _cliente(session, negocio.id, "Con Deuda")
        sin_movimientos = _cliente(session, negocio.id, "Sin Movimientos")
        _fiado(session, negocio.id, con_deuda.id, Decimal("1000.00"))
        _cobro(session, negocio.id, con_deuda.id, Decimal("300.00"))
        session.commit()

        svc = ClienteService(session)
        resultado = svc.listar(negocio.id)

        saldo_por_id = {c.id: c.saldo for c in resultado}
        assert saldo_por_id[con_deuda.id] == Decimal("700.00")
        assert saldo_por_id[sin_movimientos.id] == Decimal("0.00")


class TestUnaSolaQuery:
    def test_los_saldos_se_obtienen_sin_una_query_por_cliente(self, session: Session):
        """Task 9.2 — assert the query COUNT, not just the values."""
        from app.repositories.cliente_repository import ClienteRepository

        negocio = crear_negocio(session)
        for i in range(5):
            c = _cliente(session, negocio.id, f"Cliente {i}")
            _fiado(session, negocio.id, c.id, Decimal("100.00"))
            _cobro(session, negocio.id, c.id, Decimal("10.00"))
        session.commit()

        repo = ClienteRepository(session)

        queries: list[str] = []

        def _on_before_execute(conn, clauseelement, multiparams, params, execution_options):
            queries.append(str(clauseelement))

        event.listen(session.get_bind(), "before_execute", _on_before_execute)
        try:
            saldos = repo.get_saldo_por_cliente(negocio.id)
        finally:
            event.remove(session.get_bind(), "before_execute", _on_before_execute)

        # Filter to statements that actually touch `cliente` — SQLAlchemy may
        # emit its own bookkeeping (e.g. an implicit BEGIN) alongside the
        # real query, which is not what this test is about.
        saldo_queries = [q for q in queries if "FROM cliente" in q or "cliente." in q]
        assert len(saldo_queries) == 1, (
            f"esperaba 1 query tocando cliente, hubo {len(saldo_queries)}: {saldo_queries}"
        )
        assert len(saldos) == 5


class TestAislamientoEntreNegocios:
    def test_mismo_nombre_en_dos_negocios_no_mezcla_saldos(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_a = _cliente(session, negocio_a.id, "Mismo Nombre")
        cliente_b = _cliente(session, negocio_b.id, "Mismo Nombre")
        _fiado(session, negocio_a.id, cliente_a.id, Decimal("100.00"))
        _fiado(session, negocio_b.id, cliente_b.id, Decimal("9999.00"))
        session.commit()

        svc = ClienteService(session)
        resultado_a = svc.listar(negocio_a.id)

        saldo_por_id = {c.id: c.saldo for c in resultado_a}
        assert saldo_por_id[cliente_a.id] == Decimal("100.00")
        assert cliente_b.id not in saldo_por_id
