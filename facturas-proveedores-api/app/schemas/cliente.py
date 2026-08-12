"""
Pydantic schemas for /api/clientes (C-32).

`nombre_normalizado` is absent from every request schema on purpose: it is
derived, not received. Accepting it would let a payload decide which customers
count as the same person — the one thing this feature exists to control.
`negocio_id` is absent for the same structural reason it is everywhere else.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


class ClienteCreate(BaseModel):
    """Alta. `nombre` is the only required field — it happens at the counter."""

    model_config = ConfigDict(extra="forbid")

    nombre: str
    telefono: Optional[str] = None
    notas: Optional[str] = None

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("El nombre no puede estar vacío.")
        return v.strip()


class ClienteUpdate(BaseModel):
    """Partial update. Renaming recomputes the normalized form server-side."""

    model_config = ConfigDict(extra="forbid")

    nombre: Optional[str] = None
    telefono: Optional[str] = None
    notas: Optional[str] = None

    @field_validator("nombre")
    @classmethod
    def nombre_no_vacio(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and not v.strip():
            raise ValueError("El nombre no puede estar vacío.")
        return v.strip() if v is not None else None


class ClienteResponse(BaseModel):
    """A customer as the app sees them.

    `nombre` comes back exactly as typed; `nombre_normalizado` is exposed so a
    client can tell whether two entries would collide without guessing at the
    rule — but it is never accepted as input.
    """

    id: uuid.UUID
    negocio_id: uuid.UUID
    nombre: str
    nombre_normalizado: str
    telefono: Optional[str] = None
    notas: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    # On-demand balance (C-35, D6) — populated only by the plain listing
    # endpoint (GET /api/clientes with no `buscar` filter), via a single
    # aggregate query. `None` everywhere else (create/get/update/search),
    # which don't pay that extra query for a value they don't show.
    saldo: Optional[Decimal] = None

    model_config = ConfigDict(from_attributes=True)


__all__ = ["ClienteCreate", "ClienteUpdate", "ClienteResponse"]
