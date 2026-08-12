"""
Tests for CobroCliente schemas (C-35). Task 8.1.

CRITICAL invariants (RN-CCC-03, D8):
- CobroClienteCreate/Update MUST NOT declare a venta_id field.
- CobroClienteUpdate MUST NOT declare a cliente_id field (D8 — immutable).
- extra="forbid" on both input schemas so a payload smuggling either is
  rejected, not silently ignored.
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.models.enums import MetodoCobro


class TestCobroClienteCreate:
    def test_valid_minimal(self):
        from app.schemas.cobro_cliente import CobroClienteCreate

        cc = CobroClienteCreate(
            cliente_id=uuid.uuid4(),
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo=MetodoCobro.EFECTIVO,
        )
        assert cc.monto == Decimal("100.00")
        assert cc.comprobante_url is None

    def test_monto_no_positivo_rechazado(self):
        from app.schemas.cobro_cliente import CobroClienteCreate

        with pytest.raises(ValidationError):
            CobroClienteCreate(
                cliente_id=uuid.uuid4(),
                monto=Decimal("0.00"),
                fecha=date.today(),
                metodo=MetodoCobro.EFECTIVO,
            )

    def test_venta_id_rechazado(self):
        from app.schemas.cobro_cliente import CobroClienteCreate

        with pytest.raises(ValidationError):
            CobroClienteCreate(
                cliente_id=uuid.uuid4(),
                venta_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoCobro.EFECTIVO,
            )

    def test_negocio_id_rechazado(self):
        from app.schemas.cobro_cliente import CobroClienteCreate

        with pytest.raises(ValidationError):
            CobroClienteCreate(
                cliente_id=uuid.uuid4(),
                negocio_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoCobro.EFECTIVO,
            )

    def test_creado_por_usuario_id_rechazado(self):
        from app.schemas.cobro_cliente import CobroClienteCreate

        with pytest.raises(ValidationError):
            CobroClienteCreate(
                cliente_id=uuid.uuid4(),
                creado_por_usuario_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoCobro.EFECTIVO,
            )


class TestCobroClienteUpdate:
    def test_valid_partial(self):
        from app.schemas.cobro_cliente import CobroClienteUpdate

        cu = CobroClienteUpdate(monto=Decimal("50.00"))
        assert cu.monto == Decimal("50.00")
        assert cu.fecha is None

    def test_cliente_id_rechazado(self):
        """D8 — the field this schema exists to omit."""
        from app.schemas.cobro_cliente import CobroClienteUpdate

        with pytest.raises(ValidationError):
            CobroClienteUpdate(cliente_id=uuid.uuid4())

    def test_venta_id_rechazado(self):
        from app.schemas.cobro_cliente import CobroClienteUpdate

        with pytest.raises(ValidationError):
            CobroClienteUpdate(venta_id=uuid.uuid4())

    def test_monto_no_positivo_rechazado_si_provisto(self):
        from app.schemas.cobro_cliente import CobroClienteUpdate

        with pytest.raises(ValidationError):
            CobroClienteUpdate(monto=Decimal("-1.00"))
