"""
Pydantic schemas for Proveedor (supplier) endpoints.

Design decisions (D7, C-06 design.md):
- ProveedorCreate: nombre required/non-empty; cuit optional with regex validator.
  No usuario_id — taken from the session, never from the payload.
- ProveedorUpdate: all fields optional (PATCH semantics), same cuit validator.
- ProveedorResponse: full supplier + saldo: Decimal (never float). from_attributes=True.
- ProveedorListItem: lean list row with saldo.
- ProveedorDeleteResponse: id + tiene_dependencias bool.

CUIT format: ^\\d{2}-\\d{8}-\\d{1}$ (RN-PROV-02).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator

from app.models.enums import CategoriaProveedor

# CUIT format regex (RN-PROV-02)
_CUIT_REGEX = r"^\d{2}-\d{8}-\d{1}$"


def _validate_cuit(v: Optional[str]) -> Optional[str]:
    """
    Validate CUIT format: \\d{2}-\\d{8}-\\d{1}.

    None / missing → accepted.
    Empty string → rejected (does not match pattern).
    """
    import re

    if v is None:
        return v
    if not re.match(_CUIT_REGEX, v):
        raise ValueError(
            "CUIT must match the format NN-NNNNNNNN-N (e.g. '20-12345678-9')"
        )
    return v


class ProveedorCreate(BaseModel):
    """
    Payload for creating a new supplier.

    - nombre: required, non-empty string.
    - cuit: optional; validated against ^\\d{2}-\\d{8}-\\d{1}$.
    - usuario_id is NOT accepted here — the service sets it from the session.
    """

    nombre: str
    cuit: Optional[str] = None
    telefono: Optional[str] = None
    categoria: CategoriaProveedor = CategoriaProveedor.OTRO
    notas: Optional[str] = None

    @field_validator("nombre")
    @classmethod
    def nombre_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("nombre must not be empty")
        return v

    @field_validator("cuit")
    @classmethod
    def cuit_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_cuit(v)


class ProveedorUpdate(BaseModel):
    """
    Payload for partial update of a supplier (PATCH semantics).

    All fields optional. Same CUIT validator. No usuario_id.
    """

    nombre: Optional[str] = None
    cuit: Optional[str] = None
    telefono: Optional[str] = None
    categoria: Optional[CategoriaProveedor] = None
    notas: Optional[str] = None

    @field_validator("nombre")
    @classmethod
    def nombre_must_not_be_empty(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("nombre must not be empty")
        return v

    @field_validator("cuit")
    @classmethod
    def cuit_format(cls, v: Optional[str]) -> Optional[str]:
        return _validate_cuit(v)


class ProveedorResponse(BaseModel):
    """
    Full supplier response, including on-demand saldo.

    saldo is always Decimal (never float). Serialized from ORM objects.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    cuit: Optional[str] = None
    telefono: Optional[str] = None
    categoria: CategoriaProveedor
    notas: Optional[str] = None
    saldo: Decimal
    created_at: datetime
    updated_at: datetime


class ProveedorListItem(BaseModel):
    """
    Lean row for paginated supplier listing.

    Keeps payload smaller than ProveedorResponse (no notas, timestamps).
    saldo is always Decimal.

    ultima_factura_fecha (Home redesign, C-Home): MAX fecha_emision among
    the supplier's ACTIVE (non-deleted) facturas. None when the supplier
    has no facturas at all.
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    nombre: str
    cuit: Optional[str] = None
    categoria: CategoriaProveedor
    saldo: Decimal
    ultima_factura_fecha: Optional[date] = None


class ProveedorDeleteResponse(BaseModel):
    """
    Response returned after soft-deleting a supplier.

    tiene_dependencias=True means the supplier had active invoices or payments;
    the caller/UI uses this to show a confirmation modal (RN-PROV-04).
    The deletion is NEVER blocked by dependencies.
    """

    id: uuid.UUID
    tiene_dependencias: bool


__all__ = [
    "ProveedorCreate",
    "ProveedorUpdate",
    "ProveedorResponse",
    "ProveedorListItem",
    "ProveedorDeleteResponse",
]
