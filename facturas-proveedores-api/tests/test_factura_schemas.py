"""
Tests for Factura schemas (Task 1.2 — TDD RED, then GREEN).

Covers:
- FacturaItemCreate: cantidad > 0, precio_unitario >= 0
- FacturaCreate: monto_total > 0, proveedor_id required, items optional
- FacturaUpdate: all fields optional, same validators apply
- FacturaResponse: from_attributes, includes estado and items
- FacturaListItem: lean row with estado
"""

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.models.enums import EstadoFactura, OrigenDocumento


# ── FacturaItemCreate ──────────────────────────────────────────────────────────


class TestFacturaItemCreate:
    def test_valid_item(self):
        from app.schemas.factura import FacturaItemCreate

        item = FacturaItemCreate(
            descripcion="Producto A",
            cantidad=Decimal("2"),
            precio_unitario=Decimal("100.00"),
        )
        assert item.descripcion == "Producto A"
        assert item.cantidad == Decimal("2")
        assert item.precio_unitario == Decimal("100.00")

    def test_cantidad_must_be_positive(self):
        from app.schemas.factura import FacturaItemCreate

        with pytest.raises(ValidationError) as exc_info:
            FacturaItemCreate(
                descripcion="Test",
                cantidad=Decimal("0"),
                precio_unitario=Decimal("10.00"),
            )
        assert "cantidad" in str(exc_info.value).lower()

    def test_cantidad_negative_rejected(self):
        from app.schemas.factura import FacturaItemCreate

        with pytest.raises(ValidationError):
            FacturaItemCreate(
                descripcion="Test",
                cantidad=Decimal("-1"),
                precio_unitario=Decimal("10.00"),
            )

    def test_precio_unitario_zero_accepted(self):
        """precio_unitario=0 is valid (free item, e.g. promotional)."""
        from app.schemas.factura import FacturaItemCreate

        item = FacturaItemCreate(
            descripcion="Promo",
            cantidad=Decimal("1"),
            precio_unitario=Decimal("0.00"),
        )
        assert item.precio_unitario == Decimal("0.00")

    def test_precio_unitario_negative_rejected(self):
        from app.schemas.factura import FacturaItemCreate

        with pytest.raises(ValidationError):
            FacturaItemCreate(
                descripcion="Test",
                cantidad=Decimal("1"),
                precio_unitario=Decimal("-5.00"),
            )

    def test_descripcion_must_not_be_empty(self):
        from app.schemas.factura import FacturaItemCreate

        with pytest.raises(ValidationError):
            FacturaItemCreate(
                descripcion="",
                cantidad=Decimal("1"),
                precio_unitario=Decimal("10.00"),
            )


# ── FacturaCreate ──────────────────────────────────────────────────────────────


