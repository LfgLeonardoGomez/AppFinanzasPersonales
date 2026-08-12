"""
Venta model — what the shop sold (C-33).

The structural decision, and the one everything else follows from (D-33): a
fiado is NOT a separate entity. It is a `Venta` with
`forma_pago = CUENTA_CORRIENTE` and a `cliente_id`. That single row is both the
day's sale and the charge on the customer's account, so the two can never
disagree — which is exactly what would happen if the amount were entered once
in sales and again as a separate charge.

Its mirror already exists on the other side of the ledger: `Factura` is a
charge the shop owes, a fiado `Venta` is a charge owed to the shop. Same
denormalized negocio_id, same soft delete, same refusal to persist a balance.

`cliente_id` has to be nullable — most sales have no customer — which means the
type alone cannot stop a fiado from being saved without one. A fiado with no
customer is money the shop believes it is owed and cannot collect from anybody,
and it is not recoverable by review because there is nobody to ask. Hence the
CHECK constraint in migration 0010:

    CHECK ((forma_pago = 'CUENTA_CORRIENTE') = (cliente_id IS NOT NULL))

No `origen` field: unlike Factura and Pago, nothing here is proposed by the
vision model. A sale is typed at the counter.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Column, Numeric
from sqlmodel import Field, SQLModel

from app.models.base import SoftDeleteMixin, TimestampUUIDMixin
from app.models.enums import FormaPago


class Venta(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """One sale operation."""

    __tablename__ = "venta"

    # Isolation axis (D-27).
    negocio_id: uuid.UUID = Field(foreign_key="negocio.id", nullable=False, index=True)

    # Authorship, NOT authorization (D4). Never filter access with this.
    creado_por_usuario_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="usuario.id", nullable=True
    )

    # Present if and only if forma_pago is CUENTA_CORRIENTE. Enforced by a CHECK
    # in the database, not just by the application (D1).
    cliente_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="cliente.id", nullable=True, index=True
    )

    # A sale happens on a day, not at an instant (D5). A timestamp would force a
    # timezone decision on every read and let a sale drift between days.
    fecha: date = Field(nullable=False)

    monto: Decimal = Field(
        sa_column=Column(Numeric(precision=12, scale=2), nullable=False)
    )

    forma_pago: FormaPago = Field(nullable=False)

    notas: Optional[str] = Field(default=None)

    # NOTE: no 'saldo' and no 'estado' — both derived on demand (D-01).


__all__ = ["Venta"]
