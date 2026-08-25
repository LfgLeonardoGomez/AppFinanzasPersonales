"""
Statistics endpoints (C-37) — /api/estadisticas.

Read-only. No decision logic here: the service computes totals, validates
the range, checks the tope and owns `negocio_id` scoping — this router only
turns query params into a service call and the result into a response
model (same split as every other router in this project).
"""

import uuid
from datetime import date
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.enums import Granularidad
from app.models.usuario import Usuario
from app.schemas.estadisticas import ComprasResponse, ResumenResponse, VentasResponse
from app.services.estadisticas_service import EstadisticasService

router = APIRouter(prefix="/api/estadisticas", tags=["estadisticas"])

CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get(
    "/compras",
    response_model=ComprasResponse,
    summary="Purchase totals by period",
)
def totales_compras(
    desde: Annotated[date, Query(description="Inclusive lower bound")],
    hasta: Annotated[date, Query(description="Inclusive upper bound")],
    granularidad: Annotated[Granularidad, Query()],
    proveedor_id: Annotated[
        Optional[uuid.UUID], Query(description="Scope to one supplier (foreign → 404)")
    ] = None,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ComprasResponse:
    """Total bought per period, computed on-demand — never persisted (D-01)."""
    svc = EstadisticasService(session)
    return svc.compras(
        current_user.negocio_id,
        desde=desde,
        hasta=hasta,
        granularidad=granularidad,
        proveedor_id=proveedor_id,
    )


@router.get(
    "/ventas",
    response_model=VentasResponse,
    summary="Sales totals by period, with a payment-method breakdown",
)
def totales_ventas(
    desde: Annotated[date, Query(description="Inclusive lower bound")],
    hasta: Annotated[date, Query(description="Inclusive upper bound")],
    granularidad: Annotated[Granularidad, Query()],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> VentasResponse:
    """
    Total sold per period. Never includes `cobro_cliente` (D3) — a fiado
    already counted as a sale the day it was made.
    """
    svc = EstadisticasService(session)
    return svc.ventas(
        current_user.negocio_id, desde=desde, hasta=hasta, granularidad=granularidad
    )


@router.get(
    "/resumen",
    response_model=ResumenResponse,
    summary="Purchases vs. sales for one range",
)
def resumen(
    desde: Annotated[date, Query(description="Inclusive lower bound")],
    hasta: Annotated[date, Query(description="Inclusive upper bound")],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ResumenResponse:
    """
    Compras, ventas and their difference for the same range — never named as
    margin or rentabilidad (D6, Non-Goals): the system does not know what
    the goods it sold cost.
    """
    svc = EstadisticasService(session)
    return svc.resumen(current_user.negocio_id, desde=desde, hasta=hasta)


__all__ = ["router"]
