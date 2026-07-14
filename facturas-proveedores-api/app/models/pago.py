"""
Pago model — a payment made to a supplier.

CRITICAL invariants (RN-PAG-01, D-02, D-C02-5):
- Pago MUST NOT have a 'factura_id' column.
- A Pago links ONLY to a Proveedor (not to a specific Factura).
- Payment-to-invoice assignment is derived via FIFO by the service layer (C-12).

Decision D-C02-4: usuario_id denormalized for cheap multi-tenant scoping.
"""

import uuid
from decimal import Decimal
from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel
from sqlalchemy import Numeric, Column

from app.models.base import TimestampUUIDMixin, SoftDeleteMixin
from app.models.enums import MetodoPago, OrigenDocumento


class Pago(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """
    Payment entity.

    - usuario_id denormalized (D-C02-4): enables direct user-scoping without
      JOIN to proveedor.
    - NO factura_id: payments are associated to suppliers, not invoices
      (RN-PAG-01). The FIFO algorithm in the service layer derives assignment.
    """

    __tablename__ = "pago"

    # Multi-tenant scoping (denormalized, D-C02-4)
    usuario_id: uuid.UUID = Field(foreign_key="usuario.id", nullable=False)
    proveedor_id: uuid.UUID = Field(foreign_key="proveedor.id", nullable=False)

    # Amount — numeric(12,2) ARS; never float
    monto: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=2), nullable=False)
    )

    fecha: date = Field(nullable=False)
    metodo: MetodoPago = Field(nullable=False)
    comprobante_url: Optional[str] = Field(default=None)
    origen: OrigenDocumento = Field(nullable=False)

    # NOTE: no 'factura_id' — payment is supplier-scoped, not invoice-scoped (RN-PAG-01)


__all__ = ["Pago"]
