"""
Tests for the `CobroCliente` model (C-35). Task 4.1 / 4.2.

RN-CCC-03 is the invariant this file exists to pin: a payment attaches to the
customer, never to a sale — no `venta_id` column, no FK to `venta`. Same shape
as RN-PAG-01 for `Pago` (see tests/test_models_domain.py::test_pago_schema_has_no_factura_id).

D-01 also applies here: no `saldo`, no `estado` column — both are derived.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, create_engine

import app.models  # noqa: F401 — register all SQLModel tables

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


def _make_cliente(session: Session, negocio_id: uuid.UUID):
    from app.models.cliente import Cliente

    c = Cliente(
        negocio_id=negocio_id,
        nombre="Cliente Test",
        nombre_normalizado=f"cliente test {uuid.uuid4().hex[:6]}",
    )
    session.add(c)
    session.flush()
    return c


class TestPersistencia:
    def test_cobro_cliente_persiste_con_sus_campos(self, session: Session):
        from app.models.cobro_cliente import CobroCliente
        from app.models.enums import MetodoCobro

        negocio = crear_negocio(session)
        cliente = _make_cliente(session, negocio.id)

        cobro = CobroCliente(
            negocio_id=negocio.id,
            cliente_id=cliente.id,
            monto=Decimal("500.00"),
            fecha=date.today(),
            metodo=MetodoCobro.EFECTIVO,
            comprobante_url="https://example.com/comprobante.jpg",
        )
        session.add(cobro)
        session.flush()
        session.refresh(cobro)

        assert cobro.id is not None
        assert cobro.negocio_id == negocio.id
        assert cobro.cliente_id == cliente.id
        assert cobro.monto == Decimal("500.00")
        assert cobro.fecha == date.today()
        assert cobro.metodo == MetodoCobro.EFECTIVO
        assert cobro.comprobante_url == "https://example.com/comprobante.jpg"
        assert cobro.deleted_at is None

    def test_cliente_id_es_requerido(self, session: Session):
        """A payment with no cliente_id is money nobody can claim (RN-CCC-03
        mirrors the required proveedor_id on Pago)."""
        from app.models.cobro_cliente import CobroCliente
        from app.models.enums import MetodoCobro

        negocio = crear_negocio(session)
        session.flush()

        cobro = CobroCliente(
            negocio_id=negocio.id,
            cliente_id=None,
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo=MetodoCobro.EFECTIVO,
        )
        session.add(cobro)
        with pytest.raises(IntegrityError):
            session.flush()

    def test_comprobante_url_es_opcional(self, session: Session):
        from app.models.cobro_cliente import CobroCliente
        from app.models.enums import MetodoCobro

        negocio = crear_negocio(session)
        cliente = _make_cliente(session, negocio.id)

        cobro = CobroCliente(
            negocio_id=negocio.id,
            cliente_id=cliente.id,
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo=MetodoCobro.TRANSFERENCIA,
        )
        session.add(cobro)
        session.flush()
        session.refresh(cobro)
        assert cobro.comprobante_url is None

    def test_creado_por_usuario_id_es_opcional(self, session: Session):
        from app.models.cobro_cliente import CobroCliente
        from app.models.enums import MetodoCobro

        negocio = crear_negocio(session)
        cliente = _make_cliente(session, negocio.id)

        cobro = CobroCliente(
            negocio_id=negocio.id,
            cliente_id=cliente.id,
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo=MetodoCobro.OTRO,
            creado_por_usuario_id=None,
        )
        session.add(cobro)
        session.flush()
        session.refresh(cobro)
        assert cobro.creado_por_usuario_id is None


class TestNoVentaId:
    """RN-CCC-03 — the invariant this whole model exists to protect."""

    def test_modelo_no_tiene_columna_venta_id(self):
        from app.models.cobro_cliente import CobroCliente

        column_names = {c.name for c in CobroCliente.__table__.columns}
        assert "venta_id" not in column_names

    def test_modelo_no_tiene_fk_a_venta(self):
        from app.models.cobro_cliente import CobroCliente

        fk_tables = {fk.column.table.name for fk in CobroCliente.__table__.foreign_keys}
        assert "venta" not in fk_tables

    def test_no_hay_columna_saldo_ni_estado(self):
        """D-01: nothing derived is ever a column."""
        from app.models.cobro_cliente import CobroCliente

        column_names = {c.name for c in CobroCliente.__table__.columns}
        assert "saldo" not in column_names
        assert "estado" not in column_names
