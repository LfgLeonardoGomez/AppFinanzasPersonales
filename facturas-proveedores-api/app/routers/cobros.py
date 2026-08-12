"""
Cobros router — HTTP endpoints for customer-payment management (C-35).

Mirrors app/routers/pagos.py exactly, one level down the same ledger shape:
- negocio_id comes from the session — the payload cannot override it.
- NO venta_id is accepted — RN-CCC-03 is enforced at three levels:
  1) the CobroCliente SQLModel has no such column,
  2) CobroClienteCreate / CobroClienteUpdate don't declare the field,
  3) extra="forbid" on both input schemas rejects any payload attempting
     to send it.
- cliente_id is NOT changeable via PATCH (D8).
- Collection routes answer on both "" and "/" without a redirect (C-27).
"""

import uuid
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, ConfigDict
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.cobro_cliente import CobroCliente
from app.models.usuario import Usuario
from app.schemas.cobro_cliente import (
    CobroClienteCreate,
    CobroClienteListItem,
    CobroClienteResponse,
    CobroClienteUpdate,
)
from app.services.cobro_cliente_service import CobroClienteService


# ── Paginated list response ──────────────────────────────────────────────────


class CobroClienteListResponse(BaseModel):
    """Paginated response wrapper for GET /api/cobros."""

    model_config = ConfigDict(from_attributes=True)

    items: list[CobroClienteListItem]
    total: int
    page: int
    page_size: int


# ── Router setup ─────────────────────────────────────────────────────────────


router = APIRouter(prefix="/api/cobros", tags=["cobros"])

CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


def _to_response(cobro: CobroCliente) -> CobroClienteResponse:
    return CobroClienteResponse(
        id=cobro.id,
        negocio_id=cobro.negocio_id,
        cliente_id=cobro.cliente_id,
        monto=cobro.monto,
        fecha=cobro.fecha,
        metodo=cobro.metodo,
        comprobante_url=cobro.comprobante_url,
        created_at=cobro.created_at,
        updated_at=cobro.updated_at,
    )


def _to_list_item(cobro: CobroCliente) -> CobroClienteListItem:
    return CobroClienteListItem(
        id=cobro.id,
        cliente_id=cobro.cliente_id,
        monto=cobro.monto,
        fecha=cobro.fecha,
        metodo=cobro.metodo,
        created_at=cobro.created_at,
    )


# ── GET / — paginated listing ─────────────────────────────────────────────────
#
# c-27 (design.md D1): the collection route is registered on BOTH "" and "/"
# so neither form redirects. The "/" registration is kept out of the OpenAPI
# schema (include_in_schema=False) so the generated client sees one operation.


@router.get(
    "",
    response_model=CobroClienteListResponse,
    summary="List active payments for the negocio, optionally filtered by customer",
)
@router.get(
    "/",
    response_model=CobroClienteListResponse,
    include_in_schema=False,
)
def list_cobros(
    cliente_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Filter by customer UUID (foreign -> 404)"),
    ] = None,
    page: Annotated[int, Query(ge=1, description="1-indexed page number")] = 1,
    page_size: Annotated[
        int, Query(ge=1, le=200, description="Items per page (default 50)")
    ] = 50,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CobroClienteListResponse:
    """
    Return active payments for the negocio.

    Soft-deleted cobros are excluded. When `cliente_id` is provided, the
    list is filtered to that customer (a foreign `cliente_id` returns 404,
    not an empty list).
    """
    svc = CobroClienteService(session)
    items, total = svc.listar(
        current_user.negocio_id, cliente_id=cliente_id, page=page, page_size=page_size
    )
    return CobroClienteListResponse(
        items=[_to_list_item(c) for c in items],
        total=total,
        page=page,
        page_size=page_size,
    )


# ── POST / — create payment ──────────────────────────────────────────────────


@router.post(
    "",
    response_model=CobroClienteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a customer payment",
)
@router.post(
    "/",
    response_model=CobroClienteResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def create_cobro(
    body: CobroClienteCreate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CobroClienteResponse:
    """
    Record a payment for a customer owned by the negocio.

    - negocio_id is taken from the session — the payload cannot override it.
    - NO venta_id is accepted — RN-CCC-03.
    - Returns 404 if the cliente belongs to another negocio or is soft-deleted.
    - Returns 422 if fecha is in the future (UTC-3), monto <= 0, or the
      payment would push the customer's balance below zero (RN-CCC-04).
    """
    svc = CobroClienteService(session)
    cobro = svc.crear(
        current_user.negocio_id, body, creado_por_usuario_id=current_user.id
    )
    session.commit()
    session.refresh(cobro)
    return _to_response(cobro)


# ── GET /{id} — read payment ──────────────────────────────────────────────────


@router.get(
    "/{cobro_id}",
    response_model=CobroClienteResponse,
    summary="Get a customer payment by ID",
)
def get_cobro(
    cobro_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CobroClienteResponse:
    """Return a single payment owned by the negocio. 404 if foreign or deleted."""
    svc = CobroClienteService(session)
    cobro = svc.get(current_user.negocio_id, cobro_id)
    return _to_response(cobro)


# ── PATCH /{id} — update payment ──────────────────────────────────────────────


@router.patch(
    "/{cobro_id}",
    response_model=CobroClienteResponse,
    summary="Update a customer payment (partial)",
)
def update_cobro(
    cobro_id: Annotated[uuid.UUID, ...],
    body: CobroClienteUpdate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CobroClienteResponse:
    """
    Partially update a payment owned by the negocio.

    Only fields explicitly set are applied. PATCH cannot re-link the payment
    to a different customer (D8 — cliente_id is not a declared field).
    Returns 404 if foreign or deleted. Returns 422 if monto <= 0, fecha is
    in the future (UTC-3), or the edit would push the balance below zero
    (RN-CCC-04, computed excluding this payment's current amount, D3).
    """
    svc = CobroClienteService(session)
    cobro = svc.actualizar(current_user.negocio_id, cobro_id, body)
    session.commit()
    session.refresh(cobro)
    return _to_response(cobro)


# ── DELETE /{id} — soft-delete payment ───────────────────────────────────────


@router.delete(
    "/{cobro_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a customer payment",
)
def delete_cobro(
    cobro_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> None:
    """
    Soft-delete a payment owned by the negocio.

    The row is preserved (FK integrity). After this call, the balance, the
    FIFO pool and the history immediately exclude it. 404 if missing,
    foreign, or already soft-deleted.
    """
    svc = CobroClienteService(session)
    svc.eliminar(current_user.negocio_id, cobro_id)
    session.commit()


__all__ = ["router", "CobroClienteListResponse"]
