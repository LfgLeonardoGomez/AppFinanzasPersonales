"""
Pydantic schemas for CobroCliente (customer payment) endpoints (C-35).

Mirrors app/schemas/pago.py exactly, one level down the same ledger shape:
- CobroClienteCreate declares cliente_id, monto, fecha, metodo,
  comprobante_url (optional). NO venta_id (RN-CCC-03).
- CobroClienteUpdate is PATCH semantics — cliente_id NOT changeable (D8):
  moving a payment between customers rewrites two balances in one request,
  one of which the caller never named.
- extra="forbid" on both input schemas so the wire cannot smuggle venta_id,
  negocio_id or creado_por_usuario_id.

HARD RULES:
- NEVER declare a 'venta_id' field here (RN-CCC-03).
- negocio_id / creado_por_usuario_id are NOT accepted — taken from session.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import MetodoCobro


# ── CobroClienteCreate ────────────────────────────────────────────────────────


class CobroClienteCreate(BaseModel):
    """
    Payload for recording a new customer payment.

    - cliente_id: required UUID — must belong to the authenticated negocio
      (validated in the service layer).
    - monto: required Decimal > 0 (Pydantic Field(gt=0)).
    - fecha: required date (not-future re-validated in the service layer
      against America/Argentina/Buenos_Aires UTC-3).
    - metodo: required MetodoCobro enum.
    - comprobante_url: optional string.
    - negocio_id, id, creado_por_usuario_id: NOT here — taken from session.
    - venta_id: NOT here. RN-CCC-03.
    """

    model_config = ConfigDict(extra="forbid")

    cliente_id: uuid.UUID
    monto: Decimal = Field(gt=0, description="Payment amount in ARS (must be > 0)")
    fecha: date
    metodo: MetodoCobro
    comprobante_url: Optional[str] = None


# ── CobroClienteUpdate ────────────────────────────────────────────────────────


class CobroClienteUpdate(BaseModel):
    """
    Payload for partially updating a customer payment (PATCH semantics).

    - All fields optional; only provided (non-None) fields are applied.
    - cliente_id is NOT declared — D8: cannot move a payment to a different
      customer (would rewrite two balances in one request).
    - negocio_id, id: NOT here — immutable.
    - venta_id: NOT here — RN-CCC-03.
    """

    model_config = ConfigDict(extra="forbid")

    monto: Optional[Decimal] = Field(
        default=None, gt=0, description="Payment amount in ARS (must be > 0 if provided)"
    )
    fecha: Optional[date] = None
    metodo: Optional[MetodoCobro] = None
    comprobante_url: Optional[str] = None


# ── CobroClienteResponse ──────────────────────────────────────────────────────


class CobroClienteResponse(BaseModel):
    """Full payment response — returned by POST, GET /{id}, PATCH."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    negocio_id: uuid.UUID
    cliente_id: uuid.UUID
    monto: Decimal
    fecha: date
    metodo: MetodoCobro
    comprobante_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime


# ── CobroClienteListItem ──────────────────────────────────────────────────────


class CobroClienteListItem(BaseModel):
    """Lean row for paginated payment listing. Mirrors PagoListItem."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    cliente_id: uuid.UUID
    monto: Decimal
    fecha: date
    metodo: MetodoCobro
    created_at: datetime


__all__ = [
    "CobroClienteCreate",
    "CobroClienteUpdate",
    "CobroClienteResponse",
    "CobroClienteListItem",
]
