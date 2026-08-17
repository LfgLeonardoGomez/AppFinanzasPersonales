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

C-43 Fase A adds an optional idempotency key to `crear`. Same INSERT-first
discipline as pago/venta (design.md D3): nothing here reads what the write
itself changes, so no fast-path lookup is needed. What IS different from
pago/venta (design.md D4): the replay branch recomputes the FIFO `estado`
and rereads the items at response time, by the SAME path as a creation —
never a frozen copy of the original response. And the "same data" comparison
(design.md D3) includes the items, compared as an ordered list.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models.enums import EstadoFactura, OrigenDocumento
from app.models.factura import Factura, FacturaItem
from app.repositories.factura_repository import FacturaItemRepository, FacturaRepository
from app.repositories.pago_repository import PagoRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.factura import FacturaCreate, FacturaUpdate
from app.services.cuenta_corriente_engine import Movimiento, asignar_fifo
from app.services.idempotencia import es_violacion_de

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

# The one constraint this module knows how to translate into a reply instead
# of a 500 (task 6.13, mirrors venta_service / pago_service).
_UQ_IDEMPOTENCY_KEY = "uq_factura_negocio_idempotency_key"

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Factura not found",
)

_PROVEEDOR_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Proveedor not found",
)


def _conflicto_factura(existente: Factura, items: list["FacturaItem"]) -> HTTPException:
    """409 carrying the existing invoice — design.md D3, mirrors _conflicto_pago."""
    detalle: dict = {
        "mensaje": "Esta operación ya fue registrada con otros datos.",
        "factura_existente": {
            "id": str(existente.id),
            "proveedor_id": str(existente.proveedor_id),
            "fecha_emision": existente.fecha_emision.isoformat(),
            "monto_total": str(existente.monto_total),
            "numero": existente.numero,
            "fecha_vencimiento": (
                existente.fecha_vencimiento.isoformat()
                if existente.fecha_vencimiento is not None
                else None
            ),
            "archivo_url": existente.archivo_url,
            "origen": existente.origen,
            "items": [
                {
                    "descripcion": i.descripcion,
                    "cantidad": str(i.cantidad),
                    "precio_unitario": str(i.precio_unitario),
                }
                for i in items
            ],
        },
    }
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


def _items_iguales(guardados: list["FacturaItem"], pedidos: list[dict]) -> bool:
    """
    design.md D3 — items compared as an ORDERED list of
    (descripcion, cantidad, precio_unitario). A reordering, an addition, or a
    single changed field is a real correction and SHALL be a conflict, not a
    replay (task 6.5).
    """
    if len(guardados) != len(pedidos):
        return False
    guardados_tuplas = [
        (i.descripcion, i.cantidad, i.precio_unitario) for i in guardados
    ]
    pedidos_tuplas = [
        (
            p["descripcion"],
            Decimal(str(p["cantidad"])),
            Decimal(str(p["precio_unitario"])),
        )
        for p in pedidos
    ]
    return guardados_tuplas == pedidos_tuplas


