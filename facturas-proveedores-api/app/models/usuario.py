"""
Usuario model — represents a user account in the system.

Spec: email unique, tema_preferido defaults to CLARO.

Deactivation (D-32, C-28) — reverses the part of D-C02-2 that read
"Users are not soft-deleted in MVP":
    The column is `desactivado`, NOT `deleted_at`. It represents access
    lifecycle, not row deletion — the same criterion as
    `RefreshToken.revoked_at` (D-17). Records loaded by a deactivated user
    stay visible to the rest of the negocio and remain attributed to them.
    A `deleted_at` here would be actively wrong: business reads filter
    `deleted_at IS NULL` by convention and would start hiding the user.

Scoping (D-27, C-28):
    `negocio_id` is mandatory. A user belongs to exactly one negocio, with no
    membership table (D-28) — `email` is globally unique, so one person is one
    account is one negocio. Someone running two shops uses two accounts.
"""

import uuid
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin
from app.models.enums import TemaPreferido


class Usuario(TimestampUUIDMixin, SQLModel, table=True):
    """
    User account.

    - No soft delete (deleted_at). Access is revoked via `desactivado` (D-32).
    - email must be unique across all users.
    - Sensitive: password_hash stored here (hashing is C-03 concern).
    """

    __tablename__ = "usuario"

    # Isolation axis (D-27): every business query scopes by this negocio.
    negocio_id: uuid.UUID = Field(foreign_key="negocio.id", nullable=False, index=True)

    # The only privileged flag (D-29). Gates team management exclusively:
    # invites and deactivation. Everything else any active member can do.
    es_admin: bool = Field(default=False, nullable=False)

    # Access revocation (D-32). get_current_user rejects these with 401.
    desactivado: bool = Field(default=False, nullable=False)

    email: str = Field(unique=True, nullable=False, max_length=254)
    nombre: str = Field(nullable=False, max_length=120)
    password_hash: str = Field(nullable=False)

    # Optional profile fields
    telefono: Optional[str] = Field(default=None, max_length=30)
    avatar_url: Optional[str] = Field(default=None)
    # Obsolete since C-28: the shop name lives in Negocio.nombre. Kept so the
    # migration stays non-destructive; do not read it for new logic.
    nombre_negocio: Optional[str] = Field(default=None, max_length=120)

    # UI preference
    tema_preferido: TemaPreferido = Field(default=TemaPreferido.CLARO)


__all__ = ["Usuario"]
