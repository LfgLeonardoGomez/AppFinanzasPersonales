"""
CobroClienteRepository — data access for CobroCliente entities (C-35).

A CobroCliente is associated to a Cliente ONLY — no venta_id (RN-CCC-03).
Mirrors PagoRepository exactly, one level down the same ledger shape.

Pure data access. NO authorization, NO business rules — that lives in
CobroClienteService.
"""

import uuid
from decimal import Decimal
from typing import Optional

from sqlmodel import Session, func, select

from app.models.cobro_cliente import CobroCliente
from app.repositories.base_repository import BaseRepository


class CobroClienteRepository(BaseRepository[CobroCliente]):
    """Repository for CobroCliente. Soft delete enabled."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, CobroCliente)

    def listar_de_cliente(
        self,
        negocio_id: uuid.UUID,
        cliente_id: uuid.UUID,
        include_deleted: bool = False,
    ) -> list[CobroCliente]:
        """
        List payments for a specific customer, scoped to a negocio.

        Ordered by (fecha ASC, created_at ASC, id ASC) — the FIFO pool order,
        matching PagoRepository.list_by_proveedor and
        VentaRepository.listar_fiadas_de_cliente. Excludes soft-deleted
        payments by default.
        """
        statement = (
            select(CobroCliente)
            .where(CobroCliente.negocio_id == negocio_id)
            .where(CobroCliente.cliente_id == cliente_id)
        )
        if not include_deleted:
            statement = statement.where(CobroCliente.deleted_at == None)  # noqa: E711

        statement = statement.order_by(
            CobroCliente.fecha, CobroCliente.created_at, CobroCliente.id
        )
        return list(self.session.exec(statement).all())

    def sumar_cobros_de_cliente(
        self, negocio_id: uuid.UUID, cliente_id: uuid.UUID
    ) -> Decimal:
        """Sum of a customer's live payments — 0.00, never None, with none."""
        statement = (
            select(func.coalesce(func.sum(CobroCliente.monto), 0))
            .where(CobroCliente.negocio_id == negocio_id)
            .where(CobroCliente.cliente_id == cliente_id)
            .where(CobroCliente.deleted_at == None)  # noqa: E711
        )
        total = self.session.exec(statement).one()
        return Decimal(str(total))

    def listar(
        self,
        negocio_id: uuid.UUID,
        page: int = 1,
        page_size: int = 50,
        cliente_id: Optional[uuid.UUID] = None,
    ) -> tuple[list[CobroCliente], int]:
        """
        Paginated listing of a negocio's active payments.

        Ordered by (fecha DESC, created_at DESC, id DESC) — newest first,
        matching PagoRepository.list_by_negocio. Optional cliente_id filter.
        """
        base_filters = [
            CobroCliente.negocio_id == negocio_id,
            CobroCliente.deleted_at == None,  # noqa: E711
        ]
        if cliente_id is not None:
            base_filters.append(CobroCliente.cliente_id == cliente_id)

        count_stmt = select(func.count(CobroCliente.id)).where(*base_filters)
        total = int(self.session.exec(count_stmt).one())

        offset = (page - 1) * page_size
        stmt = (
            select(CobroCliente)
            .where(*base_filters)
            .order_by(
                CobroCliente.fecha.desc(),
                CobroCliente.created_at.desc(),
                CobroCliente.id.desc(),
            )
            .limit(page_size)
            .offset(offset)
        )
        items = list(self.session.exec(stmt).all())

        return items, total


__all__ = ["CobroClienteRepository"]
