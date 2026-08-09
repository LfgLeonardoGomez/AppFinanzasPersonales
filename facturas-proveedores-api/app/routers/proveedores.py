"""
Proveedores router — HTTP endpoints for supplier management.

Design decisions (C-06 design.md):
- D3: order_by constrained to Literal["nombre","saldo"] (no raw string to SQL).
- D5: all auth + ownership enforced in the service layer; router stays thin.
- D8: page is 1-based; fixed page_size in the repo.
- /buscar route declared BEFORE /{id} to avoid route shadowing (task 4.3/4.4).

C-12 additions:
- GET /{proveedor_id}/cuenta-corriente — declared between /buscar and /{id}
  to avoid being shadowed by the catch-all /{id} route (mirrors the
  C-06 /buscar pattern).
- The endpoint is read-only; the router does NOT call session.commit().

Pattern mirrors app/routers/auth.py:
- Router owns the session.commit().
- Service raises HTTPExceptions; router does not add logic.
- Annotated style for all params and deps.
"""

import uuid
from decimal import Decimal
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.usuario import Usuario
from app.schemas.cuenta_corriente import CuentaCorrienteResponse
from app.schemas.proveedor import (
    ProveedorCreate,
    ProveedorDeleteResponse,
    ProveedorListItem,
    ProveedorResponse,
    ProveedorUpdate,
)
from app.services.proveedor_service import ProveedorService

router = APIRouter(prefix="/api/proveedores", tags=["proveedores"])

# Type aliases for shared dependencies (FastAPI SKILL pattern)
CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


# ── GET /buscar — MUST come before /{id} to avoid route shadowing (task 4.3) ─

