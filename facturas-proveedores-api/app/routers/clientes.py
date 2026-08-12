"""
Customer endpoints (C-32) — /api/clientes.

No authorization logic here: the service decides what the caller may touch,
including the uniqueness rule. The router wires HTTP to it.

Collection routes answer on both `""` and `"/"` without a redirect (C-27): a
307 makes some clients rebuild the request and drop headers.

`/buscar` is declared before `/{cliente_id}` so the path parameter does not
shadow it — same ordering constraint as the suppliers router.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.usuario import Usuario
from app.schemas.cliente import ClienteCreate, ClienteResponse, ClienteUpdate
from app.schemas.cuenta_corriente_cliente import CuentaCorrienteClienteResponse
from app.services.cliente_service import ClienteService

router = APIRouter(prefix="/api/clientes", tags=["clientes"])

CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


# ── GET /buscar — MUST come before /{cliente_id} ──────────────────────────────

@router.get(
    "/buscar",
    response_model=list[ClienteResponse],
    summary="Search customers by name for autocomplete",
)
def buscar_clientes(
    nombre: Annotated[str, Query(description="Name fragment, accent-insensitive")] = "",
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[ClienteResponse]:
    """Exact normalized match first, then the ones that contain the fragment."""
    svc = ClienteService(session)
    resultados = svc.buscar(current_user.negocio_id, nombre)
    return [ClienteResponse.model_validate(c) for c in resultados]


# ── GET /{cliente_id}/cuenta-corriente — MUST come before /{cliente_id} (C-35) ─
#
# Mirrors the supplier equivalent GET /api/proveedores/{proveedor_id}/cuenta-corriente
# (D7): same shape, same placement discipline as /buscar above.


@router.get(
    "/{cliente_id}/cuenta-corriente",
    response_model=CuentaCorrienteClienteResponse,
    summary="Get a customer's current account (saldo, ventas con estado, historial)",
)
def get_cuenta_corriente(
    cliente_id: Annotated[uuid.UUID, ...],
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> CuentaCorrienteClienteResponse:
    """
    Return the on-demand cuenta-corriente triple for one customer.

    Composed on-demand (no persistence):
    - `saldo`: SUM(fiados activos) - SUM(cobros activos) (RN-CCC-01). SIGNED
      and MAY be negative (D4) — the API reports the real figure rather
      than clamping it at zero.
    - `ventas_con_estado`: active fiados, each with FIFO estado (RN-CCC-02).
    - `historial`: chronological merge with row-by-row saldo_acumulado (RN-CCC-05).

    Returns 404 if the customer belongs to another negocio, is soft-deleted,
    or does not exist (never 403 — no enumeration leak, D-06). Read-only:
    no session.commit() is issued.
    """
    svc = ClienteService(session)
    result = svc.get_cuenta_corriente(current_user.negocio_id, cliente_id)
    return CuentaCorrienteClienteResponse.model_validate(result)


@router.get(
    "",
    response_model=list[ClienteResponse],
    summary="List the negocio's active customers",
)
@router.get("/", response_model=list[ClienteResponse], include_in_schema=False)
def listar_clientes(
    buscar: Annotated[
        str | None, Query(description="Optional name fragment for autocomplete")
    ] = None,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[ClienteResponse]:
    """Every active customer, or those matching `buscar` when supplied."""
    svc = ClienteService(session)
    resultados = (
        svc.buscar(current_user.negocio_id, buscar)
        if buscar is not None
        else svc.listar(current_user.negocio_id)
    )
    return [ClienteResponse.model_validate(c) for c in resultados]


@router.post(
    "",
    response_model=ClienteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a customer",
)
@router.post(
    "/",
    response_model=ClienteResponse,
    status_code=status.HTTP_201_CREATED,
    include_in_schema=False,
)
def crear_cliente(
    body: ClienteCreate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ClienteResponse:
    """
    Create a customer from just a name.

    A duplicate answers 409 carrying the existing customer's id and name, so
    the caller can offer it instead of creating a second account for the same
    person.
    """
    svc = ClienteService(session)
    cliente = svc.crear(
        current_user.negocio_id,
        nombre=body.nombre,
        telefono=body.telefono,
        notas=body.notas,
        creado_por_usuario_id=current_user.id,
    )
    session.commit()
    session.refresh(cliente)
    return ClienteResponse.model_validate(cliente)


@router.get(
    "/{cliente_id}",
    response_model=ClienteResponse,
    summary="Read a single customer",
)
def get_cliente(
    cliente_id: uuid.UUID,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ClienteResponse:
    """A customer of another negocio is indistinguishable from a missing one."""
    svc = ClienteService(session)
    return ClienteResponse.model_validate(svc.get(current_user.negocio_id, cliente_id))


@router.patch(
    "/{cliente_id}",
    response_model=ClienteResponse,
    summary="Update a customer",
)
def actualizar_cliente(
    cliente_id: uuid.UUID,
    body: ClienteUpdate,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> ClienteResponse:
    """Renaming into an existing name is rejected like a duplicate alta."""
    svc = ClienteService(session)
    cliente = svc.actualizar(
        current_user.negocio_id,
        cliente_id,
        nombre=body.nombre,
        telefono=body.telefono,
        notas=body.notas,
    )
    session.commit()
    session.refresh(cliente)
    return ClienteResponse.model_validate(cliente)


@router.delete(
    "/{cliente_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Soft-delete a customer",
)
def eliminar_cliente(
    cliente_id: uuid.UUID,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> None:
    """Soft delete. Releases the name for reuse (the unique index is partial)."""
    svc = ClienteService(session)
    svc.eliminar(current_user.negocio_id, cliente_id)
    session.commit()


__all__ = ["router"]
