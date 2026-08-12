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
from decimal import Decimal
from typing import Optional, Sequence

from sqlalchemy import case, func
from sqlmodel import Session, select

from app.models.cliente import Cliente
from app.models.cobro_cliente import CobroCliente
from app.models.enums import FormaPago
from app.models.venta import Venta


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

    # ── Balance aggregate (C-35, D6) ──────────────────────────────────────────

    def get_saldo_por_cliente(
        self, negocio_id: uuid.UUID
    ) -> dict[uuid.UUID, Decimal]:
        """
        Balance per active customer for a negocio, in ONE aggregate query.

        Formula (RN-CCC-01):
            saldo = SUM(fiados activos.monto) - SUM(cobros activos.monto)

        Mirrors ProveedorRepository.get_saldo_por_proveedor exactly: two
        pre-aggregated subqueries LEFT JOIN-ed to cliente, so ordering
        customers by debt never requires one request per customer (no N+1,
        no join fan-out).

        Customers with no movements are simply absent from the returned
        dict — the caller (service layer) defaults a missing key to 0.00.
        """
        fiado_sums = (
            select(
                Venta.cliente_id.label("cliente_id"),
                func.coalesce(func.sum(Venta.monto), 0).label("total_fiados"),
            )
            .where(Venta.negocio_id == negocio_id)
            .where(Venta.forma_pago == FormaPago.CUENTA_CORRIENTE)
            .where(Venta.deleted_at == None)  # noqa: E711
            .group_by(Venta.cliente_id)
            .subquery()
        )

        cobro_sums = (
            select(
                CobroCliente.cliente_id.label("cliente_id"),
                func.coalesce(func.sum(CobroCliente.monto), 0).label("total_cobros"),
            )
            .where(CobroCliente.negocio_id == negocio_id)
            .where(CobroCliente.deleted_at == None)  # noqa: E711
            .group_by(CobroCliente.cliente_id)
            .subquery()
        )

        statement = (
            select(
                Cliente.id.label("cliente_id"),
                (
                    func.coalesce(fiado_sums.c.total_fiados, 0)
                    - func.coalesce(cobro_sums.c.total_cobros, 0)
                ).label("saldo"),
            )
            .where(Cliente.negocio_id == negocio_id)
            .where(Cliente.deleted_at == None)  # noqa: E711
            .outerjoin(fiado_sums, Cliente.id == fiado_sums.c.cliente_id)
            .outerjoin(cobro_sums, Cliente.id == cobro_sums.c.cliente_id)
        )

        rows = self.session.exec(statement).all()
        return {row.cliente_id: Decimal(str(row.saldo)) for row in rows}


__all__ = ["ClienteRepository"]
