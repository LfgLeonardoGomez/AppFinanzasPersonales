"""
Team management endpoints (C-29) — /api/equipo.

Every route here is gated by `require_admin`, declared as a dependency rather
than checked inside the handler so a future endpoint that forgets it is visible
in the signature (D1).

No authorization logic lives in this module: the service decides what a caller
may touch, including the rule that a negocio can never be left without an
active admin. The router only wires HTTP to it.

Collection routes answer on both `""` and `"/"` without a redirect (C-27): a
307 makes some HTTP clients rebuild the request and drop headers, which is what
broke the multi-user test harness for months.
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlmodel import Session

from app.core.deps import get_db, rate_limit, require_admin
from app.models.usuario import Usuario
from app.schemas.equipo import InvitacionResponse, MiembroResponse
from app.services.equipo_service import EquipoService

router = APIRouter(prefix="/api/equipo", tags=["equipo"])

AdminUser = Annotated[Usuario, Depends(require_admin)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get(
    "",
    response_model=list[MiembroResponse],
    summary="List the members of the caller's negocio",
)
@router.get("/", response_model=list[MiembroResponse], include_in_schema=False)
def listar_equipo(
    current_user: AdminUser = ...,
    session: DbSession = ...,
) -> list[MiembroResponse]:
    """
    Every member of the negocio, deactivated ones included.

    The deactivated have to be listed: an admin cannot reactivate someone they
    cannot see.
    """
    svc = EquipoService(session)
    miembros = svc.listar_miembros(current_user.negocio_id)
    return [MiembroResponse.model_validate(m) for m in miembros]


@router.post(
    "/invitaciones",
    response_model=InvitacionResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Issue a single-use join code",
)
def crear_invitacion(
    current_user: AdminUser = ...,
    session: DbSession = ...,
    _rate: None = Depends(rate_limit),
) -> InvitacionResponse:
    """
    Issue an invitation for this negocio.

    The readable code is in this response and nowhere else — only its hash is
    stored, so it cannot be recovered afterwards (D-31).
    """
    svc = EquipoService(session)
    invitacion, codigo = svc.crear_invitacion(
        current_user.negocio_id, current_user.id
    )
    session.commit()
    session.refresh(invitacion)

    return InvitacionResponse(
        id=invitacion.id,
        codigo=codigo,
        expira_en=invitacion.expira_en,
    )


@router.post(
    "/{usuario_id}/desactivar",
    response_model=MiembroResponse,
    summary="Revoke a member's access",
)
def desactivar_miembro(
    usuario_id: uuid.UUID,
    current_user: AdminUser = ...,
    session: DbSession = ...,
) -> MiembroResponse:
    """
    Revoke access without deleting anything the member loaded.

    Returns 409 if this would leave the negocio without an active admin, and
    404 for a member of another negocio.
    """
    svc = EquipoService(session)
    miembro = svc.desactivar(current_user.negocio_id, usuario_id)
    session.commit()
    session.refresh(miembro)
    return MiembroResponse.model_validate(miembro)


@router.post(
    "/{usuario_id}/reactivar",
    response_model=MiembroResponse,
    summary="Restore a member's access",
)
def reactivar_miembro(
    usuario_id: uuid.UUID,
    current_user: AdminUser = ...,
    session: DbSession = ...,
) -> MiembroResponse:
    """Restore access. The member logs in again as usual."""
    svc = EquipoService(session)
    miembro = svc.reactivar(current_user.negocio_id, usuario_id)
    session.commit()
    session.refresh(miembro)
    return MiembroResponse.model_validate(miembro)


__all__ = ["router"]
