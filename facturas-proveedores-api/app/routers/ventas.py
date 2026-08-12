"""
Sales endpoints (C-33) — /api/ventas.

No authorization logic here: the service owns it, including the
(forma_pago, cliente_id) invariant. The router wires HTTP to it.

Collection routes answer on both `""` and `"/"` without a redirect (C-27).
"""

import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.enums import FormaPago
from app.models.usuario import Usuario
from app.schemas.venta import VentaCreate, VentaResponse, VentaUpdate
from app.services.venta_service import VentaService

router = APIRouter(prefix="/api/ventas", tags=["ventas"])

CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get(
    "",
    response_model=list[VentaResponse],
    summary="List the negocio's active sales",
)
@router.get("/", response_model=list[VentaResponse], include_in_schema=False)
def listar_ventas(
    desde: Annotated[Optional[date], Query(description="Inclusive lower bound")] = None,
    hasta: Annotated[Optional[date], Query(description="Inclusive upper bound")] = None,
    forma_pago: Annotated[
        Optional[FormaPago], Query(description="Filter by payment method")
    ] = None,
    cliente_id: Annotated[
        Optional[uuid.UUID], Query(description="Filter by customer (foreign → 404)")
    ] = None,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[VentaResponse]:
    """Newest first. Date bounds are inclusive on both ends."""
    svc = VentaService(session)
    ventas = svc.listar(
        current_user.negocio_id,
        desde=desde,
        hasta=hasta,
        forma_pago=forma_pago,
        cliente_id=cliente_id,
    )
    return [VentaResponse.model_validate(v) for v in ventas]


@router.post(
    "",
    response_model=VentaResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a sale",
)
@router.post(
    "/",
    response_model=VentaResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def crear_venta(
    body: VentaCreate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> VentaResponse:
    """
    Record one sale.

    A fiado is this same endpoint with `forma_pago = CUENTA_CORRIENTE` and a
    `cliente_id` — there is no separate way to register credit, because the
    sale and the charge are the same fact (D-33).
    """
    svc = VentaService(session)
    venta = svc.crear(
        current_user.negocio_id,
        monto=body.monto,
        fecha=body.fecha,
        forma_pago=body.forma_pago,
        cliente_id=body.cliente_id,
        notas=body.notas,
        creado_por_usuario_id=current_user.id,
    )
    session.commit()
    session.refresh(venta)
    return VentaResponse.model_validate(venta)


@router.get(
    "/{venta_id}",
    response_model=VentaResponse,
    summary="Read a single sale",
)
def get_venta(
    venta_id: uuid.UUID,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> VentaResponse:
    """A sale of another negocio is indistinguishable from a missing one."""
    svc = VentaService(session)
    return VentaResponse.model_validate(svc.get(current_user.negocio_id, venta_id))


@router.patch(
    "/{venta_id}",
    response_model=VentaResponse,
    summary="Correct a sale",
)
def actualizar_venta(
    venta_id: uuid.UUID,
    body: VentaUpdate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> VentaResponse:
    """
    Correct a sale.

    Taking one out of cuenta corriente makes a debt disappear. It is a
    legitimate correction, so it is allowed — but it is never a side effect of
    editing something else: the resulting pair is validated as a whole.
    """
    svc = VentaService(session)
    venta = svc.actualizar(
        current_user.negocio_id,
        venta_id,
        monto=body.monto,
        fecha=body.fecha,
        forma_pago=body.forma_pago,
        cliente_id=body.cliente_id,
        notas=body.notas,
    )
    session.commit()
    session.refresh(venta)
    return VentaResponse.model_validate(venta)


@router.delete(
    "/{venta_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a sale",
)
def eliminar_venta(
    venta_id: uuid.UUID,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> None:
    """Soft delete. If it was a fiado, its charge leaves the customer's account."""
    svc = VentaService(session)
    svc.eliminar(current_user.negocio_id, venta_id)
    session.commit()


__all__ = ["router"]
