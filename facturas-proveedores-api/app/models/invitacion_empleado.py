"""
InvitacionEmpleado — a single-use, expiring code that lets someone join a Negocio.

Why a code and not an admin-created account (D-30, D-31):
    The admin hands this to the employee outside the system, and the employee
    picks their own password. That keeps the admin from ever handling someone
    else's credentials — which matters because there is no password recovery
    yet, so an admin-set provisional password would have no way back.

Why single-use with an expiry rather than a permanent shop code:
    A permanent code outlives the employee who leaves and only closes if the
    admin remembers to rotate it. This one closes itself.

Only the hash is persisted, same criterion as RefreshToken (D-17): a database
leak must not hand anyone a usable invitation. The readable value is shown once
at creation and cannot be recovered.

Validity rule:
    invitación válida ⟺ usado_en IS NULL AND expira_en > now()
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin


class InvitacionEmpleado(TimestampUUIDMixin, SQLModel, table=True):
    """Pending invitation to join a negocio as a regular member."""

    __tablename__ = "invitacion_empleado"

    negocio_id: uuid.UUID = Field(
        foreign_key="negocio.id", nullable=False, index=True
    )
    codigo_hash: str = Field(
        nullable=False,
        index=True,
        unique=True,
        description="SHA-256 hex digest of the invitation code. Never the raw value.",
    )
    creado_por_usuario_id: uuid.UUID = Field(
        foreign_key="usuario.id",
        nullable=False,
        description="Which admin issued it. Traceability, not authorization.",
    )
    expira_en: datetime = Field(
        nullable=False,
        description="UTC. Past this point the code is dead even if unused.",
    )
    usado_en: Optional[datetime] = Field(
        default=None,
        nullable=True,
        description="UTC timestamp when consumed. None = still available.",
    )

    # No deleted_at: the lifecycle here is usado_en / expira_en, not UI deletion.


__all__ = ["InvitacionEmpleado"]
