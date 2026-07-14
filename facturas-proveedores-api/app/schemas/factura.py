"""
Pydantic schemas for Factura (invoice) endpoints.

Design decisions (C-08 design.md):
- FacturaCreate: proveedor_id required; monto_total > 0; fecha_emision not future
  (validated in Pydantic for quick feedback; service re-validates in UTC-3).
  No usuario_id — taken from the session, never from the payload.
- FacturaUpdate: all fields optional (PATCH semantics), same validators.
- FacturaResponse: includes estado (derived by FIFO, never persisted) and items.
  items_sum_mismatch=True signals non-blocking warning (RN-FAC-04).
- FacturaListItem: lean row for listing (no items, includes estado).
- EstadoFactura: imported from enums (PENDIENTE/PARCIAL/PAGADA).

HARD RULES:
- NEVER include 'estado' as a DB column — it is always computed on-demand.
- usuario_id is NOT accepted in FacturaCreate/Update — taken from session.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import EstadoFactura, OrigenDocumento


# ── FacturaItemCreate ──────────────────────────────────────────────────────────


class FacturaItemCreate(BaseModel):
    """
    Line item payload for creating or updating an invoice.

    - descripcion: required, non-empty.
    - cantidad: positive decimal (> 0). Supports fractional units (e.g. 2.5 kg).
    - precio_unitario: non-negative decimal (>= 0). Zero is valid (free item).
    """

    descripcion: str
    cantidad: Decimal = Field(gt=0, description="Quantity (positive, supports decimals)")
    precio_unitario: Decimal = Field(
        ge=0, description="Unit price in ARS (non-negative)"
    )

    @field_validator("descripcion")
    @classmethod
    def descripcion_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("descripcion must not be empty")
        return v


# ── FacturaCreate ──────────────────────────────────────────────────────────────


class FacturaCreate(BaseModel):
    """
    Payload for creating a new invoice.

    - proveedor_id: required UUID — must belong to the authenticated user.
    - fecha_emision: required, must not be future (UTC-3 zone, validated
      in Pydantic using local date; service re-validates against UTC-3 wall clock).
    - monto_total: required, must be > 0. Source of truth for the invoice amount.
    - items: optional list. Sum mismatch vs monto_total is a warning, not a block.
    - usuario_id is NOT here — always taken from the authenticated session.
    """

    proveedor_id: uuid.UUID
    fecha_emision: date
    monto_total: Decimal = Field(gt=0, description="Invoice total in ARS (must be > 0)")
    numero: Optional[str] = None
    fecha_vencimiento: Optional[date] = None
    archivo_url: Optional[str] = None
    items: list[FacturaItemCreate] = Field(default_factory=list)
    origen: Optional[OrigenDocumento] = None

    @field_validator("fecha_emision")
    @classmethod
    def fecha_emision_not_future(cls, v: date) -> date:
        if v > date.today():
            raise ValueError(
                "fecha_emision must not be in the future"
            )
        return v


# ── FacturaUpdate ──────────────────────────────────────────────────────────────


class FacturaUpdate(BaseModel):
    """
    Payload for partially updating an invoice (PATCH semantics).

    All fields optional. proveedor_id cannot be changed (would require
    re-validating ownership and FIFO across two suppliers).
    Same validators as FacturaCreate for provided fields.
    """

    fecha_emision: Optional[date] = None
    monto_total: Optional[Decimal] = Field(
        default=None, gt=0, description="Invoice total in ARS (must be > 0 if provided)"
    )
    numero: Optional[str] = None
    fecha_vencimiento: Optional[date] = None
    archivo_url: Optional[str] = None
    items: Optional[list[FacturaItemCreate]] = None

    @field_validator("fecha_emision")
    @classmethod
    def fecha_emision_not_future(cls, v: Optional[date]) -> Optional[date]:
        if v is not None and v > date.today():
            raise ValueError("fecha_emision must not be in the future")
        return v


# ── FacturaItemResponse ────────────────────────────────────────────────────────


class FacturaItemResponse(BaseModel):
    """
    Response schema for a single invoice line item.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    factura_id: uuid.UUID
    descripcion: str
    cantidad: Decimal
    precio_unitario: Decimal


# ── FacturaResponse ────────────────────────────────────────────────────────────


class FacturaResponse(BaseModel):
    """
    Full invoice response, including computed estado and items.

    estado is computed by the FIFO algorithm in the service layer — NEVER
    persisted to the database (D-01, D-C02-6).
    items_sum_mismatch=True signals that sum(items) != monto_total; non-blocking
    warning for the frontend (RN-FAC-04).
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    usuario_id: uuid.UUID
    proveedor_id: uuid.UUID
    numero: Optional[str] = None
    fecha_emision: date
    fecha_vencimiento: Optional[date] = None
    monto_total: Decimal
    archivo_url: Optional[str] = None
    origen: OrigenDocumento

    # Computed on-demand — never stored in DB
    estado: EstadoFactura
    items: list[FacturaItemResponse]
    items_sum_mismatch: bool = False

    created_at: datetime
    updated_at: datetime


# ── FacturaListItem ────────────────────────────────────────────────────────────


class FacturaListItem(BaseModel):
    """
    Lean row for paginated invoice listing.

    Omits items, timestamps, and archivo_url to keep payload small.
    estado is computed by FIFO — not a DB column.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    proveedor_id: uuid.UUID
    numero: Optional[str] = None
    fecha_emision: date
    monto_total: Decimal
    estado: EstadoFactura


# ── PropuestaFactura (C-14, IA vision proposal) ───────────────────────────────


class PropuestaFactura(BaseModel):
    """
    Vision-model proposal for a Factura header — NEVER persisted (RN-IA-04).

    All fields default to None so unreadable / missing data serializes as null
    instead of crashing. Pydantic v2 BaseModel (not SQLModel) — a PropuestaFactura
    cannot be `session.add(...)`ed even by mistake.

    `error` / `error_message` are populated by the extractor when the SDK or
    parsing fails; the router does NOT propagate exceptions (RN-IA-05).
    """

    model_config = ConfigDict(extra="ignore")

    proveedor_nombre: Optional[str] = None
    numero: Optional[str] = None
    fecha_emision: Optional[date] = None
    monto_total: Optional[Decimal] = None
    error: bool = False
    error_message: Optional[str] = None


__all__ = [
    "FacturaItemCreate",
    "FacturaCreate",
    "FacturaUpdate",
    "FacturaItemResponse",
    "FacturaResponse",
    "FacturaListItem",
    "PropuestaFactura",
]
