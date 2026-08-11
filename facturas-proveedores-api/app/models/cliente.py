"""
Cliente model — the other side of the ledger (C-32).

Where `Proveedor` is who the shop owes, `Cliente` is who owes the shop. The
structural difference that drives this model: a supplier's name is a label
(two suppliers may share it, by spec), while a customer's name *identifies an
account*. Two equivalent rows are not untidy — they split one person's debt
across two balances, which destroys the only thing the feature has to get right.

Hence `nombre_normalizado`, derived in the service layer and backed by a
partial unique index over active rows. The index is partial on purpose: without
the `WHERE deleted_at IS NULL`, a deleted customer would hold its own name
hostage forever and the shop could never re-add someone it had removed.

Deliberately minimal: `nombre` is the only required field. The alta happens with
the customer standing at the counter, so anything else would be friction where
it hurts most.
"""

import uuid
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import SoftDeleteMixin, TimestampUUIDMixin


class Cliente(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """A customer with a running account at this negocio."""

    __tablename__ = "cliente"

    # Isolation axis (D-27).
    negocio_id: uuid.UUID = Field(foreign_key="negocio.id", nullable=False, index=True)

    # Authorship, NOT authorization (D4). Never filter access with this.
    creado_por_usuario_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="usuario.id", nullable=True
    )

    # As typed, accents and casing intact — this is what the shop shows its own
    # customer, and "juan perez" on a statement looks careless.
    nombre: str = Field(nullable=False, max_length=120)

    # Comparison form. Derived from `nombre` in the service layer, never
    # accepted from a payload. The partial unique index over
    # (negocio_id, nombre_normalizado) lives in migration 0008.
    nombre_normalizado: str = Field(nullable=False, max_length=120, index=True)

    telefono: Optional[str] = Field(default=None, max_length=30)
    notas: Optional[str] = Field(default=None)


__all__ = ["Cliente"]
