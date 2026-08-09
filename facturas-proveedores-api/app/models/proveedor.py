"""
Proveedor model — a supplier/vendor associated with a user.

Spec:
- nombre: max 120, NOT unique (same name allowed per user)
- categoria: defaults to OTRO
- deleted_at: soft delete enabled (D-C02-2)
- CUIT format validation deferred to service layer (D-C02-2)
"""

import uuid
from typing import Optional

from sqlmodel import Field, SQLModel

from app.models.base import TimestampUUIDMixin, SoftDeleteMixin
from app.models.enums import CategoriaProveedor


class Proveedor(SoftDeleteMixin, TimestampUUIDMixin, SQLModel, table=True):
    """
    Supplier entity.

    Belongs to a single negocio (D-27). Every member of that negocio sees and
    operates it. A negocio can have many suppliers with the same name — the
    uniqueness constraint is intentionally absent.
    """

    __tablename__ = "proveedor"

    # Isolation axis (D-27) — replaces the former usuario_id.
    negocio_id: uuid.UUID = Field(foreign_key="negocio.id", nullable=False, index=True)

    # Authorship, NOT authorization (D4). Never filter access with this.
    creado_por_usuario_id: Optional[uuid.UUID] = Field(
        default=None, foreign_key="usuario.id", nullable=True
    )

    nombre: str = Field(nullable=False, max_length=120)

    # Optional fields — format validation in service layer (C-06)
    cuit: Optional[str] = Field(default=None, max_length=13)
    telefono: Optional[str] = Field(default=None, max_length=30)
    notas: Optional[str] = Field(default=None)

    categoria: CategoriaProveedor = Field(default=CategoriaProveedor.OTRO)


__all__ = ["Proveedor"]
