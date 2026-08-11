"""
ClienteRepository — data access for Cliente.

Pure data access, scoped by `negocio_id` (D-27). Two things it owns because
they belong in the query rather than in a caller's judgement:

- "active" always means `deleted_at IS NULL`, matching the partial unique
  index. A lookup that forgot it would report a name as taken when the shop
  had already deleted that customer.
- the autocomplete ordering: exact normalized match first, then contains.
"""

import uuid
from typing import Optional, Sequence

from sqlalchemy import case
from sqlmodel import Session, select

from app.models.cliente import Cliente


class ClienteRepository:
    """Repository for Cliente, always scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, negocio_id: uuid.UUID, cliente_id: uuid.UUID) -> Optional[Cliente]:
        """Active customer of this negocio, or None."""
        statement = select(Cliente).where(
            Cliente.id == cliente_id,
            Cliente.negocio_id == negocio_id,
            Cliente.deleted_at.is_(None),
        )
        return self.session.exec(statement).first()

    def get_by_nombre_normalizado(
        self, negocio_id: uuid.UUID, nombre_normalizado: str
    ) -> Optional[Cliente]:
        """
        The active customer holding this normalized name, or None.

        Mirrors the partial unique index exactly — deleted rows do not count,
        because they do not block a new alta either.
        """
        statement = select(Cliente).where(
            Cliente.negocio_id == negocio_id,
            Cliente.nombre_normalizado == nombre_normalizado,
            Cliente.deleted_at.is_(None),
        )
        return self.session.exec(statement).first()

    def listar(self, negocio_id: uuid.UUID) -> Sequence[Cliente]:
        """Every active customer of the negocio, by name."""
        statement = (
            select(Cliente)
            .where(Cliente.negocio_id == negocio_id, Cliente.deleted_at.is_(None))
            .order_by(Cliente.nombre_normalizado.asc(), Cliente.id.asc())
        )
        return list(self.session.exec(statement))

    def buscar(self, negocio_id: uuid.UUID, fragmento_normalizado: str) -> Sequence[Cliente]:
        """
        Autocomplete search: exact normalized match first, then contains.

        The ordering is the point. When someone types "juan" and both "Juan"
        and "Juan Pérez" exist, the exact one has to lead — otherwise the
        employee scrolls past the customer they meant.
        """
        if not fragmento_normalizado:
            return self.listar(negocio_id)

        prioridad = case(
            (Cliente.nombre_normalizado == fragmento_normalizado, 0),
            else_=1,
        )

        statement = (
            select(Cliente)
            .where(
                Cliente.negocio_id == negocio_id,
                Cliente.deleted_at.is_(None),
                Cliente.nombre_normalizado.contains(fragmento_normalizado),
            )
            .order_by(prioridad, Cliente.nombre_normalizado.asc(), Cliente.id.asc())
        )
        return list(self.session.exec(statement))

    def create(self, **datos) -> Cliente:
        """Persist a customer. Caller controls the transaction."""
        cliente = Cliente(**datos)
        self.session.add(cliente)
        self.session.flush()
        self.session.refresh(cliente)
        return cliente


__all__ = ["ClienteRepository"]
