"""
Tests for `ClienteService.get_cuenta_corriente` — the on-demand triple for one
customer (C-35). Task 7.1-7.10.

Service-layer tests against real Postgres (testcontainers). Mirrors
tests/test_cuenta_corriente_service.py (the supplier equivalent) exactly in
structure — this is the mirror the whole change exists to build.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
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


def _cliente(session: Session, negocio_id: uuid.UUID, deleted: bool = False):
    from app.models.cliente import Cliente

    c = Cliente(
        negocio_id=negocio_id,
        nombre=f"Cliente {uuid.uuid4().hex[:6]}",
        nombre_normalizado=f"cliente {uuid.uuid4().hex[:8]}",
    )
    if deleted:
        c.deleted_at = datetime.now(timezone.utc)
    session.add(c)
    session.flush()
    return c


def _fiado(
    session: Session,
    negocio_id: uuid.UUID,
    cliente_id: uuid.UUID,
    monto: Decimal,
    fecha: date,
    deleted: bool = False,
):
    from app.models.venta import Venta
    from app.models.enums import FormaPago

    v = Venta(
        negocio_id=negocio_id,
        cliente_id=cliente_id,
        monto=monto,
        fecha=fecha,
        forma_pago=FormaPago.CUENTA_CORRIENTE,
    )
    if deleted:
        v.deleted_at = datetime.now(timezone.utc)
    session.add(v)
    session.flush()
    return v


def _venta_efectivo(session: Session, negocio_id: uuid.UUID, monto: Decimal, fecha: date):
    from app.models.venta import Venta
    from app.models.enums import FormaPago

    v = Venta(negocio_id=negocio_id, cliente_id=None, monto=monto, fecha=fecha, forma_pago=FormaPago.EFECTIVO)
    session.add(v)
    session.flush()
    return v


def _cobro(
    session: Session,
    negocio_id: uuid.UUID,
    cliente_id: uuid.UUID,
    monto: Decimal,
    fecha: date,
    deleted: bool = False,
    comprobante_url: str | None = None,
):
    from app.models.cobro_cliente import CobroCliente
    from app.models.enums import MetodoCobro

    c = CobroCliente(
        negocio_id=negocio_id,
        cliente_id=cliente_id,
        monto=monto,
        fecha=fecha,
        metodo=MetodoCobro.EFECTIVO,
        comprobante_url=comprobante_url,
    )
    if deleted:
        c.deleted_at = datetime.now(timezone.utc)
    session.add(c)
    session.flush()
    return c


class TestSaldoSobreDatosMixtos:
    def test_saldo_cuenta_solo_filas_vivas(self, session: Session):
        """RN-CCC-01: 3 fiados vivos, 1 fiado eliminado, 2 cobros vivos, 1 eliminado."""
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("100.00"), date(2026, 1, 1))
        _fiado(session, negocio.id, cliente.id, Decimal("200.00"), date(2026, 1, 2))
        _fiado(session, negocio.id, cliente.id, Decimal("300.00"), date(2026, 1, 3))
        _fiado(session, negocio.id, cliente.id, Decimal("9999.00"), date(2026, 1, 4), deleted=True)
        _cobro(session, negocio.id, cliente.id, Decimal("50.00"), date(2026, 1, 5))
        _cobro(session, negocio.id, cliente.id, Decimal("50.00"), date(2026, 1, 6))
        _cobro(session, negocio.id, cliente.id, Decimal("9999.00"), date(2026, 1, 7), deleted=True)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        assert result.saldo == Decimal("500.00")

    def test_ventas_al_contado_no_entran_en_el_saldo(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("100.00"), date.today())
        _venta_efectivo(session, negocio.id, Decimal("50000.00"), date.today())
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        assert result.saldo == Decimal("100.00")


class TestClienteSinMovimientos:
    def test_saldo_cero_y_listas_vacias(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        assert result.saldo == Decimal("0.00")
        assert result.ventas_con_estado == []
        assert result.historial == []


class TestFifoDeterministico:
    def test_500_500_500_pool_700(self, session: Session):
        """RN-CCC-02: 500+500+500, pool 700 -> COBRADA, PARCIAL, PENDIENTE."""
        from app.services.cliente_service import ClienteService
        from app.models.enums import EstadoVentaFiada

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        day1 = date.today() - timedelta(days=3)
        day2 = date.today() - timedelta(days=2)
        day3 = date.today() - timedelta(days=1)

        v1 = _fiado(session, negocio.id, cliente.id, Decimal("500.00"), day1)
        v2 = _fiado(session, negocio.id, cliente.id, Decimal("500.00"), day2)
        v3 = _fiado(session, negocio.id, cliente.id, Decimal("500.00"), day3)
        _cobro(session, negocio.id, cliente.id, Decimal("700.00"), day3)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        estado_por_id = {vc._venta.id: vc.estado for vc in result.ventas_con_estado}
        assert estado_por_id[v1.id] == EstadoVentaFiada.COBRADA
        assert estado_por_id[v2.id] == EstadoVentaFiada.PARCIAL
        assert estado_por_id[v3.id] == EstadoVentaFiada.PENDIENTE

    def test_misma_fecha_desempata_por_created_at_luego_id(self, session: Session):
        from app.services.cliente_service import ClienteService
        from app.models.enums import EstadoVentaFiada

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        same_day = date.today()

        v1 = _fiado(session, negocio.id, cliente.id, Decimal("100.00"), same_day)
        v2 = _fiado(session, negocio.id, cliente.id, Decimal("100.00"), same_day)
        _cobro(session, negocio.id, cliente.id, Decimal("100.00"), same_day)
        session.commit()

        svc = ClienteService(session)
        r1 = svc.get_cuenta_corriente(negocio.id, cliente.id)
        r2 = svc.get_cuenta_corriente(negocio.id, cliente.id)

        estado_1 = {vc._venta.id: vc.estado for vc in r1.ventas_con_estado}
        estado_2 = {vc._venta.id: vc.estado for vc in r2.ventas_con_estado}
        assert estado_1 == estado_2
        # v1 was created first (earlier created_at via UUIDv7 ordering) -> settled first
        assert estado_1[v1.id] == EstadoVentaFiada.COBRADA
        assert estado_1[v2.id] == EstadoVentaFiada.PENDIENTE

    def test_pago_de_marzo_salda_fiado_de_enero(self, session: Session):
        """RN-FIFO-02: allocation by pool amount, not by date."""
        from app.services.cliente_service import ClienteService
        from app.models.enums import EstadoVentaFiada

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        enero = date(2026, 1, 10)
        marzo = date(2026, 3, 10)

        v_enero = _fiado(session, negocio.id, cliente.id, Decimal("100.00"), enero)
        _cobro(session, negocio.id, cliente.id, Decimal("100.00"), marzo)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        estado_por_id = {vc._venta.id: vc.estado for vc in result.ventas_con_estado}
        assert estado_por_id[v_enero.id] == EstadoVentaFiada.COBRADA

    def test_un_pago_cambia_dos_estados_a_la_vez(self, session: Session):
        """RN-FIFO-03: one payment covering the first two of three fiados."""
        from app.services.cliente_service import ClienteService
        from app.models.enums import EstadoVentaFiada

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        day1 = date.today() - timedelta(days=2)
        day2 = date.today() - timedelta(days=1)
        day3 = date.today()

        v1 = _fiado(session, negocio.id, cliente.id, Decimal("300.00"), day1)
        v2 = _fiado(session, negocio.id, cliente.id, Decimal("300.00"), day2)
        v3 = _fiado(session, negocio.id, cliente.id, Decimal("300.00"), day3)
        _cobro(session, negocio.id, cliente.id, Decimal("600.00"), day3)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        estado_por_id = {vc._venta.id: vc.estado for vc in result.ventas_con_estado}
        assert estado_por_id[v1.id] == EstadoVentaFiada.COBRADA
        assert estado_por_id[v2.id] == EstadoVentaFiada.COBRADA
        assert estado_por_id[v3.id] == EstadoVentaFiada.PENDIENTE


class TestHistorial:
    def test_running_balance_fiado_cobro_fiado(self, session: Session):
        """RN-CCC-05: 1000 fiado, 400 cobro, 500 fiado -> 1000, 600, 1100."""
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        day1 = date(2026, 1, 1)
        day2 = date(2026, 1, 2)
        day3 = date(2026, 1, 3)

        _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), day1)
        _cobro(session, negocio.id, cliente.id, Decimal("400.00"), day2)
        _fiado(session, negocio.id, cliente.id, Decimal("500.00"), day3)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        assert [h["saldo_acumulado"] for h in result.historial] == [
            Decimal("1000.00"),
            Decimal("600.00"),
            Decimal("1100.00"),
        ]
        assert [h["tipo"] for h in result.historial] == ["VENTA", "COBRO", "VENTA"]

    def test_montos_siempre_positivos(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("500.00"), date(2026, 1, 1))
        _cobro(session, negocio.id, cliente.id, Decimal("200.00"), date(2026, 1, 2))
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        assert all(h["monto"] > 0 for h in result.historial)

    def test_deleted_rows_dont_appear(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("500.00"), date(2026, 1, 1))
        v_deleted = _fiado(session, negocio.id, cliente.id, Decimal("999.00"), date(2026, 1, 2), deleted=True)
        c_deleted = _cobro(session, negocio.id, cliente.id, Decimal("999.00"), date(2026, 1, 3), deleted=True)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        ids = {h["id"] for h in result.historial}
        assert v_deleted.id not in ids
        assert c_deleted.id not in ids

    def test_comprobante_url_llega_como_archivo_url(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        _fiado(session, negocio.id, cliente.id, Decimal("500.00"), date(2026, 1, 1))
        cobro = _cobro(
            session, negocio.id, cliente.id, Decimal("200.00"), date(2026, 1, 2),
            comprobante_url="https://example.com/recibo.jpg",
        )
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        by_id = {h["id"]: h for h in result.historial}
        assert by_id[cobro.id]["archivo_url"] == "https://example.com/recibo.jpg"
        # A VENTA row has no attachment today.
        venta_rows = [h for h in result.historial if h["tipo"] == "VENTA"]
        assert venta_rows[0]["archivo_url"] is None


class TestD4SaldoHonesto:
    def test_fiado_pagado_y_luego_eliminado_deja_saldo_negativo(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id)
        fiado = _fiado(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        _cobro(session, negocio.id, cliente.id, Decimal("1000.00"), date.today())
        session.flush()
        fiado.deleted_at = datetime.now(timezone.utc)
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio.id, cliente.id)

        assert result.saldo == Decimal("-1000.00")


class TestAislamiento:
    def test_cliente_de_otro_negocio_404(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_b = _cliente(session, negocio_b.id)
        _fiado(session, negocio_b.id, cliente_b.id, Decimal("100.00"), date.today())
        _cobro(session, negocio_b.id, cliente_b.id, Decimal("50.00"), date.today())
        session.commit()

        svc = ClienteService(session)
        with pytest.raises(HTTPException) as exc:
            svc.get_cuenta_corriente(negocio_a.id, cliente_b.id)
        assert exc.value.status_code == 404

    def test_cliente_mismo_nombre_en_otro_negocio_no_contamina(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio_a = crear_negocio(session)
        negocio_b = crear_negocio(session)
        cliente_a = _cliente(session, negocio_a.id)
        cliente_b = _cliente(session, negocio_b.id)
        _fiado(session, negocio_b.id, cliente_b.id, Decimal("9999.00"), date.today())
        session.commit()

        svc = ClienteService(session)
        result = svc.get_cuenta_corriente(negocio_a.id, cliente_a.id)
        assert result.saldo == Decimal("0.00")

    def test_soft_deleted_cliente_404(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        cliente = _cliente(session, negocio.id, deleted=True)
        session.commit()

        svc = ClienteService(session)
        with pytest.raises(HTTPException) as exc:
            svc.get_cuenta_corriente(negocio.id, cliente.id)
        assert exc.value.status_code == 404

    def test_cliente_inexistente_404(self, session: Session):
        from app.services.cliente_service import ClienteService

        negocio = crear_negocio(session)
        session.commit()

        svc = ClienteService(session)
        with pytest.raises(HTTPException) as exc:
            svc.get_cuenta_corriente(negocio.id, uuid.uuid4())
        assert exc.value.status_code == 404
