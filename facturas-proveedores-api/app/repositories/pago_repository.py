"""
PagoRepository — data access for Pago entities.

A Pago is associated to a Proveedor ONLY — no factura_id (RN-PAG-01, D-02).

Design decisions (C-10 design.md):
- D8: list_by_proveedor excludes soft-deleted by default — this is the
  contract the C-08 FIFO pool consumer relies on. MUST NOT regress.
- D6: list_by_negocio paginates and orders by fecha DESC, created_at DESC,
  id DESC so the most recent payment surfaces first.
- D7: PATCH semantics for update — caller passes only fields to change.
"""

import uuid
from typing import Optional

from sqlmodel import Session, func, select

from app.models.pago import Pago
from app.repositories.base_repository import BaseRepository


class PagoRepository(BaseRepository[Pago]):
    """Repository for Pago. Soft delete enabled."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, Pago)

    def list_by_proveedor(
        self,
        negocio_id: uuid.UUID,
        proveedor_id: uuid.UUID,
        include_deleted: bool = False,
    ) -> list[Pago]:
        """
        List payments for a specific supplier, scoped to a user.

        Ordered by fecha ASC (chronological order for FIFO allocation).
        By default excludes soft-deleted payments — this is the contract
        the C-08 `FacturaService.listar` FIFO pool depends on (D8).
        """
        statement = (
            select(Pago)
            .where(Pago.negocio_id == negocio_id)
            .where(Pago.proveedor_id == proveedor_id)
        )
        if not include_deleted:
            statement = statement.where(Pago.deleted_at == None)  # noqa: E711

        statement = statement.order_by(Pago.fecha, Pago.created_at, Pago.id)
        return list(self.session.exec(statement).all())

    def list_by_negocio(
        self,
        negocio_id: uuid.UUID,
        page: int = 1,
        page_size: int = 50,
        proveedor_id: Optional[uuid.UUID] = None,
    ) -> tuple[list[Pago], int]:
        """
        Paginated listing of a user's active payments (D6).

        - Excludes soft-deleted pagos.
        - Ordered by fecha DESC, created_at DESC, id DESC (newest first).
        - Optional proveedor_id filter — when provided, the list is
          scoped to that supplier.
        - Returns (items, total) where total is the count of all matching
          active payments (used by the router for the `total` response
          field; mirrors the FacturaListItem pattern from C-08).

        Page is 1-indexed; page_size defaults to 50.
        """
        base_filters = [
            Pago.negocio_id == negocio_id,
            Pago.deleted_at == None,  # noqa: E711
        ]
        if proveedor_id is not None:
            base_filters.append(Pago.proveedor_id == proveedor_id)

        # Total count (no pagination, no ordering) for the `total` field
        count_stmt = select(func.count(Pago.id)).where(*base_filters)
        total = int(self.session.exec(count_stmt).one())

        # Paginated items
        offset = (page - 1) * page_size
        stmt = (
            select(Pago)
            .where(*base_filters)
            .order_by(
                Pago.fecha.desc(),
                Pago.created_at.desc(),
                Pago.id.desc(),
            )
            .limit(page_size)
            .offset(offset)
        )
        items = list(self.session.exec(stmt).all())

        return items, total

    def list_recientes(self, negocio_id: uuid.UUID, limit: int) -> list[Pago]:
        """
        Return the `limit` most recent active pagos for a user.

        Ordered by (fecha DESC, created_at DESC, id DESC) — newest first.
        Used by the actividad-reciente feed (Home redesign): see
        FacturaRepository.list_recientes for the k-way merge rationale
        that makes a single LIMIT query on each source sufficient.
        """
        statement = (
            select(Pago)
            .where(Pago.negocio_id == negocio_id)
            .where(Pago.deleted_at == None)  # noqa: E711
            .order_by(
                Pago.fecha.desc(),
                Pago.created_at.desc(),
                Pago.id.desc(),
            )
            .limit(limit)
        )
        return list(self.session.exec(statement).all())


__all__ = ["PagoRepository"]
