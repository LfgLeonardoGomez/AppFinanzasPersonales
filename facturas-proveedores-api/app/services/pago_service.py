"""
PagoService — business logic for payment management.

Design decisions (C-10 design.md):
- D3: _get_owned_pago(usuario_id, pago_id) → Pago raises 404 on missing,
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
- usuario_id is ALWAYS taken from the service arg, never from the payload.
- All authorization lives HERE; router just wires Depends(get_current_user).
- Raises HTTPException(404) on foreign/missing/deleted resource.
- NEVER persists saldo or estado.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.enums import OrigenDocumento
from app.models.pago import Pago
from app.models.proveedor import Proveedor
from app.repositories.pago_repository import PagoRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.pago import PagoCreate, PagoUpdate

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

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


class PagoService:
    """
    Business logic for payment CRUD.

    All public methods take usuario_id as the first argument after self.
    The router passes get_current_user.id here — never from the request body.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = PagoRepository(session)
        self._prov_repo = ProveedorRepository(session)

    # ── Private helpers (D3, D4) ───────────────────────────────────────────────

    def _get_owned_pago(
        self, usuario_id: uuid.UUID, pago_id: uuid.UUID
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
            or entity.usuario_id != usuario_id
        ):
            raise _NOT_FOUND
        return entity

    def _get_owned_proveedor(
        self, usuario_id: uuid.UUID, proveedor_id: uuid.UUID
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
            or entity.usuario_id != usuario_id
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
        usuario_id: uuid.UUID,
        datos: PagoCreate,
    ) -> Pago:
        """
        Create a new payment for a supplier owned by usuario_id.

        Validates (in order):
        - proveedor exists, is active, and belongs to usuario_id (D3, D7).
        - fecha not in the future (UTC-3 wall clock, D5, RN-PAG-03).
        - monto > 0 (defense in depth, RN-PAG-02).

        Stamps origen=MANUAL automatically (D5, RN-PAG-04). usuario_id is
        taken from the arg — never from the payload.
        """
        proveedor = self._get_owned_proveedor(usuario_id, datos.proveedor_id)
        self._validate_fecha_not_future(datos.fecha)
        self._validate_monto_positive(datos.monto)

        pago = self._repo.create(
            usuario_id=usuario_id,
            proveedor_id=proveedor.id,
            monto=datos.monto,
            fecha=datos.fecha,
            metodo=datos.metodo,
            comprobante_url=datos.comprobante_url,
            origen=datos.origen or OrigenDocumento.MANUAL,
        )
        return pago

    def listar(
        self,
        usuario_id: uuid.UUID,
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
            self._get_owned_proveedor(usuario_id, proveedor_id)

        return self._repo.list_by_usuario(
            usuario_id,
            page=page,
            page_size=page_size,
            proveedor_id=proveedor_id,
        )

    def get(
        self,
        usuario_id: uuid.UUID,
        pago_id: uuid.UUID,
    ) -> Pago:
        """
        Return a single payment owned by usuario_id (D3).

        Raises HTTPException(404) if missing, soft-deleted, or foreign.
        """
        return self._get_owned_pago(usuario_id, pago_id)

    def actualizar(
        self,
        usuario_id: uuid.UUID,
        pago_id: uuid.UUID,
        datos: PagoUpdate,
    ) -> Pago:
        """
        Partially update a payment owned by usuario_id (D7).

        Only fields explicitly set (non-None) are applied. proveedor_id
        is NOT changeable via this method (would corrupt the FIFO pool's
        history). usuario_id and origen are immutable.

        Re-validates monto > 0 and fecha ≤ today(UTC-3) when provided.
        """
        pago = self._get_owned_pago(usuario_id, pago_id)

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
        usuario_id: uuid.UUID,
        pago_id: uuid.UUID,
    ) -> dict:
        """
        Soft-delete a payment owned by usuario_id (D8).

        Raises HTTPException(404) if the payment is missing, soft-deleted,
        or foreign. The row is preserved in the DB (FK integrity). After
        this, the next call to `PagoRepository.list_by_proveedor` (used by
        the C-08 `FacturaService` FIFO pool) automatically excludes it.
        """
        # Use _get_owned_pago so soft-deleted pagos → 404 (D8).
        self._get_owned_pago(usuario_id, pago_id)
        self._repo.soft_delete(pago_id)
        return {"id": pago_id}


__all__ = ["PagoService"]
