"""
PagoService — business logic for payment management.

Design decisions (C-10 design.md):
- D3: _get_owned_pago(negocio_id, pago_id) → Pago raises 404 on missing,
  foreign, or soft-deleted. Single place that reads a Pago by id from the
  service layer.
- D4: Defense-in-depth validation beyond Pydantic — monto > 0, fecha
  ≤ today(UTC-3), proveedor ownership, soft-delete status.
- D5: crear stamps origen=OrigenDocumento.MANUAL automatically. Schema
  has no origen field — the service controls it.
- D6: listar paginates and orders by fecha DESC, created_at DESC, id DESC.
- D7: actualizar is PATCH semantics — only non-None fields are applied.
  proveedor_id is NOT changeable via PATCH (would corrupt FIFO history).
- D8: eliminar is soft delete — row preserved, FKs intact. Soft-deleted
  pagos are excluded from the C-08 FIFO pool (PagoRepository.list_by_proveedor
  filters deleted_at IS NULL by default).

Hard rules enforced here:
- negocio_id is ALWAYS taken from the service arg, never from the payload.
- All authorization lives HERE; router just wires Depends(get_current_user).
- Raises HTTPException(404) on foreign/missing/deleted resource.
- NEVER persists saldo or estado.

C-43 Fase A adds an optional idempotency key to `crear`. Same discipline as
`venta_service` (C-42, design.md D3): validate first, INSERT, catch the
IntegrityError, roll back, then decide. Never a SELECT before the INSERT —
pagos have no validation that reads what the write itself changes, so the
fast-path exception carved out for cobros (design.md D2) does not apply here.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models.enums import OrigenDocumento
from app.models.pago import Pago
from app.models.proveedor import Proveedor
from app.repositories.pago_repository import PagoRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.pago import PagoCreate, PagoUpdate
from app.services.idempotencia import es_violacion_de

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

# The one constraint this module knows how to translate into a reply instead
# of a 500. Any other name means the IntegrityError is not idempotency's to
# handle — it propagates as-is (task 4.11, mirrors venta_service task 4.13).
_UQ_IDEMPOTENCY_KEY = "uq_pago_negocio_idempotency_key"

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Pago not found",
)

_PROVEEDOR_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Proveedor not found",
)

_FUTURE_FECHA = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail="fecha must not be in the future (UTC-3)",
)

_NON_POSITIVE_MONTO = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail="monto must be greater than zero",
)


def _conflicto_pago(existente: Pago) -> HTTPException:
    """409 carrying the existing payment (design.md D3, mirrors _conflicto_venta)."""
    detalle: dict = {
        "mensaje": "Esta operación ya fue registrada con otros datos.",
        "pago_existente": {
            "id": str(existente.id),
            "proveedor_id": str(existente.proveedor_id),
            "monto": str(existente.monto),
            "fecha": existente.fecha.isoformat(),
            "metodo": existente.metodo,
            "comprobante_url": existente.comprobante_url,
            "origen": existente.origen,
        },
    }
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


def _mismos_datos(
    existente: Pago,
    proveedor_id: uuid.UUID,
    monto: Decimal,
    fecha: date,
    metodo,
    comprobante_url: Optional[str],
    origen: OrigenDocumento,
) -> bool:
    """
    design.md D3 — comparison happens against the fields of the SAVED row.
    `origen` is compared RESOLVED (MANUAL when the payload omits it), never
    against the raw payload — a repeat that omits origen would otherwise
    conflict against its own row (task 4.5).
    """
    return (
        existente.proveedor_id == proveedor_id
        and existente.monto == monto
        and existente.fecha == fecha
        and existente.metodo == metodo
        and existente.comprobante_url == comprobante_url
        and existente.origen == origen
    )


class PagoCreado:
    """
    Wraps a `Pago` with whether THIS call created it or replayed an existing
    one (C-43, mirrors VentaCreada from C-42). The router uses `es_repeticion`
    to decide between `201` and `200` + `Idempotent-Replay: true`.

    Unlike VentaCreada, this wrapper DOES proxy unknown attribute access to
    the wrapped Pago via `__getattr__`. VentaCreada could afford to be a
    strict wrapper because idempotency was net-new for ventas — no call site
    existed yet that read a bare attribute off `crear()`'s return value. Here
    `PagoService.crear` already had callers (test_pago_service.py, and
    anything built on top of it) written against "crear returns a Pago", so
    breaking that contract would fail task 1.2's requirement that those
    suites stay green WITHOUT being edited. Proxying keeps `result.monto`,
    `result.proveedor_id`, etc. working exactly as before; `.pago` and
    `.es_repeticion` are the two names new code should read explicitly.
    """

    def __init__(self, pago: Pago, es_repeticion: bool) -> None:
        self.pago = pago
        self.es_repeticion = es_repeticion

    def __getattr__(self, name: str) -> Any:
        return getattr(self.pago, name)


class PagoService:
    """
    Business logic for payment CRUD.

    All public methods take negocio_id as the first argument after self.
    The router passes get_current_user.id here — never from the request body.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = PagoRepository(session)
        self._prov_repo = ProveedorRepository(session)

    # ── Private helpers (D3, D4) ───────────────────────────────────────────────

    def _get_owned_pago(
        self, negocio_id: uuid.UUID, pago_id: uuid.UUID
    ) -> Pago:
        """
        Fetch a pago by id, verifying ownership and active status.

        Raises HTTPException(404) if:
        - Not found at all.
        - Belongs to a different user (enumeration leak prevention).
        - Is soft-deleted.
        """
        entity = self._repo.get(pago_id)
        if (
            entity is None
            or entity.deleted_at is not None
            or entity.negocio_id != negocio_id
        ):
            raise _NOT_FOUND
        return entity

    def _get_owned_proveedor(
        self, negocio_id: uuid.UUID, proveedor_id: uuid.UUID
    ) -> Proveedor:
        """
        Fetch a proveedor by id, verifying ownership and active status.

        Raises HTTPException(404) if not found, soft-deleted, or foreign.
        Used by crear to validate the supplier before persisting a payment.
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
    def _validate_fecha_not_future(fecha: date) -> None:
        """
        Validate fecha ≤ today(UTC-3 wall clock).

        Uses America/Argentina/Buenos_Aires (UTC-3, no DST) as required
        by the spec (D5, RN-PAG-03). Pydantic alone can't know "today" in
        the right zone — this is the service-layer enforcement.
        """
        today_ar = datetime.now(_TZ_AR).date()
        if fecha > today_ar:
            raise _FUTURE_FECHA

    @staticmethod
    def _validate_monto_positive(monto: Decimal) -> None:
        """
        Defense-in-depth: Pydantic already rejects monto <= 0, but the
        service re-validates in case a future field bypasses Pydantic.
        """
        if monto <= Decimal("0"):
            raise _NON_POSITIVE_MONTO

    # ── Public API ─────────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        datos: PagoCreate,
        creado_por_usuario_id: uuid.UUID | None = None,
        idempotency_key: Optional[uuid.UUID] = None,
    ) -> PagoCreado:
        """
        Create a new payment for a supplier owned by negocio_id.

        Validates (in order):
        - proveedor exists, is active, and belongs to negocio_id (D3, D7).
        - fecha not in the future (UTC-3 wall clock, D5, RN-PAG-03).
        - monto > 0 (defense in depth, RN-PAG-02).

        Stamps origen=MANUAL automatically (D5, RN-PAG-04). negocio_id is
        taken from the arg — never from the payload.

        `idempotency_key` is optional (C-43): when it is None, this method's
        behavior is byte-for-byte what it was before this change — including
        that an IntegrityError propagates unhandled (task 4.1). When a key IS
        given, business validation still runs first: a rejected payment never
        touches the database, and its key stays free for a corrected retry
        (task 4.8). No fast-path lookup — unlike cobros (design.md D2),
        nothing here reads what this write itself changes.
        """
        proveedor = self._get_owned_proveedor(negocio_id, datos.proveedor_id)
        self._validate_fecha_not_future(datos.fecha)
        self._validate_monto_positive(datos.monto)

        origen_resuelto = datos.origen or OrigenDocumento.MANUAL

        try:
            pago = self._repo.create(
                negocio_id=negocio_id,
                creado_por_usuario_id=creado_por_usuario_id,
                proveedor_id=proveedor.id,
                monto=datos.monto,
                fecha=datos.fecha,
                metodo=datos.metodo,
                comprobante_url=datos.comprobante_url,
                origen=origen_resuelto,
                idempotency_key=idempotency_key,
            )
            return PagoCreado(pago, es_repeticion=False)
        except IntegrityError as err:
            if idempotency_key is None:
                raise

            if not es_violacion_de(err, _UQ_IDEMPOTENCY_KEY):
                raise

            # The INSERT poisoned the session; every statement after it
            # raises PendingRollbackError until this runs (task 4.10).
            self._session.rollback()

            existente = self._repo.get_by_idempotency_key(negocio_id, idempotency_key)
            if existente is None:
                # The unique index says this key is taken, scoped to this
                # negocio, yet the scoped read found nothing. Unreachable in
                # practice; re-raising is safer than inventing a response
                # this branch cannot justify.
                raise

            if existente.deleted_at is not None:
                # The payment behind this key is gone. Replaying it would
                # pass a deleted row off as live (task 4.6).
                raise _conflicto_pago(existente)

            if _mismos_datos(
                existente,
                proveedor.id,
                datos.monto,
                datos.fecha,
                datos.metodo,
                datos.comprobante_url,
                origen_resuelto,
            ):
                return PagoCreado(existente, es_repeticion=True)

            raise _conflicto_pago(existente)

    def listar(
        self,
        negocio_id: uuid.UUID,
        proveedor_id: Optional[uuid.UUID] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[Pago], int]:
        """
        Return paginated active payments for the user (D6).

        Excludes soft-deleted pagos. When proveedor_id is provided, the
        list is filtered to that supplier. Returns (items, total) where
        total is the count of all matching active payments.

        IMPORTANT: When proveedor_id is provided and is FOREIGN (belongs
        to another user), the service treats it as if it doesn't exist
        and returns an empty list rather than leaking. Foreign proveedor
        access is enforced by `_get_owned_proveedor` only on create.
        """
        if proveedor_id is not None:
            # Validate the proveedor belongs to the user (returns 404 on
            # foreign — same pattern as crear). Avoids leaking a foreign
            # proveedor's existence via the listing.
            self._get_owned_proveedor(negocio_id, proveedor_id)

        return self._repo.list_by_negocio(
            negocio_id,
            page=page,
            page_size=page_size,
            proveedor_id=proveedor_id,
        )

    def get(
        self,
        negocio_id: uuid.UUID,
        pago_id: uuid.UUID,
    ) -> Pago:
        """
        Return a single payment owned by negocio_id (D3).

        Raises HTTPException(404) if missing, soft-deleted, or foreign.
        """
        return self._get_owned_pago(negocio_id, pago_id)

    def actualizar(
        self,
        negocio_id: uuid.UUID,
        pago_id: uuid.UUID,
        datos: PagoUpdate,
    ) -> Pago:
        """
        Partially update a payment owned by negocio_id (D7).

        Only fields explicitly set (non-None) are applied. proveedor_id
        is NOT changeable via this method (would corrupt the FIFO pool's
        history). negocio_id and origen are immutable.

        Re-validates monto > 0 and fecha ≤ today(UTC-3) when provided.
        """
        pago = self._get_owned_pago(negocio_id, pago_id)

        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            # Empty patch is a no-op — return the current state
            return pago

        if "monto" in update_data and update_data["monto"] is not None:
            self._validate_monto_positive(update_data["monto"])

        if "fecha" in update_data and update_data["fecha"] is not None:
            self._validate_fecha_not_future(update_data["fecha"])

        updated = self._repo.update(pago, **update_data)
        return updated

    def eliminar(
        self,
        negocio_id: uuid.UUID,
        pago_id: uuid.UUID,
    ) -> dict:
        """
        Soft-delete a payment owned by negocio_id (D8).

        Raises HTTPException(404) if the payment is missing, soft-deleted,
        or foreign. The row is preserved in the DB (FK integrity). After
        this, the next call to `PagoRepository.list_by_proveedor` (used by
        the C-08 `FacturaService` FIFO pool) automatically excludes it.
        """
        # Use _get_owned_pago so soft-deleted pagos → 404 (D8).
        self._get_owned_pago(negocio_id, pago_id)
        self._repo.soft_delete(pago_id)
        return {"id": pago_id}


__all__ = ["PagoService", "PagoCreado"]
