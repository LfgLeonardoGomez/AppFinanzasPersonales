"""
Pydantic schemas for Pago (payment) endpoints.

Design decisions (C-10 design.md):
- D1: PagoCreate / PagoUpdate / PagoResponse / PagoListItem live here, not
  inline in the router.
- D2: PagoCreate declares exactly: proveedor_id, monto, fecha, metodo,
  comprobante_url (optional). NO factura_id — payments are supplier-scoped
  (RN-PAG-01, D-C02-5).
- D7: PagoUpdate is PATCH semantics — all fields optional, proveedor_id NOT
  changeable (re-linking a pago would corrupt the FIFO pool's history).
- D13: extra="forbid" on both input schemas so the wire cannot smuggle
  factura_id (or any other unknown field). Triple enforcement: model has
  no column, schema has no field, wire-level rejection via extra=forbid.

HARD RULES:
- NEVER declare a 'factura_id' field here (RN-PAG-01).
- usuario_id is NOT accepted in PagoCreate/Update — taken from session.
- origen is NOT accepted — the service stamps it as MANUAL (RN-PAG-04).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MetodoPago, OrigenDocumento


# ── PagoCreate ────────────────────────────────────────────────────────────────


class PagoCreate(BaseModel):
    """
    Payload for creating a new payment.

    - proveedor_id: required UUID — must belong to the authenticated user
      (validated in the service layer).
    - monto: required Decimal > 0 (Pydantic Field(gt=0)).
    - fecha: required date (NOT validated as not-future here; that runs
      in the service layer against America/Argentina/Buenos_Aires UTC-3
      so a request from a different timezone gets the correct answer).
    - metodo: required MetodoPago enum (Pydantic enforces the enum).
    - comprobante_url: optional HTTPS URL. For the MVP we accept any
      non-empty string (Q-PAG-02). Cloudinary validation is for avatar
      uploads only (C-05).
    - usuario_id, origen, id: NOT here. usuario_id is taken from the
      session; origen is stamped by the service (MANUAL).
    - factura_id: NOT here. RN-PAG-01.
    """

    model_config = ConfigDict(extra="forbid")

    proveedor_id: uuid.UUID
    monto: Decimal = Field(gt=0, description="Payment amount in ARS (must be > 0)")
    fecha: date
    metodo: MetodoPago
    comprobante_url: Optional[str] = None
    origen: Optional[OrigenDocumento] = None


# ── PagoUpdate ────────────────────────────────────────────────────────────────


class PagoUpdate(BaseModel):
    """
    Payload for partially updating a payment (PATCH semantics).

    - All fields optional; only provided (non-None) fields are applied.
    - proveedor_id is NOT declared — D7: cannot re-link a payment to a
      different supplier (would corrupt the FIFO pool's history).
    - usuario_id, origen, id: NOT here — immutable.
    - factura_id: NOT here — RN-PAG-01 (triple enforced).
    """

    model_config = ConfigDict(extra="forbid")

    monto: Optional[Decimal] = Field(
        default=None, gt=0, description="Payment amount in ARS (must be > 0 if provided)"
    )
    fecha: Optional[date] = None
    metodo: Optional[MetodoPago] = None
    comprobante_url: Optional[str] = None


# ── PagoResponse ──────────────────────────────────────────────────────────────


class PagoResponse(BaseModel):
    """
    Full payment response — returned by POST, GET /{id}, PATCH.

    Includes all persisted columns (no factura_id — the column does not
    exist on the model and is not declared here). origen is always MANUAL
    for now (C-14 will introduce IA-created pagos).

    C-18 (FE-005): `proveedor_nombre` is an OPTIONAL field populated by
    the service layer. It carries the related supplier's name when the
    supplier is active, and `None` when the supplier has been soft-deleted
    (per RN-PROV-04, the pago remains valid after the supplier is
    soft-deleted; the supplier's absence is informational, not an error).
    Backward compatible: callers / tests that construct PagoResponse
    without supplying the field get `None` automatically.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    usuario_id: uuid.UUID
    proveedor_id: uuid.UUID
    monto: Decimal
    fecha: date
    metodo: MetodoPago
    comprobante_url: Optional[str] = None
    origen: OrigenDocumento
    created_at: datetime
    updated_at: datetime
    proveedor_nombre: Optional[str] = None


# ── PagoListItem ──────────────────────────────────────────────────────────────


class PagoListItem(BaseModel):
    """
    Lean row for paginated payment listing.

    Omits comprobante_url and updated_at to keep the payload small. Pattern
    matches FacturaListItem (C-08). Q-PAG-01: NO proveedor_nombre in the
    list item — the frontend does the join if it needs it.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    proveedor_id: uuid.UUID
    monto: Decimal
    fecha: date
    metodo: MetodoPago
    origen: OrigenDocumento
    created_at: datetime


# ── PropuestaPago (C-14, IA vision proposal) ──────────────────────────────────


class PropuestaPago(BaseModel):
    """
    Vision-model proposal for a Pago header — NEVER persisted (RN-IA-04).

    Same shape as PropuestaFactura, with `metodo` constrained to the
    `MetodoPago` enum. Any value outside the enum is rejected at validation
    time; the extractor normalizes the model's response to the enum before
    calling model_validate (the schema does not silently coerce invalid
    metodos to None — by design, so the failure is loud).
    """

    model_config = ConfigDict(extra="ignore")

    proveedor_nombre: Optional[str] = None
    monto: Optional[Decimal] = None
    fecha: Optional[date] = None
    metodo: Optional[MetodoPago] = None
    error: bool = False
    error_message: Optional[str] = None


__all__ = [
    "PagoCreate",
    "PagoUpdate",
    "PagoResponse",
    "PagoListItem",
    "PropuestaPago",
]
