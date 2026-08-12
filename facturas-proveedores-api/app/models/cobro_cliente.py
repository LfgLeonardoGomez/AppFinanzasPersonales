"""
CobroCliente model — a payment received from a customer (C-35).

CRITICAL invariant (RN-CCC-03, mirrors RN-PAG-01 on the supplier side):
- CobroCliente MUST NOT have a 'venta_id' column.
- A CobroCliente links ONLY to a Cliente (not to a specific Venta).
- Payment-to-fiado assignment is derived via FIFO by the service layer,
  exactly like Pago-to-Factura on the other side of the ledger.

D-01: no 'saldo' and no 'estado' column — both are computed on demand.
"""

import uuid
from decimal import Decimal
from datetime import date
from typing import Optional

from sqlmodel import Field, SQLModel
from sqlalchemy import Numeric, Column

from app.models.base import TimestampUUIDMixin, SoftDeleteMixin
from app.models.enums import MetodoCobro


class CobroCliente(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """
    Payment received from a customer.

    - negocio_id: the isolation axis (D-27).
    - cliente_id: REQUIRED — a payment with nobody to attach it to is not
      recoverable by review (same reasoning as Venta.cliente_id on a fiado).
    - NO venta_id: payments are customer-scoped, not sale-scoped (RN-CCC-03).
      The FIFO algorithm in the service layer derives which fiados it settles.
    """

    __tablename__ = "cobro_cliente"

    # Isolation axis (D-27).
    negocio_id: uuid.UUID = Field(foreign_key="negocio.id", nullable=False, index=True)

    # Required — see module docstring.
    cliente_id: uuid.UUID = Field(foreign_key="cliente.id", nullable=False)

    # Authorship, NOT authorization (D4). Never filter access with this.
    creado_por_usuario_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="usuario.id", nullable=True
    )

    # Amount — numeric(12,2) ARS; never float.
    monto: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=2), nullable=False)
    )

    fecha: date = Field(nullable=False)
    metodo: MetodoCobro = Field(nullable=False)
    comprobante_url: Optional[str] = Field(default=None)

    # NOTE: no 'venta_id' — payment is customer-scoped, not sale-scoped (RN-CCC-03).
    # NOTE: no 'saldo' and no 'estado' — both derived on demand (D-01).


__all__ = ["CobroCliente"]
