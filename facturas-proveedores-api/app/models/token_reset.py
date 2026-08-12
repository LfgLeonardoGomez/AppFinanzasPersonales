"""
TokenReset — the one-shot key that lets someone back into their own account.

Structurally this is the third instance of the same pattern in the project
(RefreshToken D-17, InvitacionEmpleado D-31): a high-entropy opaque value whose
SHA-256 is the only thing persisted. A leak of this table hands nobody anything.

What makes it different from an invitation, and why its TTL is an hour instead
of 48 (C-31, D1): an invitation CREATES a new account — if it leaks, a stranger
shows up in the team list and the admin deactivates them. This one TAKES OVER an
existing account, possibly the negocio's only admin. The window has to be the
smallest that a person opening their mail can still use.

Validity rule:
    token válido ⟺ usado_en IS NULL AND expira_en > now()
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin


class TokenReset(TimestampUUIDMixin, SQLModel, table=True):
    """Pending password-recovery token."""

    __tablename__ = "token_reset"

    usuario_id: uuid.UUID = Field(
        foreign_key="usuario.id", nullable=False, index=True
    )
    token_hash: str = Field(
        nullable=False,
        index=True,
        unique=True,
        description="SHA-256 hex digest of the reset token. Never the raw value.",
    )
    expira_en: datetime = Field(
        nullable=False,
        description="UTC. Past this point the token is dead even if unused.",
    )
    usado_en: Optional[datetime] = Field(
        default=None,
        nullable=True,
        description=(
            "UTC timestamp when consumed, or when invalidated by a newer reset. "
            "None = still usable."
        ),
    )

    # No deleted_at: lifecycle is usado_en / expira_en, not UI deletion.


__all__ = ["TokenReset"]