def _mismos_datos(
    existente: Factura,
    items_existentes: list["FacturaItem"],
    proveedor_id: uuid.UUID,
    fecha_emision: date,
    monto_total: Decimal,
    numero: Optional[str],
    fecha_vencimiento: Optional[date],
    archivo_url: Optional[str],
    origen: OrigenDocumento,
    items_data: list[dict],
) -> bool:
    """
    design.md D3 — comparison against the fields of the SAVED row, items
    included. `items_sum_mismatch` deliberately does NOT enter here: it is a
    derived output, not an input (task 6.6).
    """
    return (
        existente.proveedor_id == proveedor_id
        and existente.fecha_emision == fecha_emision
        and existente.monto_total == monto_total
        and existente.numero == numero
        and existente.fecha_vencimiento == fecha_vencimiento
        and existente.archivo_url == archivo_url
        and existente.origen == origen
        and _items_iguales(items_existentes, items_data)
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

    C-43: `es_repeticion` tells the router whether THIS call created the row
    or replayed an existing one (design.md D3/D4), mirroring VentaCreada's
    role for ventas. Defaults to False so every pre-C-43 call site
    (crear/get/listar/actualizar, none of which know about replays) keeps
    working unchanged.
    """

    def __init__(
        self,
        factura: Factura,
        estado: EstadoFactura,
        items: list[FacturaItem],
        items_sum_mismatch: bool = False,
        es_repeticion: bool = False,
    ) -> None:
        self._factura = factura
        self.estado = estado
        self.items = items
        self.items_sum_mismatch = items_sum_mismatch
        self.es_repeticion = es_repeticion

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

    def _con_estado_actual(
        self,
        negocio_id: uuid.UUID,
        factura: Factura,
        items_sum_mismatch: bool,
        es_repeticion: bool,
    ) -> FacturaConEstado:
        """
        design.md D4 — builds the response by the SAME path for a creation
        and for a replay: recompute the FIFO estado and reread the items
        right now, never a frozen copy. Consequence accepted explicitly: a
        replay's estado can differ from the original creation's if a payment
        landed on this proveedor in between (task 6.10) — that is correct,
        not a bug, because estado is derived and never persisted (D-01).
        """
        pool = self._get_payment_pool(negocio_id, factura.proveedor_id)
        all_facturas = self._repo.list_by_proveedor(negocio_id, factura.proveedor_id)
        estado_map = _compute_estado_fifo(all_facturas, pool)
        estado = estado_map.get(factura.id, EstadoFactura.PENDIENTE)

        items = self._item_repo.list_by_factura(factura.id)
        return FacturaConEstado(
            factura, estado, items, items_sum_mismatch, es_repeticion=es_repeticion
        )

    # ── Public API ─────────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        datos: FacturaCreate,
        creado_por_usuario_id: uuid.UUID | None = None,
        idempotency_key: Optional[uuid.UUID] = None,
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

        `idempotency_key` is optional (C-43): validation runs first, same as
        pago/venta — nothing here depends on state this write changes, so
        there is no fast-path lookup (that is cobros' exception, design.md
        D2). On a genuine race, `create_with_items` flushes the `factura` row
        BEFORE any item — the unique-index collision fires there, so the
        losing thread never gets to insert a single item (task 6.12).
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
        origen_resuelto = datos.origen or OrigenDocumento.MANUAL

        try:
            factura = self._repo.create_with_items(
                negocio_id=negocio_id,
                creado_por_usuario_id=creado_por_usuario_id,
                proveedor_id=proveedor.id,
                fecha_emision=datos.fecha_emision,
                monto_total=datos.monto_total,
                origen=origen_resuelto,
                items_data=items_data,
                numero=datos.numero,
                fecha_vencimiento=datos.fecha_vencimiento,
                archivo_url=datos.archivo_url,
                idempotency_key=idempotency_key,
            )
            return self._con_estado_actual(
                negocio_id, factura, items_sum_mismatch, es_repeticion=False
            )
        except IntegrityError as err:
            if idempotency_key is None:
                raise

            if not es_violacion_de(err, _UQ_IDEMPOTENCY_KEY):
                raise

            # The failed INSERT poisoned the session (task 6.13).
            self._session.rollback()

            existente = self._repo.get_by_idempotency_key(negocio_id, idempotency_key)
            if existente is None:
                raise

            items_existentes = self._item_repo.list_by_factura(existente.id)

            if existente.deleted_at is not None:
                # design.md D3 — the invoice behind this key is gone; replay
                # would pass a deleted row off as live (task 6.7).
                raise _conflicto_factura(existente, items_existentes)

            if _mismos_datos(
                existente,
                items_existentes,
                proveedor.id,
                datos.fecha_emision,
                datos.monto_total,
                datos.numero,
                datos.fecha_vencimiento,
                datos.archivo_url,
                origen_resuelto,
                items_data,
            ):
                items_sum_mismatch_existente = self._check_items_sum(
                    existente.monto_total,
                    [
                        {
                            "descripcion": i.descripcion,
                            "cantidad": i.cantidad,
                            "precio_unitario": i.precio_unitario,
                        }
                        for i in items_existentes
                    ],
                )
                return self._con_estado_actual(
                    negocio_id,
                    existente,
                    items_sum_mismatch_existente,
                    es_repeticion=True,
                )

            raise _conflicto_factura(existente, items_existentes)

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
