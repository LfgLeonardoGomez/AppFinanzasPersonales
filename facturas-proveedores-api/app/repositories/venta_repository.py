"""
VentaRepository — data access for Venta.

Pure data access, scoped by `negocio_id` (D-27). "Active" always means
`deleted_at IS NULL`: a deleted sale is gone from listings and, when it was a
fiado, gone from the customer's balance too — the balance is computed over what
is live (D-01).

`listar_fiadas_de_cliente` is here for C-35 rather than for any screen today.
It is the query that turns a customer's sales into their running charges.
"""

import uuid
from datetime import date
from typing import Optional, Sequence

from sqlmodel import Session, select

from app.models.enums import FormaPago
from app.models.venta import Venta


class VentaRepository:
    """Repository for Venta, always scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get(self, negocio_id: uuid.UUID, venta_id: uuid.UUID) -> Optional[Venta]:
        statement = select(Venta).where(
            Venta.id == venta_id,
            Venta.negocio_id == negocio_id,
            Venta.deleted_at.is_(None),
        )
        return self.session.exec(statement).first()

    def listar(
        self,
        negocio_id: uuid.UUID,
        desde: Optional[date] = None,
        hasta: Optional[date] = None,
        forma_pago: Optional[FormaPago] = None,
        cliente_id: Optional[uuid.UUID] = None,
    ) -> Sequence[Venta]:
        """
        Active sales of the negocio, newest first.

        Date bounds are inclusive on both ends: a shop asking for "today" means
        today, and an exclusive upper bound would quietly drop the last day of
        every range someone types.
        """
        statement = select(Venta).where(
            Venta.negocio_id == negocio_id, Venta.deleted_at.is_(None)
        )

        if desde is not None:
            statement = statement.where(Venta.fecha >= desde)
        if hasta is not None:
            statement = statement.where(Venta.fecha <= hasta)
        if forma_pago is not None:
            statement = statement.where(Venta.forma_pago == forma_pago)
        if cliente_id is not None:
            statement = statement.where(Venta.cliente_id == cliente_id)

        statement = statement.order_by(
            Venta.fecha.desc(), Venta.created_at.desc(), Venta.id.desc()
        )
        return list(self.session.exec(statement))

    def listar_fiadas_de_cliente(
        self, negocio_id: uuid.UUID, cliente_id: uuid.UUID
    ) -> Sequence[Venta]:
        """
        A customer's live charges, oldest first.

        Oldest first because FIFO consumes them in that order (RN-CCC-02), with
        the same deterministic tie-break as invoices: `(fecha, created_at, id)`.
        C-35 builds the balance on top of this.
        """
        statement = (
            select(Venta)
            .where(
                Venta.negocio_id == negocio_id,
                Venta.cliente_id == cliente_id,
                Venta.forma_pago == FormaPago.CUENTA_CORRIENTE,
                Venta.deleted_at.is_(None),
            )
            .order_by(Venta.fecha.asc(), Venta.created_at.asc(), Venta.id.asc())
        )
        return list(self.session.exec(statement))

    def create(self, **datos) -> Venta:
        """Persist a sale. Caller controls the transaction."""
        venta = Venta(**datos)
        self.session.add(venta)
        self.session.flush()
        self.session.refresh(venta)
        return venta

    def get_by_idempotency_key(
        self, negocio_id: uuid.UUID, idempotency_key: uuid.UUID
    ) -> Optional[Venta]:
        """
        The sale that owns this key, scoped to one negocio (C-42, Regla Dura #3).

        Deliberately does NOT filter `deleted_at IS NULL`: the uniqueness the
        key protects survives a soft delete (design.md D2), so the caller must
        be able to find a deleted row under its key too — that is exactly the
        case that turns a would-be replica into a 409 instead of resurrecting
        a deleted sale as if it were live.
        """
        statement = select(Venta).where(
            Venta.negocio_id == negocio_id,
            Venta.idempotency_key == idempotency_key,
        )
        return self.session.exec(statement).first()


__all__ = ["VentaRepository"]
