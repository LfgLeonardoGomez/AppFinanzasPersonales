"""
RefreshToken model — server-side storage for opaque refresh tokens.

Design decision D-C03-2:
- Stores only the SHA-256 hash of the refresh token, NEVER the raw value.
- revoked_at=None means the token is active.
- revoked_at populated means the token was revoked (by logout or rotation).
- Does NOT use SoftDeleteMixin: revoked_at is a session lifecycle concept,
  not a UI soft-delete concept.
- Indexed on: token_hash (lookup on /refresh), usuario_id (revoke-all future).

Validity rule:
    token is valid ⟺ revoked_at IS NULL AND expires_at > now()
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin


class RefreshToken(TimestampUUIDMixin, SQLModel, table=True):
    """
    Persisted refresh token entry.

    Only the hash is stored — the raw opaque token is sent to the client
    once via cookie and never written to the DB.
    """

    __tablename__ = "refresh_token"

    usuario_id: uuid.UUID = Field(
        nullable=False,
        index=True,
        foreign_key="usuario.id",
    )
    token_hash: str = Field(
        nullable=False,
        index=True,
        unique=True,
        description="SHA-256 hex digest of the opaque refresh token. Never the raw value.",
    )
    expires_at: datetime = Field(
        nullable=False,
        description="UTC expiry timestamp. Token is invalid after this point.",
    )
    revoked_at: Optional[datetime] = Field(
        default=None,
        nullable=True,
        description="UTC timestamp when the token was revoked. None = still active.",
    )


__all__ = ["RefreshToken"]
