"""
Factura and FacturaItem models.

CRITICAL invariants (D-01, D-02, D-C02-6):
- Factura MUST NOT have a 'estado' column (PENDIENTE/PARCIAL/PAGADA is derived
  on-demand by the service layer via FIFO algorithm).
- Factura MUST NOT have a 'saldo' column.
- FacturaItem MUST NOT have deleted_at (its lifecycle follows the Factura).

Decision D-C02-4: usuario_id is denormalized on Factura for cheap multi-tenant
scoping without a JOIN to proveedor.
"""

import uuid
from decimal import Decimal
from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel
from sqlalchemy import Numeric, Column

from app.models.base import TimestampUUIDMixin, SoftDeleteMixin
from app.models.enums import OrigenDocumento


class Factura(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """
    Invoice entity.

    - usuario_id is denormalized (D-C02-4, D-05): enables direct user-scoping
      without JOIN to proveedor.
    - numero is nullable and NOT unique (per spec).
    - No 'estado' column: state is derived by FIFO in the service layer.
    """

    __tablename__ = "factura"

    # Multi-tenant scoping (denormalized, D-C02-4)
    usuario_id: uuid.UUID = Field(foreign_key="usuario.id", nullable=False)
    proveedor_id: uuid.UUID = Field(foreign_key="proveedor.id", nullable=False)

    # Invoice metadata
    numero: Optional[str] = Field(default=None, max_length=60)
    fecha_emision: date = Field(nullable=False)
    fecha_vencimiento: Optional[date] = Field(default=None)

    # Amount — numeric(12,2) via Decimal, never float
    monto_total: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=2), nullable=False)
    )

    archivo_url: Optional[str] = Field(default=None)
    origen: OrigenDocumento = Field(nullable=False)

    # NOTE: no 'estado' field — PENDIENTE/PARCIAL/PAGADA derived on-demand (D-01)
    # NOTE: no 'saldo' field — derived on-demand via GROUP BY (D-C02-6)


class FacturaItem(TimestampUUIDMixin, SQLModel, table=True):
    """
    Line item of an invoice.

    - No deleted_at: lifecycle follows Factura (cascade in service layer).
    - cantidad uses numeric to support decimal quantities (e.g. 2.5 kg).
    """

    __tablename__ = "factura_item"

    factura_id: uuid.UUID = Field(foreign_key="factura.id", nullable=False)
    descripcion: str = Field(nullable=False)

    # Decimal quantity (supports fractional units)
    cantidad: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=4), nullable=False)
    )

    precio_unitario: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=2), nullable=False)
    )


__all__ = ["Factura", "FacturaItem"]
