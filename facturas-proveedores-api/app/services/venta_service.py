"""
VentaService — recording what the shop sold (C-33).

All authorization lives here, scoped by `negocio_id`; a sale or a customer from
another negocio is 404, never 403 (D-06).

The rule this service exists to keep coherent is the pair
`(forma_pago, cliente_id)`: a customer is present **if and only if** the sale
was on account. It is enforced twice on purpose, exactly like C-32's uniqueness
(D-45): here so the message explains what is wrong, and in the database CHECK so
the rule is actually true for every path — including ones written later.

The subtle half is PATCH. The pair is validated **after** applying the changes,
never field by field: switching `forma_pago` to EFECTIVO without touching
`cliente_id` has to end with no customer, not with a cash sale dragging one.
"""

import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Optional, Sequence
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.enums import FormaPago
from app.models.venta import Venta
from app.repositories.cliente_repository import ClienteRepository
from app.repositories.venta_repository import VentaRepository

_TZ_AR = ZoneInfo("America/Argentina/Buenos_Aires")

_VENTA_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Venta not found",
)

_CLIENTE_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Cliente not found",
)

_FIADO_SIN_CLIENTE = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail=(
        "Una venta en cuenta corriente necesita un cliente: sin él la deuda no "
        "es de nadie y no hay a quién cobrársela."
    ),
)

_CLIENTE_SIN_FIADO = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail=(
        "Solo las ventas en cuenta corriente llevan cliente. Si esta venta ya "
        "está cobrada, no corresponde asociarla a una cuenta."
    ),
)


class VentaService:
    """Sales CRUD, scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._repo = VentaRepository(session)
        self._cliente_repo = ClienteRepository(session)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _get_propia(self, negocio_id: uuid.UUID, venta_id: uuid.UUID) -> Venta:
        venta = self._repo.get(negocio_id, venta_id)
        if venta is None:
            raise _VENTA_NOT_FOUND
        return venta

    def _validar_par(
        self,
        negocio_id: uuid.UUID,
        forma_pago: FormaPago,
        cliente_id: Optional[uuid.UUID],
    ) -> Optional[uuid.UUID]:
        """
        Check the (forma_pago, cliente_id) pair and return the customer to store.

        Both directions are rejected. A fiado with no customer is money owed by
        nobody; a cash sale carrying a customer is noise that someone will read
        as debt later.
        """
        es_fiado = forma_pago == FormaPago.CUENTA_CORRIENTE

        if es_fiado and cliente_id is None:
            raise _FIADO_SIN_CLIENTE
        if not es_fiado and cliente_id is not None:
            raise _CLIENTE_SIN_FIADO

        if es_fiado:
            # Also pins Venta.negocio_id == Cliente.negocio_id: a customer from
            # another shop is indistinguishable from one that does not exist.
            if self._cliente_repo.get(negocio_id, cliente_id) is None:
                raise _CLIENTE_NOT_FOUND

        return cliente_id

    def _validar_fecha(self, fecha: date) -> None:
        hoy = datetime.now(_TZ_AR).date()
        if fecha > hoy:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="La fecha no puede ser futura.",
            )

    def _validar_monto(self, monto: Decimal) -> None:
        if monto <= 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="El monto debe ser mayor a cero.",
            )

    # ── lectura ───────────────────────────────────────────────────────────────

    def listar(
        self,
        negocio_id: uuid.UUID,
        desde: Optional[date] = None,
        hasta: Optional[date] = None,
        forma_pago: Optional[FormaPago] = None,
        cliente_id: Optional[uuid.UUID] = None,
    ) -> Sequence[Venta]:
        """Active sales, optionally filtered.

        A `cliente_id` from another negocio raises 404 rather than returning an
        empty list: an empty list would confirm the id is real but has no sales
        here, which is one bit more than an outsider should get.
        """
        if cliente_id is not None and self._cliente_repo.get(negocio_id, cliente_id) is None:
            raise _CLIENTE_NOT_FOUND

        return self._repo.listar(
            negocio_id,
            desde=desde,
            hasta=hasta,
            forma_pago=forma_pago,
            cliente_id=cliente_id,
        )

    def get(self, negocio_id: uuid.UUID, venta_id: uuid.UUID) -> Venta:
        return self._get_propia(negocio_id, venta_id)

    # ── escritura ─────────────────────────────────────────────────────────────

    def crear(
        self,
        negocio_id: uuid.UUID,
        monto: Decimal,
        fecha: date,
        forma_pago: FormaPago,
        cliente_id: Optional[uuid.UUID] = None,
        notas: Optional[str] = None,
        creado_por_usuario_id: Optional[uuid.UUID] = None,
    ) -> Venta:
        """Record one sale. A fiado is just one with forma_pago CUENTA_CORRIENTE."""
        self._validar_monto(monto)
        self._validar_fecha(fecha)
        cliente_final = self._validar_par(negocio_id, forma_pago, cliente_id)

        return self._repo.create(
            negocio_id=negocio_id,
            creado_por_usuario_id=creado_por_usuario_id,
            cliente_id=cliente_final,
            fecha=fecha,
            monto=monto,
            forma_pago=forma_pago,
            notas=notas,
        )

    def actualizar(
        self,
        negocio_id: uuid.UUID,
        venta_id: uuid.UUID,
        monto: Optional[Decimal] = None,
        fecha: Optional[date] = None,
        forma_pago: Optional[FormaPago] = None,
        cliente_id: Optional[uuid.UUID] = None,
        notas: Optional[str] = None,
    ) -> Venta:
        """
        Partial update, validating the RESULTING pair (D2).

        Taking a sale out of CUENTA_CORRIENTE clears `cliente_id` here rather
        than demanding the client send it as null. The common correction — "I
        was wrong, they paid me on the spot" — would otherwise fail with a
        validation error the person cannot interpret.

        Worth being aware of: that correction makes a debt disappear. The
        backend cannot forbid it — it is legitimate — so making the effect
        visible is the UI's job (C-34).
        """
        venta = self._get_propia(negocio_id, venta_id)

        if monto is not None:
            self._validar_monto(monto)
            venta.monto = monto
        if fecha is not None:
            self._validar_fecha(fecha)
            venta.fecha = fecha
        if notas is not None:
            venta.notas = notas

        forma_final = forma_pago if forma_pago is not None else venta.forma_pago

        if forma_final != FormaPago.CUENTA_CORRIENTE:
            # Leaving cuenta corriente drops the customer, whether or not the
            # caller mentioned it.
            cliente_final = None
        elif cliente_id is not None:
            cliente_final = cliente_id
        else:
            cliente_final = venta.cliente_id

        venta.cliente_id = self._validar_par(negocio_id, forma_final, cliente_final)
        venta.forma_pago = forma_final

        self._session.add(venta)
        self._session.flush()
        return venta

    def eliminar(self, negocio_id: uuid.UUID, venta_id: uuid.UUID) -> Venta:
        """
        Soft delete.

        When the sale was a fiado, its charge stops counting on the customer's
        account — the balance is computed over what is live (D-01), so there is
        nothing to reverse. That also means deleting is never a casual action,
        which is a warning the UI owes the user (C-34).
        """
        venta = self._get_propia(negocio_id, venta_id)
        venta.deleted_at = datetime.now(timezone.utc)
        self._session.add(venta)
        self._session.flush()
        return venta


__all__ = ["VentaService"]
