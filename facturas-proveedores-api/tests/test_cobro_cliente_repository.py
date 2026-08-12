"""
Tests for `CobroClienteRepository` — pure data access, no authorization, no
business rules (C-35). Task 5.1-5.4.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import pytest
from sqlmodel import Session, SQLModel, create_engine

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


def _cliente(session: Session, negocio_id: uuid.UUID):
    from app.models.cliente import Cliente

    c = Cliente(
        negocio_id=negocio_id,
        nombre="Cliente Test",
        nombre_normalizado=f"cliente {uuid.uuid4().hex[:8]}",
    )
    session.add(c)
    session.flush()
    return c


def _cobro(
    session: Session,
    negocio_id: uuid.UUID,
    cliente_id: uuid.UUID,
    monto: Decimal,
    fecha: date,
    deleted: bool = False,
):
    from app.models.cobro_cliente import CobroCliente
    from app.models.enums import MetodoCobro

    cobro = CobroCliente(
        negocio_id=negocio_id,
        cliente_id=cliente_id,
        monto=monto,
        fecha=fecha,
        metodo=MetodoCobro.EFECTIVO,
    )
    if deleted:
        cobro.deleted_at = datetime.now(timezone.utc)
    session.add(cobro)
    session.flush()
    return cobro


class TestListarDeCliente:
    def test_devuelve_solo_los_cobros_vivos_del_cliente_ordenados(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        c1 = _cobro(session, negocio.id, cliente.id, Decimal("100.00"), date(2026, 1, 1))
        c2 = _cobro(session, negocio.id, cliente.id, Decimal("200.00"), date(2026, 1, 5))
        session.commit()

        repo = CobroClienteRepository(session)
        resultado = repo.listar_de_cliente(negocio.id, cliente.id)

        assert [c.id for c in resultado] == [c1.id, c2.id]

    def test_excluye_cobros_eliminados(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        activo = _cobro(session, negocio.id, cliente.id, Decimal("100.00"), date(2026, 1, 1))
        _cobro(session, negocio.id, cliente.id, Decimal("999.00"), date(2026, 1, 2), deleted=True)
        session.commit()

        repo = CobroClienteRepository(session)
        resultado = repo.listar_de_cliente(negocio.id, cliente.id)

        assert [c.id for c in resultado] == [activo.id]

    def test_excluye_cobros_de_otro_negocio(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_a = _cliente(session, negocio_a.id)
        cliente_b = _cliente(session, negocio_b.id)
        _cobro(session, negocio_b.id, cliente_b.id, Decimal("500.00"), date(2026, 1, 1))
        session.commit()

        repo = CobroClienteRepository(session)
        resultado = repo.listar_de_cliente(negocio_a.id, cliente_a.id)

        assert resultado == []


class TestSumarCobrosDeCliente:
    def test_suma_solo_los_vivos(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _cobro(session, negocio.id, cliente.id, Decimal("100.00"), date(2026, 1, 1))
        _cobro(session, negocio.id, cliente.id, Decimal("50.00"), date(2026, 1, 2))
        _cobro(session, negocio.id, cliente.id, Decimal("999.00"), date(2026, 1, 3), deleted=True)
        session.commit()

        repo = CobroClienteRepository(session)
        total = repo.sumar_cobros_de_cliente(negocio.id, cliente.id)

        assert total == Decimal("150.00")

    def test_devuelve_cero_no_none_sin_cobros(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        session.commit()

        repo = CobroClienteRepository(session)
        total = repo.sumar_cobros_de_cliente(negocio.id, cliente.id)

        assert total == Decimal("0.00")
        assert total is not None


class TestListar:
    def test_orden_mas_reciente_primero(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _cobro(session, negocio.id, cliente.id, Decimal("100.00"), date(2026, 1, 1))
        mas_reciente = _cobro(session, negocio.id, cliente.id, Decimal("200.00"), date(2026, 1, 10))
        session.commit()

        repo = CobroClienteRepository(session)
        items, total = repo.listar(negocio.id)

        assert total == 2
        assert items[0].id == mas_reciente.id

    def test_filtro_opcional_por_cliente(self, session: Session):
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio = crear_negocio(session)
        cliente_1 = _cliente(session, negocio.id)
        cliente_2 = _cliente(session, negocio.id)
        c1 = _cobro(session, negocio.id, cliente_1.id, Decimal("100.00"), date(2026, 1, 1))
        _cobro(session, negocio.id, cliente_2.id, Decimal("200.00"), date(2026, 1, 2))
        session.commit()

        repo = CobroClienteRepository(session)
        items, total = repo.listar(negocio.id, cliente_id=cliente_1.id)

        assert total == 1
        assert items[0].id == c1.id

    def test_listar_sin_filtro_de_cliente_no_mezcla_otro_negocio(self, session: Session):
        """
        Unlike `listar_de_cliente` (where `cliente_id` already disambiguates
        by negocio via its FK, making the `negocio_id` filter there
        structurally redundant), the bare `listar()` — no `cliente_id`
        filter — has `negocio_id` as its ONLY scoping filter. This is the
        query where a missing `negocio_id` filter is an actual, observable
        cross-tenant leak (task 10.5's real target).
        """
        from app.repositories.cobro_cliente_repository import CobroClienteRepository

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_a = _cliente(session, negocio_a.id)
        cliente_b = _cliente(session, negocio_b.id)
        _cobro(session, negocio_a.id, cliente_a.id, Decimal("100.00"), date(2026, 1, 1))
        _cobro(session, negocio_b.id, cliente_b.id, Decimal("999.00"), date(2026, 1, 2))
        session.commit()

        repo = CobroClienteRepository(session)
        items, total = repo.listar(negocio_a.id)

        assert total == 1
        assert all(item.negocio_id == negocio_a.id for item in items)
