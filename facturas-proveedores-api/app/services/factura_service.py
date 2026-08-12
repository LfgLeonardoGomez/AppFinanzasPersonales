"""
FacturaService — business logic for invoice management.

Design decisions implemented (C-08 design.md):
- D1: _compute_estado_fifo is a PURE FUNCTION. No DB access inside it.
  Receives facturas (pre-ordered by FIFO order) and the payment pool (Decimal).
  Returns dict[factura_id → EstadoFactura].
- D2: Payment pool aggregated in Python from PagoRepository rows. No DB aggregate.
- D3: listar without proveedor_id groups facturas by proveedor and computes FIFO
  per group (avoids N+1: one SQL for all facturas + one per distinct proveedor for pagos).
- D5: fecha_emision validated against UTC-3 wall clock in the service layer.
- D6: items sum mismatch → warning flag, not rejection.
- D7: Ownership check in the SERVICE layer — foreign resource → 404 (never 403).
- D8: Router stays thin; this service raises HTTPExceptions directly.

Hard rules enforced here:
- negocio_id is ALWAYS taken from the service arg, never from the payload.
- All authorization lives HERE; router just wires Depends(get_current_user).
- Raises HTTPException(404) on foreign or missing/deleted resource.
- NEVER persists estado or saldo.
- NEVER filters by estado in SQL (RN-FAC-09); filters in Python after FIFO.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.enums import EstadoFactura, OrigenDocumento
from app.models.factura import Factura, FacturaItem
from app.repositories.factura_repository import FacturaItemRepository, FacturaRepository
from app.repositories.pago_repository import PagoRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.factura import FacturaCreate, FacturaUpdate
from app.services.cuenta_corriente_engine import Movimiento, asignar_fifo

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Factura not found",
)

_PROVEEDOR_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Proveedor not found",
)


# ── Pure FIFO algorithm (D1, RN-FIFO) ────────────────────────────────────────


def _compute_estado_fifo(
    facturas: list,
    pool: Decimal,
) -> dict[uuid.UUID, EstadoFactura]:
    """
    Compute the FIFO-derived estado for each factura in the list.

    Algorithm (RN-FIFO):
        pool = SUM of all active payments for the proveedor
        For each factura (in FIFO order — caller must pass pre-sorted list):
            applied = min(pool, factura.monto_total)
            pool -= applied
            applied == 0                  → PENDIENTE
            0 < applied < monto_total     → PARCIAL
            applied >= monto_total        → PAGADA

    Args:
        facturas: Factura ORM objects or mocks, pre-ordered by
                  (fecha_emision ASC, created_at ASC, id ASC). (RN-FIFO-01)
        pool:     Total Decimal sum of active payments for this proveedor. (RN-FIFO-02)

    Returns:
        dict mapping factura.id → EstadoFactura.

    NOTE: This is a thin adapter over the shared `asignar_fifo` (C-35, D1).
    The allocation loop itself lives in `cuenta_corriente_engine` — this
    function only maps Factura rows in and EstadoFactura out. Signature,
    name and return type are unchanged from before the extraction.
    """
    movimientos = [
        Movimiento(
            id=factura.id,
            fecha=factura.fecha_emision,
            created_at=factura.created_at,
            monto=factura.monto_total,
        )
        for factura in facturas
    ]
    aplicado_por_id = asignar_fifo(movimientos, pool)

    result: dict[uuid.UUID, EstadoFactura] = {}
    for factura in facturas:
        applied = aplicado_por_id[factura.id]

        if applied <= Decimal("0"):
            estado = EstadoFactura.PENDIENTE
        elif applied >= factura.monto_total:
            estado = EstadoFactura.PAGADA
        else:
            estado = EstadoFactura.PARCIAL

        result[factura.id] = estado

    return result


# ── Result container ──────────────────────────────────────────────────────────


class FacturaConEstado:
    """
    Combines a Factura ORM entity with its computed estado and items.

    Used so callers can map directly to FacturaResponse.model_validate(obj).
    """

    def __init__(
        self,
        factura: Factura,
        estado: EstadoFactura,
        items: list[FacturaItem],
        items_sum_mismatch: bool = False,
    ) -> None:
        self._factura = factura
        self.estado = estado
        self.items = items
        self.items_sum_mismatch = items_sum_mismatch

    def __getattr__(self, name: str):
        return getattr(self._factura, name)


class FacturaListItemResult:
    """Lean result for listing — factura + estado only."""

    def __init__(self, factura: Factura, estado: EstadoFactura) -> None:
        self._factura = factura
        self.estado = estado

    def __getattr__(self, name: str):
        return getattr(self._factura, name)


# ── FacturaService ────────────────────────────────────────────────────────────


class FacturaService:
    """
    Business logic for invoice CRUD.

    All public methods take negocio_id as the first argument after self.
    The router passes get_current_user.id here — never from the request body.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = FacturaRepository(session)
        self._item_repo = FacturaItemRepository(session)
        self._pago_repo = PagoRepository(session)
        self._prov_repo = ProveedorRepository(session)

    # ── Private helpers ────────────────────────────────────────────────────────

    def _get_owned_factura(
        self, negocio_id: uuid.UUID, factura_id: uuid.UUID
    ) -> Factura:
        """
        Fetch a factura by id, verifying ownership and active status.

        Raises HTTPException(404) if:
        - Not found at all.
        - Belongs to a different user (enumeration leak prevention, D7).
        - Is soft-deleted.
        """
        entity = self._repo.get(factura_id)
        if (
            entity is None
            or entity.deleted_at is not None
            or entity.negocio_id != negocio_id
        ):
            raise _NOT_FOUND
        return entity

    def _get_owned_proveedor(
        self, negocio_id: uuid.UUID, proveedor_id: uuid.UUID
    ):
        """
        Fetch a proveedor by id, verifying ownership and active status.

        Raises HTTPException(404) if not found, soft-deleted, or foreign.
        """
        entity = self._prov_repo.get(proveedor_id)
        if (
            entity is None
            or entity.deleted_at is not None
            or entity.negocio_id != negocio_id
        ):
            raise _PROVEEDOR_NOT_FOUND
        return entity

    @staticmethod
    def _validate_fecha_emision(fecha_emision: date) -> None:
        """
        Validate fecha_emision is not in the future (UTC-3 wall clock).

        Uses America/Argentina/Buenos_Aires (UTC-3, no DST) as required
        by the spec (D5, RN-FAC-02).
        """
        today_ar = datetime.now(_TZ_AR).date()
        if fecha_emision > today_ar:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="fecha_emision must not be in the future (UTC-3)",
            )

    @staticmethod
    def _check_items_sum(
        monto_total: Decimal,
        items_data: list,
    ) -> bool:
        """
        Return True if sum(items) != monto_total (non-blocking warning, RN-FAC-04).

        Never rejects — caller includes this flag in the response.
        """
        if not items_data:
            return False
        total = sum(
            Decimal(str(item.get("cantidad", 0))) * Decimal(str(item.get("precio_unitario", 0)))
            for item in items_data
        )
        return total != monto_total

    def _get_payment_pool(
        self, negocio_id: uuid.UUID, proveedor_id: uuid.UUID
    ) -> Decimal:
        """Aggregate all active payments for a proveedor into a single Decimal pool."""
        pagos = self._pago_repo.list_by_proveedor(negocio_id, proveedor_id)
        return sum((p.monto for p in pagos), Decimal("0"))

    # ── Public API ─────────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        datos: FacturaCreate,
        creado_por_usuario_id: uuid.UUID | None = None,
    ) -> FacturaConEstado:
        """
        Create a new invoice for a supplier owned by negocio_id.

        Validates:
        - Proveedor exists and belongs to negocio_id (D7, HARD RULE 3).
        - fecha_emision not future (D5, RN-FAC-02).
        - monto_total > 0 (already validated by Pydantic, re-checked here).
        - items sum mismatch → warning flag, not block (RN-FAC-04).

        Sets origen=MANUAL (RN-FAC-08 — service sets automatically).
        negocio_id taken from arg, never from payload (HARD RULE).
        """
        proveedor = self._get_owned_proveedor(negocio_id, datos.proveedor_id)
        self._validate_fecha_emision(datos.fecha_emision)

        items_data = [
            {
                "descripcion": item.descripcion,
                "cantidad": item.cantidad,
                "precio_unitario": item.precio_unitario,
            }
            for item in datos.items
        ]

        items_sum_mismatch = self._check_items_sum(datos.monto_total, items_data)

        factura = self._repo.create_with_items(
            negocio_id=negocio_id,
            creado_por_usuario_id=creado_por_usuario_id,
            proveedor_id=proveedor.id,
            fecha_emision=datos.fecha_emision,
            monto_total=datos.monto_total,
            origen=datos.origen or OrigenDocumento.MANUAL,
            items_data=items_data,
            numero=datos.numero,
            fecha_vencimiento=datos.fecha_vencimiento,
            archivo_url=datos.archivo_url,
        )

        # Compute FIFO estado for this new factura
        pool = self._get_payment_pool(negocio_id, proveedor.id)
        all_facturas = self._repo.list_by_proveedor(negocio_id, proveedor.id)
        estado_map = _compute_estado_fifo(all_facturas, pool)
        estado = estado_map.get(factura.id, EstadoFactura.PENDIENTE)

        items = self._item_repo.list_by_factura(factura.id)
        return FacturaConEstado(factura, estado, items, items_sum_mismatch)

    def get(
        self,
        negocio_id: uuid.UUID,
        factura_id: uuid.UUID,
    ) -> FacturaConEstado:
        """
        Return a single invoice with its computed estado and items.

        Raises 404 if the invoice belongs to another user or is soft-deleted.
        """
        factura = self._get_owned_factura(negocio_id, factura_id)

        pool = self._get_payment_pool(negocio_id, factura.proveedor_id)
        all_facturas = self._repo.list_by_proveedor(
            negocio_id, factura.proveedor_id
        )
        estado_map = _compute_estado_fifo(all_facturas, pool)
        estado = estado_map.get(factura_id, EstadoFactura.PENDIENTE)

        items = self._item_repo.list_by_factura(factura_id)
        return FacturaConEstado(factura, estado, items)

    def listar(
        self,
        negocio_id: uuid.UUID,
        proveedor_id: Optional[uuid.UUID] = None,
        estado_filtro: Optional[EstadoFactura] = None,
        fecha_desde: Optional[date] = None,
        fecha_hasta: Optional[date] = None,
    ) -> list[FacturaListItemResult]:
        """
        Return invoices for the user, with FIFO estado computed in memory.

        Key rule (RN-FAC-09): NEVER filter by estado in SQL.
        All facturas are fetched first; FIFO estado is computed in Python;
        estado_filtro is applied AFTER computation.

        When proveedor_id is None, fetches all user's facturas and computes
        FIFO per distinct proveedor group (D3 — avoids N+1 per factura).
        """
        # Fetch all matching facturas (SQL filters: usuario, proveedor, dates)
        facturas = self._repo.list_by_negocio(negocio_id, proveedor_id=proveedor_id)

        # Apply date range filter in Python (not SQL — consistent with FIFO)
        if fecha_desde is not None:
            facturas = [f for f in facturas if f.fecha_emision >= fecha_desde]
        if fecha_hasta is not None:
            facturas = [f for f in facturas if f.fecha_emision <= fecha_hasta]

        if not facturas:
            return []

        # Group facturas by proveedor_id for FIFO computation
        by_proveedor: dict[uuid.UUID, list] = {}
        for f in facturas:
            by_proveedor.setdefault(f.proveedor_id, []).append(f)

        # For each distinct proveedor, compute FIFO on ALL its active facturas
        # (not just the filtered subset — filtering by date would break FIFO)
        # We need the full ordered list for each proveedor to compute correct estado.
        estado_map: dict[uuid.UUID, EstadoFactura] = {}
        for prov_id in by_proveedor:
            all_prov_facturas = self._repo.list_by_proveedor(negocio_id, prov_id)
            pool = self._get_payment_pool(negocio_id, prov_id)
            prov_estados = _compute_estado_fifo(all_prov_facturas, pool)
            estado_map.update(prov_estados)

        # Build results for the requested facturas only
        results = [
            FacturaListItemResult(f, estado_map.get(f.id, EstadoFactura.PENDIENTE))
            for f in facturas
        ]

        # Apply estado filter IN PYTHON (RN-FAC-09: never SQL WHERE estado=...)
        if estado_filtro is not None:
            results = [r for r in results if r.estado == estado_filtro]

        return results

    def actualizar(
        self,
        negocio_id: uuid.UUID,
        factura_id: uuid.UUID,
        datos: FacturaUpdate,
    ) -> FacturaConEstado:
        """
        Partially update an invoice (PATCH semantics).

        Only provided (non-None) fields are applied.
        If items is provided (even empty list), items are replaced atomically (D4).
        Raises 404 on foreign or missing/deleted invoice.
        """
        factura = self._get_owned_factura(negocio_id, factura_id)

        update_data = datos.model_dump(exclude_unset=True)

        # Validate fecha_emision if provided
        if "fecha_emision" in update_data and update_data["fecha_emision"] is not None:
            self._validate_fecha_emision(update_data["fecha_emision"])

        # Separate items from field updates
        new_items_data: Optional[list] = None
        if "items" in update_data:
            raw_items = update_data.pop("items")
            if raw_items is not None:
                # model_dump produces dicts for nested models; accept both
                new_items_data = []
                for item in raw_items:
                    if isinstance(item, dict):
                        new_items_data.append(item)
                    else:
                        new_items_data.append(
                            {
                                "descripcion": item.descripcion,
                                "cantidad": item.cantidad,
                                "precio_unitario": item.precio_unitario,
                            }
                        )

        updated = self._repo.update_with_items(
            factura,
            new_items_data=new_items_data,
            **update_data,
        )

        # Check items sum mismatch with new monto_total
        current_monto = updated.monto_total
        if new_items_data is not None:
            items_sum_mismatch = self._check_items_sum(current_monto, new_items_data)
        else:
            items_sum_mismatch = False

        pool = self._get_payment_pool(negocio_id, updated.proveedor_id)
        all_facturas = self._repo.list_by_proveedor(negocio_id, updated.proveedor_id)
        estado_map = _compute_estado_fifo(all_facturas, pool)
        estado = estado_map.get(factura_id, EstadoFactura.PENDIENTE)

        items = self._item_repo.list_by_factura(factura_id)
        return FacturaConEstado(updated, estado, items, items_sum_mismatch)

    def eliminar(
        self,
        negocio_id: uuid.UUID,
        factura_id: uuid.UUID,
    ) -> dict:
        """
        Soft-delete an invoice owned by negocio_id.

        Raises 404 on foreign, missing, or already-deleted invoice.
        Returns {"id": factura_id}.
        """
        factura = self._get_owned_factura(negocio_id, factura_id)
        self._repo.soft_delete(factura.id)
        return {"id": factura.id}


__all__ = ["FacturaService", "_compute_estado_fifo", "FacturaConEstado"]