@router.get(
    "/buscar",
    response_model=list[ProveedorResponse],
    summary="Search suppliers by name",
)
def buscar_proveedores(
    nombre: Annotated[str, Query(description="Name fragment to search (case-insensitive)")] = "",
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[ProveedorResponse]:
    """
    Search active suppliers by normalized name fragment.

    Returns all matches (no pagination). Scoped to the authenticated user.
    Soft-deleted suppliers are excluded.
    """
    svc = ProveedorService(session)
    results = svc.buscar_por_nombre(current_user.negocio_id, nombre)
    # For search results, saldo is not requested — return 0 as a fast response.
    # If saldo is needed for search results, get_saldo_por_proveedor can be added.
    # For MVP, the search is for linkage purposes (RN-VINC) so saldo is optional.
    saldos = svc._repo.get_saldo_por_proveedor(current_user.negocio_id) if results else {}
    return [
        ProveedorResponse(
            id=p.id,
            nombre=p.nombre,
            cuit=p.cuit,
            telefono=p.telefono,
            categoria=p.categoria,
            notas=p.notas,
            saldo=saldos.get(p.id, Decimal("0.00")),
            created_at=p.created_at,
            updated_at=p.updated_at,
        )
        for p in results
    ]


# ── GET /{id}/cuenta-corriente — MUST come before /{id} (C-12) ───────────────

@router.get(
    "/{proveedor_id}/cuenta-corriente",
    response_model=CuentaCorrienteResponse,
    summary="Get a supplier's current account (saldo, facturas con estado, historial)",
)
def get_cuenta_corriente(
    proveedor_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CuentaCorrienteResponse:
    """
    Return the on-demand cuenta-corriente triple for one supplier.

    Composed on-demand (no persistence):
    - `saldo`: SUM(facturas activas.monto_total) − SUM(pagos activos.monto) (RN-SALDO).
    - `facturas_con_estado`: active invoices, each with FIFO estado (RN-FIFO).
    - `historial`: chronological merge with row-by-row saldo_acumulado (RN-HIST).

    Returns 404 if the supplier belongs to another user, is soft-deleted, or
    does not exist (never 403 — no enumeration leak).
    The endpoint is read-only; no session.commit() is issued.
    """
    svc = ProveedorService(session)
    result = svc.get_cuenta_corriente(current_user.negocio_id, proveedor_id)
    return CuentaCorrienteResponse.model_validate(result)


# ── GET / — paginated listing ─────────────────────────────────────────────────
#
# c-27 (design.md D1): the collection route is registered on BOTH "" and "/"
# so neither form redirects (307 would let a client rebuild the request from
# its own cookie jar, dropping an explicit Cookie header — see C-22). The
# "/" registration is kept out of the OpenAPI schema (include_in_schema=False)
# so the generated client sees one operation, not two.

@router.get(
    "",
    response_model=list[ProveedorListItem],
    summary="List suppliers with on-demand balance",
)
@router.get(
    "/",
    response_model=list[ProveedorListItem],
    include_in_schema=False,
)
def list_proveedores(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    order_by: Annotated[
        Literal["nombre", "saldo"],
        Query(description="Order by: 'nombre' (asc) or 'saldo' (desc)"),
    ] = "nombre",
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[ProveedorListItem]:
    """
    Return a paginated page of the authenticated user's active suppliers.

    Balances are computed in a single aggregate query (no N+1).
    """
    svc = ProveedorService(session)
    results = svc.listar(current_user.negocio_id, page=page, order_by=order_by)
    return [
        ProveedorListItem(
            id=r.id,
            nombre=r.nombre,
            cuit=r.cuit,
            categoria=r.categoria,
            saldo=r.saldo,
            ultima_factura_fecha=r.ultima_factura_fecha,
        )
        for r in results
    ]


# ── POST / — create supplier ──────────────────────────────────────────────────

@router.post(
    "",
    response_model=ProveedorResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new supplier",
)
@router.post(
    "/",
    response_model=ProveedorResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def create_proveedor(
    body: ProveedorCreate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ProveedorResponse:
    """
    Create a supplier for the authenticated user.

    negocio_id is taken from the session — the payload cannot override it.
    Returns 201 with saldo=0.00 (no movements yet).
    """
    from decimal import Decimal

    svc = ProveedorService(session)
    proveedor = svc.crear(
        current_user.negocio_id, body, creado_por_usuario_id=current_user.id
    )
    session.commit()
    session.refresh(proveedor)

    return ProveedorResponse(
        id=proveedor.id,
        nombre=proveedor.nombre,
        cuit=proveedor.cuit,
        telefono=proveedor.telefono,
        categoria=proveedor.categoria,
        notas=proveedor.notas,
        saldo=Decimal("0.00"),
        created_at=proveedor.created_at,
        updated_at=proveedor.updated_at,
    )


# ── GET /{id} — read supplier ─────────────────────────────────────────────────

@router.get(
    "/{proveedor_id}",
    response_model=ProveedorResponse,
    summary="Get a supplier by ID",
)
def get_proveedor(
    proveedor_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ProveedorResponse:
    """
    Return a single supplier with its on-demand saldo.

    Returns 404 if the supplier belongs to another user or is soft-deleted.
    """
    svc = ProveedorService(session)
    result = svc.get(current_user.negocio_id, proveedor_id)
    return ProveedorResponse(
        id=result.id,
        nombre=result.nombre,
        cuit=result.cuit,
        telefono=result.telefono,
        categoria=result.categoria,
        notas=result.notas,
        saldo=result.saldo,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


# ── PATCH /{id} — update supplier ────────────────────────────────────────────

@router.patch(
    "/{proveedor_id}",
    response_model=ProveedorResponse,
    summary="Update a supplier (partial)",
)
def update_proveedor(
    proveedor_id: Annotated[uuid.UUID, ...],
    body: ProveedorUpdate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ProveedorResponse:
    """
    Partially update a supplier owned by the authenticated user.

    Returns 404 if the supplier belongs to another user or is soft-deleted.
    """
    svc = ProveedorService(session)
    result = svc.actualizar(current_user.negocio_id, proveedor_id, body)
    session.commit()
    return ProveedorResponse(
        id=result.id,
        nombre=result.nombre,
        cuit=result.cuit,
        telefono=result.telefono,
        categoria=result.categoria,
        notas=result.notas,
        saldo=result.saldo,
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


# ── DELETE /{id} — soft-delete supplier ──────────────────────────────────────

@router.delete(
    "/{proveedor_id}",
    response_model=ProveedorDeleteResponse,
    summary="Soft-delete a supplier",
)
def delete_proveedor(
    proveedor_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ProveedorDeleteResponse:
    """
    Soft-delete a supplier owned by the authenticated user.

    The supplier row is preserved (FK integrity). Returns tiene_dependencias
    so the frontend can display a confirmation dialog (RN-PROV-04).
    Never blocked by the presence of active invoices/payments.

    Returns 404 if the supplier belongs to another user or is already deleted.
    """
    svc = ProveedorService(session)
    result = svc.eliminar(current_user.negocio_id, proveedor_id)
    session.commit()
    return ProveedorDeleteResponse(
        id=result["id"],
        tiene_dependencias=result["tiene_dependencias"],
    )


__all__ = ["router"]
