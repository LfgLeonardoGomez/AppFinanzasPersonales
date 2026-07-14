"""
Tests for proveedor Pydantic schemas (task 1.1 — TDD RED).

Covers:
- CUIT validation on ProveedorCreate and ProveedorUpdate
- Valid CUIT accepted, malformed rejected, missing accepted
- ProveedorResponse and ProveedorListItem have saldo typed as Decimal
- ProveedorDeleteResponse shape
"""

import pytest
from decimal import Decimal
from pydantic import ValidationError

from app.schemas.proveedor import (
    ProveedorCreate,
    ProveedorUpdate,
    ProveedorResponse,
    ProveedorListItem,
    ProveedorDeleteResponse,
)


# ── CUIT validation on ProveedorCreate ───────────────────────────────────────


class TestProveedorCreateCuit:
    def test_valid_cuit_accepted(self):
        """Spec: CUIT '20-12345678-9' passes validation."""
        p = ProveedorCreate(nombre="Acme", cuit="20-12345678-9")
        assert p.cuit == "20-12345678-9"

    def test_malformed_cuit_no_dashes_rejected(self):
        """Spec: CUIT '20123456789' (no dashes) raises ValidationError."""
        with pytest.raises(ValidationError):
            ProveedorCreate(nombre="Acme", cuit="20123456789")

    def test_missing_cuit_accepted(self):
        """Spec: missing cuit is accepted (Optional field)."""
        p = ProveedorCreate(nombre="Acme")
        assert p.cuit is None

    def test_none_cuit_accepted(self):
        """Spec: cuit=None is accepted explicitly."""
        p = ProveedorCreate(nombre="Acme", cuit=None)
        assert p.cuit is None

    def test_empty_string_cuit_rejected(self):
        """Spec: empty string cuit must fail — it does not match the regex."""
        with pytest.raises(ValidationError):
            ProveedorCreate(nombre="Acme", cuit="")

    def test_extra_digit_cuit_rejected(self):
        """Spec: '20-123456789-9' (9 digits in middle) rejected."""
        with pytest.raises(ValidationError):
            ProveedorCreate(nombre="Acme", cuit="20-123456789-9")

    def test_wrong_separator_cuit_rejected(self):
        """Spec: '20/12345678/9' (slash separators) rejected."""
        with pytest.raises(ValidationError):
            ProveedorCreate(nombre="Acme", cuit="20/12345678/9")

    def test_nombre_required_and_non_empty(self):
        """Spec: nombre is required and must be non-empty."""
        with pytest.raises(ValidationError):
            ProveedorCreate(nombre="")

    def test_nombre_missing_raises(self):
        """Spec: nombre missing raises ValidationError."""
        with pytest.raises(ValidationError):
            ProveedorCreate()

    def test_no_usuario_id_field(self):
        """Spec: ProveedorCreate must NOT have a usuario_id field."""
        p = ProveedorCreate(nombre="Acme")
        assert not hasattr(p, "usuario_id")


# ── CUIT validation on ProveedorUpdate ───────────────────────────────────────


class TestProveedorUpdateCuit:
    def test_valid_cuit_accepted(self):
        """Spec: CUIT '20-12345678-9' passes on Update."""
        p = ProveedorUpdate(cuit="20-12345678-9")
        assert p.cuit == "20-12345678-9"

    def test_malformed_cuit_rejected(self):
        """Spec: malformed CUIT rejected on Update."""
        with pytest.raises(ValidationError):
            ProveedorUpdate(cuit="20123456789")

    def test_all_fields_optional(self):
        """Spec: ProveedorUpdate allows empty payload (PATCH semantics)."""
        p = ProveedorUpdate()
        assert p.nombre is None
        assert p.cuit is None

    def test_no_usuario_id_field(self):
        """Spec: ProveedorUpdate must NOT have a usuario_id field."""
        p = ProveedorUpdate(nombre="New Name")
        assert not hasattr(p, "usuario_id")

    def test_empty_string_cuit_rejected(self):
        """Spec: empty string cuit rejected on Update too."""
        with pytest.raises(ValidationError):
            ProveedorUpdate(cuit="")


# ── saldo typed as Decimal ────────────────────────────────────────────────────


class TestSaldoDecimalType:
    def test_proveedor_response_saldo_is_decimal(self):
        """Spec: ProveedorResponse.saldo must be typed as Decimal (never float)."""
        import uuid
        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        p = ProveedorResponse(
            id=uuid.uuid4(),
            nombre="Acme",
            cuit=None,
            telefono=None,
            categoria="OTRO",
            notas=None,
            saldo=Decimal("100.50"),
            created_at=now,
            updated_at=now,
        )
        assert isinstance(p.saldo, Decimal)
        assert p.saldo == Decimal("100.50")

    def test_proveedor_list_item_saldo_is_decimal(self):
        """Spec: ProveedorListItem.saldo must be typed as Decimal."""
        import uuid

        item = ProveedorListItem(
            id=uuid.uuid4(),
            nombre="Acme",
            cuit=None,
            categoria="OTRO",
            saldo=Decimal("0.00"),
        )
        assert isinstance(item.saldo, Decimal)

    def test_proveedor_delete_response_shape(self):
        """Spec: ProveedorDeleteResponse has id and tiene_dependencias."""
        import uuid

        r = ProveedorDeleteResponse(id=uuid.uuid4(), tiene_dependencias=False)
        assert r.tiene_dependencias is False

        r2 = ProveedorDeleteResponse(id=uuid.uuid4(), tiene_dependencias=True)
        assert r2.tiene_dependencias is True
