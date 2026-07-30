"""
Tests for cuenta-corriente Pydantic schemas (Task 1.1 — TDD RED, then GREEN).

Unit tests, no DB. Validate the three response schemas:
- FacturaConEstado: mirrors FacturaResponse minus items/items_sum_mismatch, plus estado
- EntradaHistorial: id, tipo (FACTURA|PAGO), fecha, monto (positive), saldo_acumulado (signed)
- CuentaCorrienteResponse: proveedor_id, saldo, facturas_con_estado, historial

Hard rules:
- from_attributes=True on all three (service-layer data classes must validate).
- EntradaHistorial.monto MUST be > 0 (Pydantic Field constraint).
- tipo MUST be Literal["FACTURA", "PAGO"].
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

import pytest
from pydantic import ValidationError


# ── Helpers ───────────────────────────────────────────────────────────────────


def _make_factura_obj(
    id: Optional[uuid.UUID] = None,
    fecha_emision: Optional[date] = None,
    monto_total: Optional[Decimal] = None,
) -> Any:
    """Build a service-layer data object that mimics FacturaConEstado (no items needed)."""
    from app.models.factura import Factura
    from app.models.enums import EstadoFactura, OrigenDocumento

    f = Factura(
        id=id or uuid.uuid4(),
        usuario_id=uuid.uuid4(),
        proveedor_id=uuid.uuid4(),
        fecha_emision=fecha_emision or date(2026, 6, 15),
        monto_total=monto_total or Decimal("1500.00"),
        origen=OrigenDocumento.MANUAL,
    )
    f.created_at = datetime(2026, 6, 15, 10, 30, 0)
    f.updated_at = datetime(2026, 6, 15, 10, 30, 0)
    return f


# ── FacturaConEstado ──────────────────────────────────────────────────────────


class TestFacturaConEstado:
    def test_validates_with_estado_pendiente(self):
        from app.schemas.cuenta_corriente import FacturaConEstado
        from app.models.enums import EstadoFactura

        f = _make_factura_obj()
        obj = FacturaConEstado.model_validate(
            {
                "id": f.id,
                "usuario_id": f.usuario_id,
                "proveedor_id": f.proveedor_id,
                "fecha_emision": f.fecha_emision,
                "monto_total": f.monto_total,
                "origen": f.origen,
                "estado": EstadoFactura.PENDIENTE,
                "created_at": f.created_at,
                "updated_at": f.updated_at,
            }
        )
        assert obj.estado == EstadoFactura.PENDIENTE
        assert obj.monto_total == Decimal("1500.00")

    def test_accepts_all_three_estados(self):
        from app.schemas.cuenta_corriente import FacturaConEstado
        from app.models.enums import EstadoFactura

        for est in (
            EstadoFactura.PENDIENTE,
            EstadoFactura.PARCIAL,
            EstadoFactura.PAGADA,
        ):
            f = _make_factura_obj()
            obj = FacturaConEstado.model_validate(
                {
                    "id": f.id,
                    "usuario_id": f.usuario_id,
                    "proveedor_id": f.proveedor_id,
                    "fecha_emision": f.fecha_emision,
                    "monto_total": f.monto_total,
                    "origen": f.origen,
                    "estado": est,
                    "created_at": f.created_at,
                    "updated_at": f.updated_at,
                }
            )
            assert obj.estado == est

    def test_has_no_items_field(self):
        """Cuenta-corriente view does NOT need line items — must be omitted."""
        from app.schemas.cuenta_corriente import FacturaConEstado

        assert "items" not in FacturaConEstado.model_fields
        assert "items_sum_mismatch" not in FacturaConEstado.model_fields

    def test_has_required_fields(self):
        from app.schemas.cuenta_corriente import FacturaConEstado

        required = {
            "id", "usuario_id", "proveedor_id", "fecha_emision", "monto_total",
            "origen", "estado", "created_at", "updated_at",
        }
        assert required.issubset(set(FacturaConEstado.model_fields.keys()))

    def test_optional_fields_accept_none(self):
        """fecha_vencimiento and archivo_url are optional in the cuenta-corriente view."""
        from app.schemas.cuenta_corriente import FacturaConEstado
        from app.models.enums import EstadoFactura

        f = _make_factura_obj()
        obj = FacturaConEstado.model_validate(
            {
                "id": f.id,
                "usuario_id": f.usuario_id,
                "proveedor_id": f.proveedor_id,
                "fecha_emision": f.fecha_emision,
                "monto_total": f.monto_total,
                "origen": f.origen,
                "estado": EstadoFactura.PAGADA,
                "created_at": f.created_at,
                "updated_at": f.updated_at,
                "fecha_vencimiento": None,
                "archivo_url": None,
            }
        )
        assert obj.fecha_vencimiento is None
        assert obj.archivo_url is None

    def test_from_attributes_true(self):
        from app.schemas.cuenta_corriente import FacturaConEstado

        assert FacturaConEstado.model_config.get("from_attributes") is True


# ── EntradaHistorial ──────────────────────────────────────────────────────────


class TestEntradaHistorial:
    def test_validates_factura_entry(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        obj = EntradaHistorial.model_validate(
            {
                "id": uuid.uuid4(),
                "tipo": "FACTURA",
                "fecha": date(2026, 6, 15),
                "monto": Decimal("1500.00"),
                "saldo_acumulado": Decimal("1500.00"),
            }
        )
        assert obj.tipo == "FACTURA"
        assert obj.monto == Decimal("1500.00")

    def test_validates_pago_entry(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        obj = EntradaHistorial.model_validate(
            {
                "id": uuid.uuid4(),
                "tipo": "PAGO",
                "fecha": date(2026, 6, 20),
                "monto": Decimal("300.00"),
                "saldo_acumulado": Decimal("-300.00"),
            }
        )
        assert obj.tipo == "PAGO"
        assert obj.saldo_acumulado == Decimal("-300.00")

    def test_rejects_tipo_outside_literal_set(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        with pytest.raises(ValidationError):
            EntradaHistorial.model_validate(
                {
                    "id": uuid.uuid4(),
                    "tipo": "OTRO",
                    "fecha": date(2026, 6, 15),
                    "monto": Decimal("100.00"),
                    "saldo_acumulado": Decimal("100.00"),
                }
            )

    def test_rejects_negative_monto(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        with pytest.raises(ValidationError):
            EntradaHistorial.model_validate(
                {
                    "id": uuid.uuid4(),
                    "tipo": "FACTURA",
                    "fecha": date(2026, 6, 15),
                    "monto": Decimal("-1.00"),
                    "saldo_acumulado": Decimal("-1.00"),
                }
            )

    def test_rejects_zero_monto(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        with pytest.raises(ValidationError):
            EntradaHistorial.model_validate(
                {
                    "id": uuid.uuid4(),
                    "tipo": "PAGO",
                    "fecha": date(2026, 6, 15),
                    "monto": Decimal("0"),
                    "saldo_acumulado": Decimal("0"),
                }
            )

    def test_saldo_acumulado_accepts_positive_zero_negative(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        for value in (Decimal("1500.00"), Decimal("0"), Decimal("-500.00")):
            obj = EntradaHistorial.model_validate(
                {
                    "id": uuid.uuid4(),
                    "tipo": "FACTURA",
                    "fecha": date(2026, 6, 15),
                    "monto": Decimal("100.00"),
                    "saldo_acumulado": value,
                }
            )
            assert obj.saldo_acumulado == value

    def test_from_attributes_true(self):
        from app.schemas.cuenta_corriente import EntradaHistorial

        assert EntradaHistorial.model_config.get("from_attributes") is True

    def test_archivo_url_defaults_to_none_when_omitted(self):
        """C-24: EntradaHistorial gains an optional archivo_url, default None."""
        from app.schemas.cuenta_corriente import EntradaHistorial

        obj = EntradaHistorial.model_validate(
            {
                "id": uuid.uuid4(),
                "tipo": "FACTURA",
                "fecha": date(2026, 6, 15),
                "monto": Decimal("1500.00"),
                "saldo_acumulado": Decimal("1500.00"),
            }
        )
        assert obj.archivo_url is None

    def test_archivo_url_accepts_a_string(self):
        """C-24: EntradaHistorial.archivo_url accepts a Cloudinary URL string."""
        from app.schemas.cuenta_corriente import EntradaHistorial

        obj = EntradaHistorial.model_validate(
            {
                "id": uuid.uuid4(),
                "tipo": "PAGO",
                "fecha": date(2026, 6, 20),
                "monto": Decimal("300.00"),
                "saldo_acumulado": Decimal("-300.00"),
                "archivo_url": "https://res.cloudinary.com/demo/comprobantes/y.jpg",
            }
        )
        assert obj.archivo_url == "https://res.cloudinary.com/demo/comprobantes/y.jpg"

    def test_archivo_url_accepts_explicit_none(self):
        """C-24 triangulate: archivo_url=None explicitly passed is accepted (not just omitted)."""
        from app.schemas.cuenta_corriente import EntradaHistorial

        obj = EntradaHistorial.model_validate(
            {
                "id": uuid.uuid4(),
                "tipo": "FACTURA",
                "fecha": date(2026, 6, 15),
                "monto": Decimal("100.00"),
                "saldo_acumulado": Decimal("100.00"),
                "archivo_url": None,
            }
        )
        assert obj.archivo_url is None


# ── CuentaCorrienteResponse ───────────────────────────────────────────────────


class TestCuentaCorrienteResponse:
    def test_validates_full_payload(self):
        from app.schemas.cuenta_corriente import (
            CuentaCorrienteResponse,
            FacturaConEstado,
            EntradaHistorial,
        )
        from app.models.enums import EstadoFactura, OrigenDocumento

        proveedor_id = uuid.uuid4()
        f_id = uuid.uuid4()

        payload = {
            "proveedor_id": proveedor_id,
            "saldo": Decimal("1500.00"),
            "facturas_con_estado": [
                {
                    "id": f_id,
                    "usuario_id": uuid.uuid4(),
                    "proveedor_id": proveedor_id,
                    "fecha_emision": date(2026, 6, 15),
                    "monto_total": Decimal("1500.00"),
                    "origen": OrigenDocumento.MANUAL,
                    "estado": EstadoFactura.PENDIENTE,
                    "created_at": datetime(2026, 6, 15, 10, 30, 0),
                    "updated_at": datetime(2026, 6, 15, 10, 30, 0),
                }
            ],
            "historial": [
                {
                    "id": f_id,
                    "tipo": "FACTURA",
                    "fecha": date(2026, 6, 15),
                    "monto": Decimal("1500.00"),
                    "saldo_acumulado": Decimal("1500.00"),
                },
                {
                    "id": uuid.uuid4(),
                    "tipo": "PAGO",
                    "fecha": date(2026, 6, 20),
                    "monto": Decimal("300.00"),
                    "saldo_acumulado": Decimal("1200.00"),
                },
            ],
        }

        obj = CuentaCorrienteResponse.model_validate(payload)
        assert obj.proveedor_id == proveedor_id
        assert obj.saldo == Decimal("1500.00")
        assert len(obj.facturas_con_estado) == 1
        assert obj.facturas_con_estado[0].estado == EstadoFactura.PENDIENTE
        assert len(obj.historial) == 2
        assert obj.historial[0].tipo == "FACTURA"
        assert obj.historial[1].tipo == "PAGO"

    def test_validates_empty_payload(self):
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        obj = CuentaCorrienteResponse.model_validate(
            {
                "proveedor_id": uuid.uuid4(),
                "saldo": Decimal("0.00"),
                "facturas_con_estado": [],
                "historial": [],
            }
        )
        assert obj.saldo == Decimal("0.00")
        assert obj.facturas_con_estado == []
        assert obj.historial == []

    def test_has_required_fields(self):
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        required = {"proveedor_id", "saldo", "facturas_con_estado", "historial"}
        assert required.issubset(set(CuentaCorrienteResponse.model_fields.keys()))

    def test_from_attributes_true(self):
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        assert CuentaCorrienteResponse.model_config.get("from_attributes") is True

    def test_saldo_accepts_negative(self):
        """Pool excedido: saldo < 0 (a favor del cliente)."""
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        obj = CuentaCorrienteResponse.model_validate(
            {
                "proveedor_id": uuid.uuid4(),
                "saldo": Decimal("-500.00"),
                "facturas_con_estado": [],
                "historial": [],
            }
        )
        assert obj.saldo == Decimal("-500.00")


# ── Triangulate: boundary values ─────────────────────────────────────────────


class TestBoundaryValues:
    def test_saldo_zero(self):
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        obj = CuentaCorrienteResponse.model_validate(
            {
                "proveedor_id": uuid.uuid4(),
                "saldo": Decimal("0.00"),
                "facturas_con_estado": [],
                "historial": [],
            }
        )
        assert obj.saldo == Decimal("0.00")

    def test_saldo_positive_small(self):
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        obj = CuentaCorrienteResponse.model_validate(
            {
                "proveedor_id": uuid.uuid4(),
                "saldo": Decimal("0.01"),
                "facturas_con_estado": [],
                "historial": [],
            }
        )
        assert obj.saldo == Decimal("0.01")

    def test_saldo_negative_small(self):
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        obj = CuentaCorrienteResponse.model_validate(
            {
                "proveedor_id": uuid.uuid4(),
                "saldo": Decimal("-0.01"),
                "facturas_con_estado": [],
                "historial": [],
            }
        )
        assert obj.saldo == Decimal("-0.01")

    def test_saldo_large_amount(self):
        """numeric(12,2) cap = 9_999_999_999.99. Test an amount well under the cap."""
        from app.schemas.cuenta_corriente import CuentaCorrienteResponse

        obj = CuentaCorrienteResponse.model_validate(
            {
                "proveedor_id": uuid.uuid4(),
                "saldo": Decimal("99999999.99"),
                "facturas_con_estado": [],
                "historial": [],
            }
        )
        assert obj.saldo == Decimal("99999999.99")

    def test_factura_con_estado_optional_fields(self):
        """fecha_vencimiento and archivo_url are optional in cuenta-corriente."""
        from app.schemas.cuenta_corriente import FacturaConEstado
        from app.models.enums import EstadoFactura

        # Build with explicit fecha_vencimiento and archivo_url
        f = _make_factura_obj()
        obj = FacturaConEstado.model_validate(
            {
                "id": f.id,
                "usuario_id": f.usuario_id,
                "proveedor_id": f.proveedor_id,
                "numero": "001-1234",
                "fecha_emision": f.fecha_emision,
                "fecha_vencimiento": date(2026, 7, 15),
                "monto_total": f.monto_total,
                "archivo_url": "https://res.cloudinary.com/demo/image.jpg",
                "origen": f.origen,
                "estado": EstadoFactura.PAGADA,
                "created_at": f.created_at,
                "updated_at": f.updated_at,
            }
        )
        assert obj.fecha_vencimiento == date(2026, 7, 15)
        assert obj.archivo_url == "https://res.cloudinary.com/demo/image.jpg"
        assert obj.numero == "001-1234"

    def test_historial_fecha_is_date_not_datetime(self):
        """`fecha` in EntradaHistorial must be a date, not a datetime."""
        from app.schemas.cuenta_corriente import EntradaHistorial

        obj = EntradaHistorial.model_validate(
            {
                "id": uuid.uuid4(),
                "tipo": "FACTURA",
                "fecha": date(2026, 6, 15),
                "monto": Decimal("100.00"),
                "saldo_acumulado": Decimal("100.00"),
            }
        )
        assert isinstance(obj.fecha, date)
        assert not isinstance(obj.fecha, datetime)

    def test_monto_rejects_zero_with_gt0(self):
        """Field(gt=0) rejects monto=0 — the strict positive constraint."""
        from app.schemas.cuenta_corriente import EntradaHistorial

        with pytest.raises(ValidationError) as exc_info:
            EntradaHistorial.model_validate(
                {
                    "id": uuid.uuid4(),
                    "tipo": "FACTURA",
                    "fecha": date(2026, 6, 15),
                    "monto": Decimal("0.00"),
                    "saldo_acumulado": Decimal("0.00"),
                }
            )
        assert "monto" in str(exc_info.value).lower()