class TestFacturaCreate:
    def test_valid_minimal(self):
        from app.schemas.factura import FacturaCreate

        proveedor_id = uuid.uuid4()
        fc = FacturaCreate(
            proveedor_id=proveedor_id,
            fecha_emision=date.today(),
            monto_total=Decimal("500.00"),
        )
        assert fc.proveedor_id == proveedor_id
        assert fc.monto_total == Decimal("500.00")
        assert fc.items == []
        assert fc.numero is None
        assert fc.fecha_vencimiento is None
        assert fc.archivo_url is None

    def test_monto_total_zero_rejected(self):
        from app.schemas.factura import FacturaCreate

        with pytest.raises(ValidationError) as exc_info:
            FacturaCreate(
                proveedor_id=uuid.uuid4(),
                fecha_emision=date.today(),
                monto_total=Decimal("0.00"),
            )
        assert "monto_total" in str(exc_info.value).lower()

    def test_monto_total_negative_rejected(self):
        from app.schemas.factura import FacturaCreate

        with pytest.raises(ValidationError):
            FacturaCreate(
                proveedor_id=uuid.uuid4(),
                fecha_emision=date.today(),
                monto_total=Decimal("-100.00"),
            )

    def test_fecha_emision_future_rejected(self):
        from app.schemas.factura import FacturaCreate

        with pytest.raises(ValidationError) as exc_info:
            FacturaCreate(
                proveedor_id=uuid.uuid4(),
                fecha_emision=date.today() + timedelta(days=1),
                monto_total=Decimal("100.00"),
            )
        assert "fecha_emision" in str(exc_info.value).lower()

    def test_fecha_emision_today_accepted(self):
        from app.schemas.factura import FacturaCreate

        fc = FacturaCreate(
            proveedor_id=uuid.uuid4(),
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
        )
        assert fc.fecha_emision == date.today()

    def test_with_items(self):
        from app.schemas.factura import FacturaCreate, FacturaItemCreate

        fc = FacturaCreate(
            proveedor_id=uuid.uuid4(),
            fecha_emision=date.today(),
            monto_total=Decimal("200.00"),
            items=[
                FacturaItemCreate(
                    descripcion="Item 1",
                    cantidad=Decimal("2"),
                    precio_unitario=Decimal("100.00"),
                )
            ],
        )
        assert len(fc.items) == 1
        assert fc.items[0].descripcion == "Item 1"

    def test_proveedor_id_required(self):
        from app.schemas.factura import FacturaCreate

        with pytest.raises(ValidationError):
            FacturaCreate(
                fecha_emision=date.today(),
                monto_total=Decimal("100.00"),
            )

    # ── c-15a-origen-ia-backend: optional `origen` field ──────────────────────

    def test_origen_ia_accepted(self):
        """c-15a: FacturaCreate accepts `origen='IA'` (C-15 IA confirmation path)."""
        from app.schemas.factura import FacturaCreate

        fc = FacturaCreate(
            proveedor_id=uuid.uuid4(),
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
            origen=OrigenDocumento.IA,
        )
        assert fc.origen == OrigenDocumento.IA

    def test_origen_omitted_defaults_to_none(self):
        """c-15a: `origen` omitted on the schema → None (service stamps MANUAL)."""
        from app.schemas.factura import FacturaCreate

        fc = FacturaCreate(
            proveedor_id=uuid.uuid4(),
            fecha_emision=date.today(),
            monto_total=Decimal("100.00"),
        )
        assert fc.origen is None

    def test_origen_invalid_rejected(self):
        """c-15a: Pydantic enum validation rejects non-OrigenDocumento values (422)."""
        from app.schemas.factura import FacturaCreate

        with pytest.raises(ValidationError) as exc_info:
            FacturaCreate(
                proveedor_id=uuid.uuid4(),
                fecha_emision=date.today(),
                monto_total=Decimal("100.00"),
                origen="INVALID",
            )
        assert "origen" in str(exc_info.value).lower()


# ── FacturaUpdate ──────────────────────────────────────────────────────────────


class TestFacturaUpdate:
    def test_all_fields_optional(self):
        from app.schemas.factura import FacturaUpdate

        fu = FacturaUpdate()
        assert fu.monto_total is None
        assert fu.numero is None
        assert fu.fecha_emision is None

    def test_monto_total_zero_rejected_in_update(self):
        from app.schemas.factura import FacturaUpdate

        with pytest.raises(ValidationError):
            FacturaUpdate(monto_total=Decimal("0.00"))

    def test_fecha_emision_future_rejected_in_update(self):
        from app.schemas.factura import FacturaUpdate

        with pytest.raises(ValidationError):
            FacturaUpdate(fecha_emision=date.today() + timedelta(days=1))


# ── FacturaResponse ────────────────────────────────────────────────────────────


class TestFacturaResponse:
    def test_from_attributes_with_estado(self):
        from app.schemas.factura import FacturaResponse

        # FacturaResponse must accept a dict/object with estado field
        from datetime import datetime, timezone

        response = FacturaResponse(
            id=uuid.uuid4(),
            negocio_id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            numero="F-001",
            fecha_emision=date.today(),
            fecha_vencimiento=None,
            monto_total=Decimal("500.00"),
            archivo_url=None,
            origen=OrigenDocumento.MANUAL,
            estado=EstadoFactura.PENDIENTE,
            items=[],
            items_sum_mismatch=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        assert response.estado == EstadoFactura.PENDIENTE
        assert response.items == []
        assert response.items_sum_mismatch is False

    def test_estado_pagada(self):
        from app.schemas.factura import FacturaResponse
        from datetime import datetime, timezone

        response = FacturaResponse(
            id=uuid.uuid4(),
            negocio_id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            numero=None,
            fecha_emision=date.today(),
            fecha_vencimiento=None,
            monto_total=Decimal("100.00"),
            archivo_url=None,
            origen=OrigenDocumento.MANUAL,
            estado=EstadoFactura.PAGADA,
            items=[],
            items_sum_mismatch=False,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc),
        )
        assert response.estado == EstadoFactura.PAGADA


# ── FacturaListItem ────────────────────────────────────────────────────────────


class TestFacturaListItem:
    def test_lean_response(self):
        from app.schemas.factura import FacturaListItem

        item = FacturaListItem(
            id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            numero="F-001",
            fecha_emision=date.today(),
            monto_total=Decimal("300.00"),
            estado=EstadoFactura.PARCIAL,
        )
        assert item.estado == EstadoFactura.PARCIAL
        assert item.monto_total == Decimal("300.00")
