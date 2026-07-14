"""
Usuario model — represents a user account in the system.

Spec: email unique, no deleted_at (D-C02-2), tema_preferido defaults to CLARO.
"""

from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin
from app.models.enums import TemaPreferido


class Usuario(TimestampUUIDMixin, SQLModel, table=True):
    """
    User account.

    - No soft delete (deleted_at). Users are not soft-deleted in MVP.
    - email must be unique across all users.
    - Sensitive: password_hash stored here (hashing is C-03 concern).
    """

    __tablename__ = "usuario"

    email: str = Field(unique=True, nullable=False, max_length=254)
    nombre: str = Field(nullable=False, max_length=120)
    password_hash: str = Field(nullable=False)

    # Optional profile fields
    telefono: Optional[str] = Field(default=None, max_length=30)
    avatar_url: Optional[str] = Field(default=None)
    nombre_negocio: Optional[str] = Field(default=None, max_length=120)

    # UI preference
    tema_preferido: TemaPreferido = Field(default=TemaPreferido.CLARO)


__all__ = ["Usuario"]
