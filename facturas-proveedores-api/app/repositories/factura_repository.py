"""
FacturaRepository and FacturaItemRepository — data access for Factura entities.

Design decisions (C-08 design.md):
- D1: FIFO state derivation is NOT here — pure data access only.
- D3: list_by_usuario fetches all user's facturas (or scoped to one proveedor)
  ordered by (fecha_emision ASC, created_at ASC, id ASC) for FIFO allocation.
- D4: Items replaced atomically via update_with_items (hard-delete old, insert new).

CRITICAL invariants:
- NO estado column — computed on-demand by service layer (RN-FIFO, D-01).
- NO saldo column — computed on-demand (D-C02-6).
- NO factura_id on Pago — this repo does not touch Pago (RN-PAG-01).
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlmodel import Session, select

from app.models.enums import OrigenDocumento
from app.models.factura import Factura, FacturaItem
from app.repositories.base_repository import BaseRepository


class FacturaRepository(BaseRepository[Factura]):
    """Repository for Factura. Soft delete enabled."""

    def __init__(self, session: Session) -> None:
        super().__init__(session, Factura)

    # ── Listing ───────────────────────────────────────────────────────────────

    def list_by_usuario(
        self,
        usuario_id: uuid.UUID,
        proveedor_id: Optional[uuid.UUID] = None,
    ) -> list[Factura]:
        """
        Return active facturas for a user, optionally scoped to one proveedor.

        Ordering: fecha_emision ASC, created_at ASC, id ASC.
        This ordering is REQUIRED for the FIFO algorithm (RN-FIFO, RN-FIFO-01).

        Does NOT compute estado — that is the service layer's responsibility (D1).
        Excludes soft-deleted facturas.
        """
        statement = (
            select(Factura)
            .where(Factura.usuario_id == usuario_id)
            .where(Factura.deleted_at == None)  # noqa: E711
        )
        if proveedor_id is not None:
            statement = statement.where(Factura.proveedor_id == proveedor_id)

        # FIFO order: oldest first (RN-FIFO-01 deterministic tiebreak)
        statement = statement.order_by(
            Factura.fecha_emision.asc(),
            Factura.created_at.asc(),
            Factura.id.asc(),
        )
        return list(self.session.exec(statement).all())

    def list_by_proveedor(
        self,
        usuario_id: uuid.UUID,
        proveedor_id: uuid.UUID,
        include_deleted: bool = False,
    ) -> list[Factura]:
        """
        List invoices for a specific supplier, scoped to a user.

        Ordered by fecha_emision ASC, then created_at ASC (FIFO ordering).
        By default excludes soft-deleted invoices.
        """
        statement = (
            select(Factura)
            .where(Factura.usuario_id == usuario_id)
            .where(Factura.proveedor_id == proveedor_id)
        )
        if not include_deleted:
            statement = statement.where(Factura.deleted_at == None)  # noqa: E711

        statement = statement.order_by(
            Factura.fecha_emision.asc(),
            Factura.created_at.asc(),
            Factura.id.asc(),
        )
        return list(self.session.exec(statement).all())

    def list_recientes(self, usuario_id: uuid.UUID, limit: int) -> list[Factura]:
        """
        Return the `limit` most recent active facturas for a user.

        Ordered by (fecha_emision DESC, created_at DESC, id DESC) — newest
        first. Used by the actividad-reciente feed (Home redesign): the
        service merges this with PagoRepository.list_recientes and takes
        the overall top-N, which only requires the top-N from each source
        (k-way merge argument), so a single LIMIT query here is sufficient
        — no N+1, no full-table scan.
        """
        statement = (
            select(Factura)
            .where(Factura.usuario_id == usuario_id)
            .where(Factura.deleted_at == None)  # noqa: E711
            .order_by(
                Factura.fecha_emision.desc(),
                Factura.created_at.desc(),
                Factura.id.desc(),
            )
            .limit(limit)
        )
        return list(self.session.exec(statement).all())

    # ── Single entity with items ──────────────────────────────────────────────

    def get_with_items(
        self, factura_id: uuid.UUID
    ) -> Optional[tuple["Factura", list["FacturaItem"]]]:
        """
        Fetch a factura and its items by ID.

        Returns a (Factura, [FacturaItem]) tuple, or None if not found.
        Does NOT filter by deleted_at — caller decides if deleted entities matter.
        """
        factura = self.session.get(Factura, factura_id)
        if factura is None:
            return None
        items = FacturaItemRepository(self.session).list_by_factura(factura_id)
        return factura, items

    # ── Atomic create ─────────────────────────────────────────────────────────

    def create_with_items(
        self,
        usuario_id: uuid.UUID,
        proveedor_id: uuid.UUID,
        fecha_emision: date,
        monto_total: Decimal,
        origen: OrigenDocumento,
        items_data: list[dict],
        numero: Optional[str] = None,
        fecha_vencimiento: Optional[date] = None,
        archivo_url: Optional[str] = None,
    ) -> Factura:
        """
        Create a Factura and its FacturaItems atomically (same flush).

        - items_data: list of dicts with keys: descripcion, cantidad, precio_unitario.
        - Caller commits; this method only flushes.
        """
        factura = Factura(
            usuario_id=usuario_id,
            proveedor_id=proveedor_id,
            fecha_emision=fecha_emision,
            monto_total=monto_total,
            origen=origen,
            numero=numero,
            fecha_vencimiento=fecha_vencimiento,
            archivo_url=archivo_url,
        )
        self.session.add(factura)
        self.session.flush()
        self.session.refresh(factura)

        if items_data:
            item_repo = FacturaItemRepository(self.session)
            for item_dict in items_data:
                item_repo.create(factura_id=factura.id, **item_dict)

        return factura

    # ── Atomic update ─────────────────────────────────────────────────────────

    def update_with_items(
        self,
        factura: Factura,
        new_items_data: Optional[list[dict]] = None,
        **field_updates,
    ) -> Factura:
        """
        Update factura fields and atomically replace its items.

        If new_items_data is not None, all existing items are hard-deleted
        and replaced with new_items_data (D4 — atomic replacement).
        If new_items_data is None, items are left unchanged.

        Caller commits.
        """
        for field_name, value in field_updates.items():
            setattr(factura, field_name, value)
        self.session.add(factura)
        self.session.flush()
        self.session.refresh(factura)

        if new_items_data is not None:
            item_repo = FacturaItemRepository(self.session)
            # Hard-delete all existing items (no soft delete for FacturaItem)
            existing = item_repo.list_by_factura(factura.id)
            for item in existing:
                self.session.delete(item)
            self.session.flush()
            # Insert new items
            for item_dict in new_items_data:
                item_repo.create(factura_id=factura.id, **item_dict)

        return factura

    # ── Thin wrappers ─────────────────────────────────────────────────────────

    def soft_delete(self, factura_id: uuid.UUID) -> Optional[Factura]:  # type: ignore[override]
        """Soft-delete a Factura (sets deleted_at). Caller commits."""
        return super().soft_delete(factura_id)


class FacturaItemRepository(BaseRepository[FacturaItem]):
    """
    Repository for FacturaItem. No soft delete (lifecycle follows Factura).

    NOTE: FacturaItem inherits only TimestampUUIDMixin (no SoftDeleteMixin),
    so BaseRepository.soft_delete raises AttributeError as expected.
    """

    def __init__(self, session: Session) -> None:
        super().__init__(session, FacturaItem)

    def list_by_factura(self, factura_id: uuid.UUID) -> list[FacturaItem]:
        """List all items belonging to a specific invoice."""
        statement = select(FacturaItem).where(FacturaItem.factura_id == factura_id)
        return list(self.session.exec(statement).all())

    def create(self, **data) -> FacturaItem:  # type: ignore[override]
        """Create and flush a FacturaItem. Caller commits."""
        return super().create(**data)


__all__ = ["FacturaRepository", "FacturaItemRepository"]
