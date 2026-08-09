"""
ProveedorRepository — data access for Proveedor entities.

Includes:
- get_saldo_por_proveedor: balance aggregate for all active suppliers (C-02, D-C02-8).
- list_by_negocio: paginated listing with saldo in a SINGLE aggregate query (C-06, D1/D2/D3).
- search_by_nombre: normalized case-insensitive search, scoped to user (C-06, D4).
- create/update/soft_delete: thin wrappers over BaseRepository (C-06, task 2.4).
- tiene_dependencias: EXISTS check for active factura or pago (C-06, D6, task 2.5).

Design decisions (design.md):
- D1/D2: one SELECT statement with pre-aggregated factura_sums/pago_sums subqueries
  to avoid fan-out double-count and prevent N+1 queries.
- D3: ORDER BY the labeled saldo expression for saldo ordering; func.lower for nombre.
- D4: search via func.lower().like(), scoped to user + active.
- Pure data access only — NO business logic, NO auth here.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlmodel import Session, select
from sqlalchemy import exists, func

from app.models.proveedor import Proveedor
from app.models.factura import Factura
from app.models.pago import Pago
from app.repositories.base_repository import BaseRepository


# ── Row-like container for list_by_negocio / search results ──────────────────

class ProveedorConSaldo:
    """
    Lightweight data container returned by list_by_negocio and search_by_nombre.

    Carries all Proveedor columns plus the computed saldo expression.
    Typed as a simple class (not Pydantic) to keep the repository layer
    free of schema dependencies. The service/router maps it to the schema.
    """

    __slots__ = (
        "id", "negocio_id", "nombre", "cuit", "telefono",
        "categoria", "notas", "saldo", "created_at", "updated_at", "deleted_at",
        "ultima_factura_fecha",
    )

    def __init__(self, row) -> None:
        # row is a SQLAlchemy Row with columns: all Proveedor columns + saldo label
        # (+ ultima_factura_fecha label, C-Home addition)
        self.id = row.id
        self.negocio_id = row.negocio_id
        self.nombre = row.nombre
        self.cuit = row.cuit
        self.telefono = row.telefono
        self.categoria = row.categoria
        self.notas = row.notas
        self.saldo = Decimal(str(row.saldo))
        self.created_at = row.created_at
        self.updated_at = row.updated_at
        self.deleted_at = row.deleted_at
        # None when the supplier has no active facturas (LEFT JOIN miss).
        self.ultima_factura_fecha = getattr(row, "ultima_factura_fecha", None)


class ProveedorRepository(BaseRepository[Proveedor]):
    """Repository for Proveedor. Includes soft delete, saldo aggregate, and listing."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, Proveedor)

    # ── Existing aggregate (C-02, reused by service for single-supplier reads) ─

    def get_saldo_por_proveedor(
        self,
        negocio_id: uuid.UUID,
    ) -> dict[uuid.UUID, Decimal]:
        """
        Calculate the balance (saldo) per active provider for a user.

        Formula (RN-SALDO):
            saldo = SUM(facturas activas.monto_total) - SUM(pagos activos.monto)

        Uses a single SQL query with GROUP BY (no N+1).
        Filters: deleted_at IS NULL on both facturas and pagos.

        Returns:
            dict mapping proveedor_id → saldo (Decimal).
            Providers with no data return Decimal("0.00").

        NOTE: This is DATA ACCESS only. The caller (service layer) interprets
        the sign (positive = deuda; zero = al día; negative = a favor).
        """
        # Subquery: sum of active invoices per proveedor
        factura_sums = (
            select(
                Factura.proveedor_id.label("proveedor_id"),
                func.coalesce(func.sum(Factura.monto_total), 0).label("total_facturas"),
            )
            .where(Factura.negocio_id == negocio_id)
            .where(Factura.deleted_at == None)  # noqa: E711
            .group_by(Factura.proveedor_id)
            .subquery()
        )

        # Subquery: sum of active payments per proveedor
        pago_sums = (
            select(
                Pago.proveedor_id.label("proveedor_id"),
                func.coalesce(func.sum(Pago.monto), 0).label("total_pagos"),
            )
            .where(Pago.negocio_id == negocio_id)
            .where(Pago.deleted_at == None)  # noqa: E711
            .group_by(Pago.proveedor_id)
            .subquery()
        )

        # Main query: join proveedores with aggregates via FULL OUTER JOIN equivalent
        # We use LEFT JOIN from proveedor to each subquery to include all active proveedores
        statement = (
            select(
                Proveedor.id.label("proveedor_id"),
                (
                    func.coalesce(factura_sums.c.total_facturas, 0)
                    - func.coalesce(pago_sums.c.total_pagos, 0)
                ).label("saldo"),
            )
            .where(Proveedor.negocio_id == negocio_id)
            .where(Proveedor.deleted_at == None)  # noqa: E711
            .outerjoin(factura_sums, Proveedor.id == factura_sums.c.proveedor_id)
            .outerjoin(pago_sums, Proveedor.id == pago_sums.c.proveedor_id)
        )

        rows = self.session.exec(statement).all()

        return {
            row.proveedor_id: Decimal(str(row.saldo))
            for row in rows
        }

    # ── Paginated listing with embedded saldo (C-06, D1/D2/D3) ──────────────

    def list_by_negocio(
        self,
        negocio_id: uuid.UUID,
        page: int = 1,
        order_by: str = "nombre",
        page_size: int = 20,
    ) -> list[ProveedorConSaldo]:
        """
        Return a page of active suppliers with their computed saldo in ONE query.

        The saldo is obtained through two pre-aggregated subqueries (factura_sums,
        pago_sums) LEFT JOIN-ed to proveedor, preventing the fan-out double-count
        that would arise from a direct JOIN to factura + pago (D2).

        Ordering:
        - order_by='nombre' → func.lower(nombre) ASC (case-insensitive, D3/D4)
        - order_by='saldo'  → saldo expression DESC (largest debt first, D3)

        Pagination: 1-based page with fixed page_size (D8).
        """
        offset = (page - 1) * page_size

        # Pre-aggregated subqueries (prevents double-count fan-out, D2)
        factura_sums = (
            select(
                Factura.proveedor_id.label("proveedor_id"),
                func.coalesce(func.sum(Factura.monto_total), 0).label("total_facturas"),
            )
            .where(Factura.negocio_id == negocio_id)
            .where(Factura.deleted_at == None)  # noqa: E711
            .group_by(Factura.proveedor_id)
            .subquery()
        )

        pago_sums = (
            select(
                Pago.proveedor_id.label("proveedor_id"),
                func.coalesce(func.sum(Pago.monto), 0).label("total_pagos"),
            )
            .where(Pago.negocio_id == negocio_id)
            .where(Pago.deleted_at == None)  # noqa: E711
            .group_by(Pago.proveedor_id)
            .subquery()
        )

        # Subquery: MAX(fecha_emision) among active facturas per proveedor
        # (Home redesign — ultima_factura_fecha). Same LEFT JOIN pattern as
        # factura_sums/pago_sums above: a single grouped aggregate, no N+1.
        factura_fecha_max = (
            select(
                Factura.proveedor_id.label("proveedor_id"),
                func.max(Factura.fecha_emision).label("ultima_factura_fecha"),
            )
            .where(Factura.negocio_id == negocio_id)
            .where(Factura.deleted_at == None)  # noqa: E711
            .group_by(Factura.proveedor_id)
            .subquery()
        )

        # Saldo expression labeled so ORDER BY can reference the alias (D3)
        saldo_expr = (
            func.coalesce(factura_sums.c.total_facturas, 0)
            - func.coalesce(pago_sums.c.total_pagos, 0)
        ).label("saldo")

        statement = (
            select(
                Proveedor.id,
                Proveedor.negocio_id,
                Proveedor.nombre,
                Proveedor.cuit,
                Proveedor.telefono,
                Proveedor.categoria,
                Proveedor.notas,
                Proveedor.created_at,
                Proveedor.updated_at,
                Proveedor.deleted_at,
                saldo_expr,
                factura_fecha_max.c.ultima_factura_fecha,
            )
            .where(Proveedor.negocio_id == negocio_id)
            .where(Proveedor.deleted_at == None)  # noqa: E711
            .outerjoin(factura_sums, Proveedor.id == factura_sums.c.proveedor_id)
            .outerjoin(pago_sums, Proveedor.id == pago_sums.c.proveedor_id)
            .outerjoin(
                factura_fecha_max, Proveedor.id == factura_fecha_max.c.proveedor_id
            )
        )

        # Apply ordering (D3)
        if order_by == "saldo":
            statement = statement.order_by(saldo_expr.desc(), Proveedor.id.asc())
        else:
            # Default: nombre ASC case-insensitive (D4), with id as
            # the final tiebreak for deterministic page boundaries
            # when multiple suppliers share a case-insensitive name.
            statement = statement.order_by(func.lower(Proveedor.nombre).asc(), Proveedor.id.asc())

        statement = statement.limit(page_size).offset(offset)

        rows = self.session.exec(statement).all()
        return [ProveedorConSaldo(row) for row in rows]

    # ── Name search (C-06, D4) ────────────────────────────────────────────────

    def search_by_nombre(
        self,
        negocio_id: uuid.UUID,
        query: str,
    ) -> list[Proveedor]:
        """
        Search active suppliers by normalized (lowercase) nombre fragment.

        Filters: negocio_id match, deleted_at IS NULL, func.lower(nombre) LIKE %q%.
        Returns full Proveedor ORM objects (caller adds saldo if needed).
        """
        normalized = query.lower().strip()
        statement = (
            select(Proveedor)
            .where(Proveedor.negocio_id == negocio_id)
            .where(Proveedor.deleted_at == None)  # noqa: E711
            .where(func.lower(Proveedor.nombre).like(f"%{normalized}%"))
        )
        return list(self.session.exec(statement).all())

    # ── Bulk name lookup (Home redesign — actividad-reciente) ────────────────

    def get_nombres_by_ids(
        self, proveedor_ids: set[uuid.UUID]
    ) -> dict[uuid.UUID, str]:
        """
        Return {proveedor_id: nombre} for the given ids, active suppliers only.

        Soft-deleted or missing suppliers are simply absent from the dict —
        callers treat a missing key as "name unknown" (same convention as
        PagoResponse.proveedor_nombre, C-18 FE-005). Single query, no N+1.
        """
        if not proveedor_ids:
            return {}

        statement = (
            select(Proveedor.id, Proveedor.nombre)
            .where(Proveedor.id.in_(proveedor_ids))
            .where(Proveedor.deleted_at == None)  # noqa: E711
        )
        rows = self.session.exec(statement).all()
        return {row.id: row.nombre for row in rows}

    # ── tiene_dependencias (C-06, D6, task 2.5) ──────────────────────────────

    def tiene_dependencias(self, proveedor_id: uuid.UUID) -> bool:
        """
        Check whether the supplier has any active invoices or payments.

        Uses EXISTS to avoid loading rows — returns immediately on first match.
        Called before (or after) soft_delete; checks ACTIVE rows only
        (deleted_at IS NULL on factura/pago).

        Returns True if at least one active factura OR pago exists for this supplier.
        """
        has_facturas = self.session.exec(
            select(
                exists(
                    select(Factura.id)
                    .where(Factura.proveedor_id == proveedor_id)
                    .where(Factura.deleted_at == None)  # noqa: E711
                )
            )
        ).one()

        if has_facturas:
            return True

        has_pagos = self.session.exec(
            select(
                exists(
                    select(Pago.id)
                    .where(Pago.proveedor_id == proveedor_id)
                    .where(Pago.deleted_at == None)  # noqa: E711
                )
            )
        ).one()

        return bool(has_pagos)

    # ── Thin CRUD wrappers (task 2.4) ─────────────────────────────────────────
    # BaseRepository already has create/update/soft_delete as generic methods.
    # These type-specific wrappers make call sites more explicit and provide
    # a stable API surface even if BaseRepository changes.

    def create(self, **data) -> Proveedor:  # type: ignore[override]
        """Create and flush a new Proveedor. Caller commits."""
        return super().create(**data)

    def update(self, entity: Proveedor, **data) -> Proveedor:  # type: ignore[override]
        """Update fields on an existing Proveedor. Caller commits."""
        return super().update(entity, **data)

    def soft_delete(self, proveedor_id: uuid.UUID) -> Optional[Proveedor]:
        """Soft-delete a Proveedor (sets deleted_at). Caller commits."""
        return super().soft_delete(proveedor_id)


__all__ = ["ProveedorRepository", "ProveedorConSaldo"]
