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

    - negocio_id denormalized (D-27, supersedes D-05): enables direct
      tenant-scoping without JOIN to proveedor.
    - NO factura_id: payments are associated to suppliers, not invoices
      (RN-PAG-01). The FIFO algorithm in the service layer derives assignment.
    """

    __tablename__ = "pago"

    # Multi-tenant scoping (denormalized, D-27)
    negocio_id: uuid.UUID = Field(foreign_key="negocio.id", nullable=False, index=True)
    proveedor_id: uuid.UUID = Field(foreign_key="proveedor.id", nullable=False)

    # Authorship, NOT authorization (D4). Never filter access with this.
    creado_por_usuario_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="usuario.id", nullable=True
    )

    # Amount — numeric(12,2) ARS; never float
    monto: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=2), nullable=False)
    )

    fecha: date = Field(nullable=False)
    metodo: MetodoPago = Field(nullable=False)
    comprobante_url: Optional[str] = Field(default=None)
    origen: OrigenDocumento = Field(nullable=False)

    # C-43 Fase A: retry-safety marker, not a ledger fact. Nullable because
    # the header is optional and every pre-existing row has none. Does NOT
    # participate in the FIFO pool or any other calculation — see
    # uq_pago_negocio_idempotency_key (migration 0013).
    idempotency_key: Optional[uuid.UUID] = Field(default=None, nullable=True)

    # NOTE: no 'factura_id' — payment is supplier-scoped, not invoice-scoped (RN-PAG-01)


__all__ = ["Pago"]
