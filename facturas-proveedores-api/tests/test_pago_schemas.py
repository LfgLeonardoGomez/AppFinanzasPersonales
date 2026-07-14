"""
Tests for Pago schemas (Task 1.1 — TDD RED, then GREEN).

Covers:
- PagoCreate: monto > 0, metodo in enum, comprobante_url optional,
  factura_id and other unknown fields rejected by extra="forbid"
- PagoUpdate: all fields optional, same validators, rejects unknown fields,
  rejects proveedor_id (cannot re-link), rejects factura_id
- PagoResponse: serializes Decimal as string, UUID as string; includes origen
- PagoListItem: lean row for paginated listing

CRITICAL invariants (RN-PAG-01):
- PagoCreate and PagoUpdate MUST NOT declare a factura_id field.
- extra="forbid" on both schemas so a payload smuggling factura_id is rejected.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest
from pydantic import ValidationError

from app.models.enums import MetodoPago, OrigenDocumento


# ── PagoCreate ────────────────────────────────────────────────────────────────


class TestPagoCreate:
    def test_valid_minimal(self):
        from app.schemas.pago import PagoCreate

        pc = PagoCreate(
            proveedor_id=uuid.uuid4(),
            monto=Decimal("100.00"),
            fecha=date.today(),
            metodo=MetodoPago.EFECTIVO,
        )
        assert pc.proveedor_id is not None
        assert pc.monto == Decimal("100.00")
        assert pc.fecha == date.today()
        assert pc.metodo == MetodoPago.EFECTIVO
        assert pc.comprobante_url is None

    def test_valid_with_comprobante_url(self):
        from app.schemas.pago import PagoCreate

        pc = PagoCreate(
            proveedor_id=uuid.uuid4(),
            monto=Decimal("250.00"),
            fecha=date.today(),
            metodo=MetodoPago.TRANSFERENCIA,
            comprobante_url="https://example.com/comprobante.pdf",
        )
        assert pc.comprobante_url == "https://example.com/comprobante.pdf"

    def test_monto_zero_rejected(self):
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("0.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
            )
        assert "monto" in str(exc_info.value).lower()

    def test_monto_negative_rejected(self):
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError):
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("-50.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
            )

    def test_metodo_invalid_rejected(self):
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo="BITCOIN",  # not in MetodoPago enum
            )
        assert "metodo" in str(exc_info.value).lower()

    def test_metodo_each_valid_enum_value(self):
        from app.schemas.pago import PagoCreate

        for metodo in (
            MetodoPago.EFECTIVO,
            MetodoPago.TRANSFERENCIA,
            MetodoPago.TARJETA,
            MetodoPago.MERCADOPAGO,
            MetodoPago.OTRO,
        ):
            pc = PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("10.00"),
                fecha=date.today(),
                metodo=metodo,
            )
            assert pc.metodo == metodo

    def test_proveedor_id_required(self):
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError):
            PagoCreate(
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
            )

    def test_fecha_required(self):
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError):
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                metodo=MetodoPago.EFECTIVO,
            )

    # ── RN-PAG-01: extra="forbid" rejects factura_id and unknown fields ───────

    def test_factura_id_rejected_extra_forbid(self):
        """RN-PAG-01: a payload smuggling factura_id must be rejected (422)."""
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
                factura_id=uuid.uuid4(),
            )
        # The error must reference the unknown field
        assert "factura_id" in str(exc_info.value).lower()

    def test_any_unknown_field_rejected(self):
        """extra='forbid' must reject any field not in the schema."""
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
                hacker_field="oops",
            )
        assert "hacker_field" in str(exc_info.value).lower()

    def test_usuario_id_rejected(self):
        """Schema must not accept usuario_id — taken from the session, not the payload."""
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                usuario_id=uuid.uuid4(),
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
            )
        assert "usuario_id" in str(exc_info.value).lower()

    def test_origen_rejected(self):
        """c-15a-origen-ia-backend: PagoCreate now ACCEPTS an optional `origen`
        field (C-15 IA confirmation path). The previous contract — `origen`
        was rejected by `extra="forbid"` — is replaced: the field is a known
        optional member of the schema, so the `forbid` constraint only
        rejects truly unknown fields (factura_id, usuario_id, etc.). See
        parametrized cases below."""
        from app.schemas.pago import PagoCreate

        assert "origen" in PagoCreate.model_fields

    # ── c-15a-origen-ia-backend: parametrized `origen` contract ──────────────

    @pytest.mark.parametrize(
        "origen_value, expected",
        [
            pytest.param(OrigenDocumento.IA, OrigenDocumento.IA, id="origen_IA_persists"),
            pytest.param(OrigenDocumento.MANUAL, OrigenDocumento.MANUAL, id="origen_MANUAL_persists"),
            pytest.param(None, None, id="origen_omitted_defaults_to_none"),
        ],
    )
    def test_origen_accepted(self, origen_value, expected):
        """c-15a: PagoCreate accepts `origen=IA`, `origen=MANUAL`, or omits it (None)."""
        from app.schemas.pago import PagoCreate

        payload = {
            "proveedor_id": uuid.uuid4(),
            "monto": Decimal("100.00"),
            "fecha": date.today(),
            "metodo": MetodoPago.EFECTIVO,
        }
        if origen_value is not None:
            payload["origen"] = origen_value
        pc = PagoCreate(**payload)
        assert pc.origen == expected

    def test_origen_invalid_rejected(self):
        """c-15a: Pydantic enum validation rejects non-OrigenDocumento values (422)."""
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
                origen="INVALID",
            )
        assert "origen" in str(exc_info.value).lower()

    def test_origen_is_known_field_extra_forbid_preserved(self):
        """c-15a: declaring `origen` as a known field does NOT weaken extra='forbid'.
        Other unknown fields (factura_id, usuario_id, hacker_field) are still
        rejected — RN-PAG-01 triple enforcement stays intact."""
        from app.schemas.pago import PagoCreate

        # `origen` is now a known field
        assert "origen" in PagoCreate.model_fields
        # and `extra='forbid'` is preserved (no default change)
        assert PagoCreate.model_config.get("extra") == "forbid"

    def test_id_rejected(self):
        """Schema must not accept id — server-generated."""
        from app.schemas.pago import PagoCreate

        with pytest.raises(ValidationError) as exc_info:
            PagoCreate(
                id=uuid.uuid4(),
                proveedor_id=uuid.uuid4(),
                monto=Decimal("100.00"),
                fecha=date.today(),
                metodo=MetodoPago.EFECTIVO,
            )
        assert "id" in str(exc_info.value).lower()


# ── PagoUpdate ────────────────────────────────────────────────────────────────


class TestPagoUpdate:
    def test_empty_patch_is_valid(self):
        """PATCH semantics — an empty payload is acceptable (zero fields updated)."""
        from app.schemas.pago import PagoUpdate

        pu = PagoUpdate()
        assert pu.monto is None
        assert pu.fecha is None
        assert pu.metodo is None
        assert pu.comprobante_url is None

    def test_partial_update_monto(self):
        from app.schemas.pago import PagoUpdate

        pu = PagoUpdate(monto=Decimal("250.00"))
        assert pu.monto == Decimal("250.00")
        assert pu.fecha is None

    def test_partial_update_fecha(self):
        from app.schemas.pago import PagoUpdate

        today = date.today()
        pu = PagoUpdate(fecha=today)
        assert pu.fecha == today

    def test_partial_update_metodo(self):
        from app.schemas.pago import PagoUpdate

        pu = PagoUpdate(metodo=MetodoPago.TRANSFERENCIA)
        assert pu.metodo == MetodoPago.TRANSFERENCIA

    def test_partial_update_comprobante_url(self):
        from app.schemas.pago import PagoUpdate

        pu = PagoUpdate(comprobante_url="https://example.com/x.pdf")
        assert pu.comprobante_url == "https://example.com/x.pdf"

    def test_monto_zero_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError):
            PagoUpdate(monto=Decimal("0.00"))

    def test_monto_negative_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError):
            PagoUpdate(monto=Decimal("-1.00"))

    def test_metodo_invalid_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError):
            PagoUpdate(metodo="CRIPTOMONEDA")

    # ── RN-PAG-01: update must also forbid factura_id ─────────────────────────

    def test_factura_id_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError) as exc_info:
            PagoUpdate(factura_id=uuid.uuid4())
        assert "factura_id" in str(exc_info.value).lower()

    def test_proveedor_id_rejected_in_update(self):
        """D7: proveedor_id is not changeable via PATCH — would corrupt FIFO history."""
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError) as exc_info:
            PagoUpdate(proveedor_id=uuid.uuid4())
        assert "proveedor_id" in str(exc_info.value).lower()

    def test_usuario_id_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError) as exc_info:
            PagoUpdate(usuario_id=uuid.uuid4())
        assert "usuario_id" in str(exc_info.value).lower()

    def test_origen_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError) as exc_info:
            PagoUpdate(origen=OrigenDocumento.IA)
        assert "origen" in str(exc_info.value).lower()

    def test_unknown_field_rejected_in_update(self):
        from app.schemas.pago import PagoUpdate

        with pytest.raises(ValidationError) as exc_info:
            PagoUpdate(smuggled="value")
        assert "smuggled" in str(exc_info.value).lower()


# ── PagoResponse ──────────────────────────────────────────────────────────────


class TestPagoResponse:
    def test_serializes_full_response(self):
        from app.schemas.pago import PagoResponse

        response = PagoResponse(
            id=uuid.uuid4(),
            usuario_id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            monto=Decimal("500.00"),
            fecha=date(2024, 6, 15),
            metodo=MetodoPago.EFECTIVO,
            comprobante_url=None,
            origen=OrigenDocumento.MANUAL,
            created_at=datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
            updated_at=datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )
        assert response.monto == Decimal("500.00")
        assert response.origen == OrigenDocumento.MANUAL
        assert response.comprobante_url is None

    def test_response_has_no_factura_id_field(self):
        """RN-PAG-01 triple enforcement: the response model itself has no factura_id."""
        from app.schemas.pago import PagoResponse

        assert "factura_id" not in PagoResponse.model_fields

    def test_response_serializes_decimal_and_uuid_as_string(self):
        from app.schemas.pago import PagoResponse

        uid = uuid.uuid4()
        pid = uuid.uuid4()
        rid = uuid.uuid4()
        response = PagoResponse(
            id=rid,
            usuario_id=uid,
            proveedor_id=pid,
            monto=Decimal("123.45"),
            fecha=date(2024, 6, 15),
            metodo=MetodoPago.EFECTIVO,
            comprobante_url=None,
            origen=OrigenDocumento.MANUAL,
            created_at=datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
            updated_at=datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )
        # model_dump uses mode='json' → Decimal and UUID become strings
        dumped = response.model_dump(mode="json")
        assert dumped["monto"] == "123.45"
        assert dumped["id"] == str(rid)
        assert dumped["usuario_id"] == str(uid)
        assert dumped["proveedor_id"] == str(pid)


# ── PagoListItem ──────────────────────────────────────────────────────────────


class TestPagoListItem:
    def test_lean_row(self):
        from app.schemas.pago import PagoListItem

        item = PagoListItem(
            id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            monto=Decimal("100.00"),
            fecha=date(2024, 6, 15),
            metodo=MetodoPago.EFECTIVO,
            origen=OrigenDocumento.MANUAL,
            created_at=datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )
        assert item.monto == Decimal("100.00")
        assert item.origen == OrigenDocumento.MANUAL
        # comprobante_url is intentionally NOT on PagoListItem (lean row, D6)
        assert "comprobante_url" not in PagoListItem.model_fields

    def test_list_item_has_no_factura_id_field(self):
        """RN-PAG-01: list item must not have a factura_id field either."""
        from app.schemas.pago import PagoListItem

        assert "factura_id" not in PagoListItem.model_fields

    def test_list_item_serializes_created_at(self):
        from app.schemas.pago import PagoListItem

        item = PagoListItem(
            id=uuid.uuid4(),
            proveedor_id=uuid.uuid4(),
            monto=Decimal("10.00"),
            fecha=date(2024, 6, 15),
            metodo=MetodoPago.OTRO,
            origen=OrigenDocumento.MANUAL,
            created_at=datetime(2024, 6, 15, 12, 0, 0, tzinfo=timezone.utc),
        )
        dumped = item.model_dump(mode="json")
        assert "2024-06-15" in dumped["created_at"]
