"""
Tests for IA Vision schemas (PropuestaFactura, PropuestaPago) — C-14.

Covers:
- PropuestaFactura: Pydantic BaseModel with strict null semantics
  - All fields default to None, error defaults to False, error_message to None
  - Extra fields from the model are ignored
  - Decimal coercion from JSON strings
  - No id/usuario_id/proveedor_id/origen/created_at/updated_at
- PropuestaPago: same shape, plus MetodoPago enum validation
  - Invalid metodo (not in enum) is rejected at validation time
  - case-sensitive: lowercase "transferencia" is rejected (extractor normalizes)
  - JSON extra fields ignored
  - No id/usuario_id/factura_id/etc.

These schemas are Pydantic v2 BaseModels (not SQLModel) because they are NEVER
persisted — they are transport DTOs (RN-IA-04).
"""

import uuid
from datetime import date
from decimal import Decimal

import pytest
from pydantic import BaseModel, ConfigDict, ValidationError


# ── PropuestaFactura ──────────────────────────────────────────────────────────


class TestPropuestaFactura:
    def test_all_defaults_none(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura()
        assert propuesta.proveedor_nombre is None
        assert propuesta.numero is None
        assert propuesta.fecha_emision is None
        assert propuesta.monto_total is None
        assert propuesta.error is False
        assert propuesta.error_message is None

    def test_all_fields_populated(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura(
            proveedor_nombre="Acme SA",
            numero="0001-00012345",
            fecha_emision=date(2026, 6, 15),
            monto_total=Decimal("12345.67"),
        )
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.numero == "0001-00012345"
        assert propuesta.fecha_emision == date(2026, 6, 15)
        assert propuesta.monto_total == Decimal("12345.67")
        assert propuesta.error is False
        assert propuesta.error_message is None

    def test_all_none_valid(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura(
            proveedor_nombre=None,
            numero=None,
            fecha_emision=None,
            monto_total=None,
        )
        assert propuesta.proveedor_nombre is None
        assert propuesta.numero is None
        assert propuesta.fecha_emision is None
        assert propuesta.monto_total is None

    def test_error_envelope_only(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura(error=True, error_message="timeout")
        assert propuesta.error is True
        assert propuesta.error_message == "timeout"
        assert propuesta.proveedor_nombre is None
        assert propuesta.monto_total is None

    def test_extra_fields_ignored(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura.model_validate(
            {
                "proveedor_nombre": "Acme SA",
                "numero": "001",
                "cuit": "30-12345678-9",
                "iva": 1234.56,
                "subtotal": 10000.0,
            }
        )
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.numero == "001"
        # Extra fields are silently dropped, NOT raised (extra="ignore")

    def test_monto_total_decimal_coercion(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura.model_validate({"monto_total": "1234.56"})
        assert propuesta.monto_total == Decimal("1234.56")

    def test_no_persistence_fields(self):
        from app.schemas.factura import PropuestaFactura

        declared = set(PropuestaFactura.model_fields.keys())
        forbidden = {"id", "usuario_id", "proveedor_id", "origen", "created_at", "updated_at"}
        assert declared.isdisjoint(forbidden), (
            f"PropuestaFactura must not declare any of {forbidden}, got {declared}"
        )
        assert declared == {
            "proveedor_nombre",
            "numero",
            "fecha_emision",
            "monto_total",
            "error",
            "error_message",
        }

    def test_is_basemodel_not_sqlmodel(self):
        from app.schemas.factura import PropuestaFactura

        assert issubclass(PropuestaFactura, BaseModel)
        # Pydantic BaseModel does not have __tablename__
        assert not hasattr(PropuestaFactura, "__tablename__")

    def test_model_dump_with_all_none(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura()
        dumped = propuesta.model_dump()
        assert dumped == {
            "proveedor_nombre": None,
            "numero": None,
            "fecha_emision": None,
            "monto_total": None,
            "error": False,
            "error_message": None,
        }

    def test_model_validate_partial_with_nulls(self):
        from app.schemas.factura import PropuestaFactura

        propuesta = PropuestaFactura.model_validate(
            {
                "proveedor_nombre": "Acme SA",
                "numero": None,
                "fecha_emision": "2026-06-15",
                "monto_total": None,
            }
        )
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.numero is None
        assert propuesta.fecha_emision == date(2026, 6, 15)
        assert propuesta.monto_total is None


# ── PropuestaPago ─────────────────────────────────────────────────────────────


class TestPropuestaPago:
    def test_all_defaults_none(self):
        from app.schemas.pago import PropuestaPago

        propuesta = PropuestaPago()
        assert propuesta.proveedor_nombre is None
        assert propuesta.monto is None
        assert propuesta.fecha is None
        assert propuesta.metodo is None
        assert propuesta.error is False
        assert propuesta.error_message is None

    def test_all_fields_populated(self):
        from app.schemas.pago import PropuestaPago
        from app.models.enums import MetodoPago

        propuesta = PropuestaPago(
            proveedor_nombre="Acme SA",
            monto=Decimal("5000.00"),
            fecha=date(2026, 6, 20),
            metodo=MetodoPago.TRANSFERENCIA,
        )
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.monto == Decimal("5000.00")
        assert propuesta.fecha == date(2026, 6, 20)
        assert propuesta.metodo == MetodoPago.TRANSFERENCIA

    def test_metodo_must_be_enum_value(self):
        from app.schemas.pago import PropuestaPago

        with pytest.raises(ValidationError) as exc_info:
            PropuestaPago(metodo="CRIPTOMONEDA")
        assert "metodo" in str(exc_info.value).lower()

    def test_metodo_none_valid(self):
        from app.schemas.pago import PropuestaPago

        propuesta = PropuestaPago(metodo=None)
        assert propuesta.metodo is None

    def test_metodo_case_sensitive(self):
        from app.schemas.pago import PropuestaPago

        with pytest.raises(ValidationError):
            PropuestaPago.model_validate({"metodo": "transferencia"})

    def test_extra_fields_ignored(self):
        from app.schemas.pago import PropuestaPago

        propuesta = PropuestaPago.model_validate(
            {
                "proveedor_nombre": "Acme SA",
                "cuit": "30-12345678-9",
                "comprobante_url": "https://example.com/c.png",
            }
        )
        assert propuesta.proveedor_nombre == "Acme SA"

    def test_no_persistence_fields(self):
        from app.schemas.pago import PropuestaPago

        declared = set(PropuestaPago.model_fields.keys())
        forbidden = {
            "id",
            "usuario_id",
            "proveedor_id",
            "origen",
            "created_at",
            "updated_at",
            "comprobante_url",
            "factura_id",
        }
        assert declared.isdisjoint(forbidden), (
            f"PropuestaPago must not declare any of {forbidden}, got {declared}"
        )
        assert declared == {
            "proveedor_nombre",
            "monto",
            "fecha",
            "metodo",
            "error",
            "error_message",
        }

    def test_model_validate_strict_rejects_bad_types(self):
        from app.schemas.pago import PropuestaPago

        # 'mil pesos' is not a Decimal
        with pytest.raises(ValidationError):
            PropuestaPago.model_validate({"monto": "mil pesos"})

    def test_model_validate_strict_rejects_int_for_metodo(self):
        from app.schemas.pago import PropuestaPago

        with pytest.raises(ValidationError):
            PropuestaPago.model_validate({"metodo": 42})

    def test_is_basemodel_not_sqlmodel(self):
        from app.schemas.pago import PropuestaPago

        assert issubclass(PropuestaPago, BaseModel)
        assert not hasattr(PropuestaPago, "__tablename__")
