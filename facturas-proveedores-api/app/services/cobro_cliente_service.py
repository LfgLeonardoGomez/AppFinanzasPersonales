"""
CobroClienteService — business logic for customer payment management (C-35).

All authorization lives here, scoped by `negocio_id`; a payment or a customer
from another negocio is 404, never 403 (D-06). Never `usuario_id` as a filter;
`creado_por_usuario_id` is authorship only.

The rule this service exists to enforce is RN-CCC-04: a payment can never
drive the customer's balance below zero.

Design decisions (design.md D3, D8):
- D3: available balance excludes the payment being edited, so raising an
  existing payment is judged on the DIFFERENCE, not compared against a
  balance that already contains its own old value.
- D8: cliente_id is immutable on PATCH — the schema simply does not declare
  the field (see app/schemas/cobro_cliente.py), so this service never
  receives it as something to change.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.cliente import Cliente
from app.models.cobro_cliente import CobroCliente
from app.repositories.cliente_repository import ClienteRepository
from app.repositories.cobro_cliente_repository import CobroClienteRepository
from app.repositories.venta_repository import VentaRepository
from app.schemas.cobro_cliente import CobroClienteCreate, CobroClienteUpdate

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Cobro not found",
)

_CLIENTE_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Cliente not found",
)

_FUTURE_FECHA = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail="La fecha no puede ser futura.",
)

_NON_POSITIVE_MONTO = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail="El monto debe ser mayor a cero.",
)


class CobroClienteService:
    """
    Business logic for customer-payment CRUD.

    All public methods take negocio_id as the first argument after self.
    The router passes get_current_user.negocio_id here — never from the
    request body.
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = CobroClienteRepository(session)
        self._cliente_repo = ClienteRepository(session)
        self._venta_repo = VentaRepository(session)

    # ── Private helpers ────────────────────────────────────────────────────

    def _get_owned_cobro(
        self, negocio_id: uuid.UUID, cobro_id: uuid.UUID
    ) -> CobroCliente:
        """Fetch a cobro by id, verifying ownership and active status."""
        entity = self._repo.get(cobro_id)
        if (
            entity is None
            or entity.deleted_at is not None
            or entity.negocio_id != negocio_id
        ):
            raise _NOT_FOUND
        return entity

    def _get_owned_cliente(
        self, negocio_id: uuid.UUID, cliente_id: uuid.UUID
    ) -> Cliente:
        """Fetch a cliente by id, verifying ownership and active status."""
        entity = self._cliente_repo.get(negocio_id, cliente_id)
        if entity is None:
            raise _CLIENTE_NOT_FOUND
        return entity

    @staticmethod
    def _validate_fecha_not_future(fecha: date) -> None:
        """Validate fecha <= today(UTC-3 wall clock)."""
        today_ar = datetime.now(_TZ_AR).date()
        if fecha > today_ar:
            raise _FUTURE_FECHA

    @staticmethod
    def _validate_monto_positive(monto: Decimal) -> None:
        """Defense-in-depth beyond Pydantic's Field(gt=0)."""
        if monto <= Decimal("0"):
            raise _NON_POSITIVE_MONTO

    def _saldo_disponible(
        self,
        negocio_id: uuid.UUID,
        cliente_id: uuid.UUID,
        excluir_cobro_id: Optional[uuid.UUID] = None,
    ) -> Decimal:
        """
        Available balance for a new/edited payment (RN-CCC-04, D3).

        = SUM(fiados activos) - SUM(cobros activos, excluding the one
        being edited).
        """
        fiados = self._venta_repo.listar_fiadas_de_cliente(negocio_id, cliente_id)
        total_fiados = sum((v.monto for v in fiados), Decimal("0"))

        cobros = self._repo.listar_de_cliente(negocio_id, cliente_id)
        total_cobros = sum(
            (c.monto for c in cobros if c.id != excluir_cobro_id), Decimal("0")
        )

        return total_fiados - total_cobros

    @staticmethod
    def _rechazo_por_saldo(disponible: Decimal) -> HTTPException:
        """422 stating the outstanding balance, so it can be corrected."""
        disponible_fmt = disponible.quantize(Decimal("0.01"))
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"El pago supera el saldo pendiente del cliente. "
                f"Saldo disponible: {disponible_fmt}."
            ),
        )

    # ── Public API ─────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        datos: CobroClienteCreate,
        creado_por_usuario_id: uuid.UUID | None = None,
    ) -> CobroCliente:
        """
        Create a new payment for a customer owned by negocio_id.

        Validates (in order):
        - cliente exists, is active, and belongs to negocio_id.
        - fecha not in the future (UTC-3 wall clock).
        - monto > 0 (defense in depth).
        - RN-CCC-04: monto does not exceed the available balance.
        """
        cliente = self._get_owned_cliente(negocio_id, datos.cliente_id)
        self._validate_fecha_not_future(datos.fecha)
        self._validate_monto_positive(datos.monto)

        disponible = self._saldo_disponible(negocio_id, cliente.id)
        if datos.monto > disponible:
            raise self._rechazo_por_saldo(disponible)

        cobro = self._repo.create(
            negocio_id=negocio_id,
            creado_por_usuario_id=creado_por_usuario_id,
            cliente_id=cliente.id,
            monto=datos.monto,
            fecha=datos.fecha,
            metodo=datos.metodo,
            comprobante_url=datos.comprobante_url,
        )
        return cobro

    def listar(
        self,
        negocio_id: uuid.UUID,
        cliente_id: Optional[uuid.UUID] = None,
        page: int = 1,
        page_size: int = 50,
    ) -> tuple[list[CobroCliente], int]:
        """
        Return paginated active payments for the negocio.

        A foreign cliente_id is treated as if it does not exist (404), never
        as an empty list — same pattern as PagoService.listar.
        """
        if cliente_id is not None:
            self._get_owned_cliente(negocio_id, cliente_id)

        return self._repo.listar(
            negocio_id, page=page, page_size=page_size, cliente_id=cliente_id
        )

    def get(self, negocio_id: uuid.UUID, cobro_id: uuid.UUID) -> CobroCliente:
        """Return a single payment owned by negocio_id."""
        return self._get_owned_cobro(negocio_id, cobro_id)

    def actualizar(
        self,
        negocio_id: uuid.UUID,
        cobro_id: uuid.UUID,
        datos: CobroClienteUpdate,
    ) -> CobroCliente:
        """
        Partially update a payment owned by negocio_id.

        Only fields explicitly set (non-None) are applied. cliente_id is not
        accepted (D8 — the schema has no such field). Re-validates monto > 0
        and fecha <= today(UTC-3), then re-checks RN-CCC-04 with the balance
        computed EXCLUDING this payment's current amount (D3).
        """
        cobro = self._get_owned_cobro(negocio_id, cobro_id)

        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            return cobro

        if "monto" in update_data and update_data["monto"] is not None:
            self._validate_monto_positive(update_data["monto"])
        if "fecha" in update_data and update_data["fecha"] is not None:
            self._validate_fecha_not_future(update_data["fecha"])

        monto_final = update_data.get("monto", cobro.monto)
        disponible = self._saldo_disponible(
            negocio_id, cobro.cliente_id, excluir_cobro_id=cobro.id
        )
        if monto_final > disponible:
            raise self._rechazo_por_saldo(disponible)

        return self._repo.update(cobro, **update_data)

    def eliminar(self, negocio_id: uuid.UUID, cobro_id: uuid.UUID) -> dict:
        """
        Soft-delete a payment owned by negocio_id.

        The row is preserved (FK integrity). After this, the balance, the
        FIFO pool and the history immediately exclude it.
        """
        self._get_owned_cobro(negocio_id, cobro_id)
        self._repo.soft_delete(cobro_id)
        return {"id": cobro_id}


__all__ = ["CobroClienteService"]
