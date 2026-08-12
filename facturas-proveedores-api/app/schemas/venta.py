"""
Pydantic schemas for /api/ventas (C-33).

`negocio_id` and `creado_por_usuario_id` are absent from every request schema:
both come from the session. `cliente_id` IS accepted, because a fiado needs to
say whose it is — but the pair it forms with `forma_pago` is checked in the
service and, ultimately, by a CHECK in the database.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import FormaPago


class VentaCreate(BaseModel):
    """One sale. A fiado is this with forma_pago = CUENTA_CORRIENTE + cliente_id."""

    model_config = ConfigDict(extra="forbid")

    monto: Decimal = Field(gt=0)
    fecha: date
    forma_pago: FormaPago
    cliente_id: Optional[uuid.UUID] = None
    notas: Optional[str] = None

    @field_validator("notas")
    @classmethod
    def notas_limpias(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return None
        limpio = v.strip()
        return limpio or None


class VentaUpdate(BaseModel):
    """
    Partial update.

    Every field optional. The service validates the RESULTING
    (forma_pago, cliente_id) pair rather than the fields that happened to
    arrive — otherwise switching to EFECTIVO without mentioning the customer
    would leave a cash sale carrying one.
    """

    model_config = ConfigDict(extra="forbid")

    monto: Optional[Decimal] = Field(default=None, gt=0)
    fecha: Optional[date] = None
    forma_pago: Optional[FormaPago] = None
    cliente_id: Optional[uuid.UUID] = None
    notas: Optional[str] = None


class VentaResponse(BaseModel):
    """A sale as the app sees it."""

    id: uuid.UUID
    negocio_id: uuid.UUID
    cliente_id: Optional[uuid.UUID] = None
    fecha: date
    monto: Decimal
    forma_pago: FormaPago
    notas: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


__all__ = ["VentaCreate", "VentaUpdate", "VentaResponse"]
