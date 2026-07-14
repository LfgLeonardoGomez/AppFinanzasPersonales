"""
UsuarioRepository — data access for Usuario entities.

No soft delete for Usuario (D-C02-2).
C-03 additions: create() and get_by_id() for registration and auth dependency.
"""

import uuid
from typing import Optional

from sqlmodel import Session, select

from app.models.usuario import Usuario
from app.repositories.base_repository import BaseRepository


class UsuarioRepository(BaseRepository[Usuario]):
    """Repository for Usuario. No soft delete."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, Usuario)

    def get_by_email(self, email: str) -> Optional[Usuario]:
        """
        Find a user by their email address.

        Used by the auth layer (C-03) for login.
        Returns None if not found.
        """
        statement = select(Usuario).where(Usuario.email == email)
        return self.session.exec(statement).first()

    def get_by_id(self, usuario_id: uuid.UUID) -> Optional[Usuario]:
        """
        Find a user by their primary key.

        Used by get_current_user dependency to hydrate the authenticated user.
        Returns None if not found (caller raises 401/404 as appropriate).
        """
        return self.session.get(Usuario, usuario_id)

    def create(self, **data) -> Usuario:
        """
        Create and persist a new Usuario.

        Delegates to BaseRepository.create for consistency.
        Caller must control the transaction boundary (commit).
        """
        return super().create(**data)


__all__ = ["UsuarioRepository"]
