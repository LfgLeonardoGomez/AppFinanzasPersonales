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

C-43 Fase A (design.md D2) — THE case that breaks if the C-42 recipe
(validate → INSERT → catch IntegrityError) is copied verbatim. RN-CCC-04's
balance check is STATEFUL: it reads `venta` and `cobro_cliente`, so a cobro
that is being created enters that sum the moment it commits. A legitimate
retry that cancels more than half of what is owed would see the balance
already consumed by the ORIGINAL cobro and get rejected with 422 — an
operation that already saved, rejected as if it hadn't, on a message that
invites the person to lower the amount and create a genuine duplicate.

The fix, ONLY on this service (never on pago/factura — they have no
validation that reads what they themselves write): when a key is given,
`crear` looks the key up FIRST, before RN-CCC-04. If found, it decides
replay/conflict and returns WITHOUT touching the balance check. This is a
fast path, not a substitute for the unique index — it decides *whether to
validate*, never *whether the key is free*. The `INSERT` + `IntegrityError`
branch stays, byte for byte, exactly as the one genuine mechanism that
resolves the concurrent case (two requests, same key, neither one's fast
path finds anything because neither has committed yet) — see
test_c43_idempotencia_cobro.py::TestCarreraReal for the real two-thread,
two-Postgres-transaction proof that this branch stays reachable.
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from app.models.cliente import Cliente
from app.models.cobro_cliente import CobroCliente
from app.repositories.cliente_repository import ClienteRepository
from app.repositories.cobro_cliente_repository import CobroClienteRepository
from app.repositories.venta_repository import VentaRepository
from app.schemas.cobro_cliente import CobroClienteCreate, CobroClienteUpdate
from app.services.idempotencia import es_violacion_de

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

# The one constraint this module knows how to translate into a reply instead
# of a 500 (mirrors venta_service / pago_service / factura_service).
_UQ_IDEMPOTENCY_KEY = "uq_cobro_cliente_negocio_idempotency_key"

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


def _conflicto_cobro(existente: CobroCliente) -> HTTPException:
    """409 carrying the existing payment (design.md D3, mirrors _conflicto_pago)."""
    detalle: dict = {
        "mensaje": "Esta operación ya fue registrada con otros datos.",
        "cobro_existente": {
            "id": str(existente.id),
            "cliente_id": str(existente.cliente_id),
            "monto": str(existente.monto),
            "fecha": existente.fecha.isoformat(),
            "metodo": existente.metodo,
            "comprobante_url": existente.comprobante_url,
        },
    }
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detalle)


def _mismos_datos(
    existente: CobroCliente,
    cliente_id: uuid.UUID,
    monto: Decimal,
    fecha: date,
    metodo,
    comprobante_url: Optional[str],
) -> bool:
    """design.md D3 — comparison against the fields of the SAVED row."""
    return (
        existente.cliente_id == cliente_id
        and existente.monto == monto
        and existente.fecha == fecha
        and existente.metodo == metodo
        and existente.comprobante_url == comprobante_url
    )


class CobroCreado:
    """
    Wraps a `CobroCliente` with whether THIS call created it or replayed an
    existing one (C-43, mirrors PagoCreado). Proxies unknown attribute
    access to the wrapped row (task 1.2 — existing callers of `crear` read
    bare attributes off its return value; see PagoCreado's docstring for
    why this deviates from VentaCreada's strict no-proxy style).
    """

    def __init__(self, cobro: CobroCliente, es_repeticion: bool) -> None:
        self.cobro = cobro
        self.es_repeticion = es_repeticion

    def __getattr__(self, name: str) -> Any:
        return getattr(self.cobro, name)


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
        idempotency_key: Optional[uuid.UUID] = None,
    ) -> CobroCreado:
        """
        Create a new payment for a customer owned by negocio_id.

        Validates (in order):
        - cliente exists, is active, and belongs to negocio_id.
        - fecha not in the future (UTC-3 wall clock).
        - monto > 0 (defense in depth).
        - RN-CCC-04: monto does not exceed the available balance.

        `idempotency_key` is optional (C-43). When given, THE FIRST THING
        this method does — before even validating the cliente — is a
        fast-path lookup by key (design.md D2): RN-CCC-04's balance check is
        stateful, so on a legitimate replay it would see the balance already
        consumed by the original write and reject an operation that already
        saved. The fast path decides *whether to validate*, never *whether
        the key is free* — the unique index and the `IntegrityError` branch
        below still own that guarantee, and still resolve the genuine
        concurrent case where neither request's fast path finds anything.
        """
        if idempotency_key is not None:
            existente = self._repo.get_by_idempotency_key(negocio_id, idempotency_key)
            if existente is not None:
                if existente.deleted_at is not None:
                    # design.md D3 — the payment behind this key is gone;
                    # replaying it would pass a deleted row off as live.
                    raise _conflicto_cobro(existente)
                if _mismos_datos(
                    existente,
                    datos.cliente_id,
                    datos.monto,
                    datos.fecha,
                    datos.metodo,
                    datos.comprobante_url,
                ):
                    return CobroCreado(existente, es_repeticion=True)
                raise _conflicto_cobro(existente)

        cliente = self._get_owned_cliente(negocio_id, datos.cliente_id)
        self._validate_fecha_not_future(datos.fecha)
        self._validate_monto_positive(datos.monto)

        disponible = self._saldo_disponible(negocio_id, cliente.id)
        if datos.monto > disponible:
            raise self._rechazo_por_saldo(disponible)

        try:
            cobro = self._repo.create(
                negocio_id=negocio_id,
                creado_por_usuario_id=creado_por_usuario_id,
                cliente_id=cliente.id,
                monto=datos.monto,
                fecha=datos.fecha,
                metodo=datos.metodo,
                comprobante_url=datos.comprobante_url,
                idempotency_key=idempotency_key,
            )
            return CobroCreado(cobro, es_repeticion=False)
        except IntegrityError as err:
            if idempotency_key is None:
                raise

            if not es_violacion_de(err, _UQ_IDEMPOTENCY_KEY):
                raise

            # The failed INSERT poisoned the session — this is the branch
            # the fast path above did NOT make dead: two concurrent requests
            # with the same key both miss the fast-path lookup (neither has
            # committed yet), both reach here, and the loser lands in this
            # except.
            self._session.rollback()

            existente = self._repo.get_by_idempotency_key(negocio_id, idempotency_key)
            if existente is None:
                raise

            if existente.deleted_at is not None:
                raise _conflicto_cobro(existente)

            if _mismos_datos(
                existente,
                datos.cliente_id,
                datos.monto,
                datos.fecha,
                datos.metodo,
                datos.comprobante_url,
            ):
                return CobroCreado(existente, es_repeticion=True)

            raise _conflicto_cobro(existente)

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


__all__ = ["CobroClienteService", "CobroCreado"]
