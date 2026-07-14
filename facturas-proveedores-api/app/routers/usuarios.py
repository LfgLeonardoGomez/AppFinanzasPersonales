"""
Usuarios router: profile endpoints for authenticated users.

C-03: GET /api/me — read the authenticated user's profile.
C-05: PATCH /api/me — partial update of optional profile fields.
      POST /api/me/avatar — set the avatar URL (after Cloudinary upload).
"""

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.usuario import Usuario
from app.schemas.auth import UsuarioResponse
from app.schemas.perfil import AvatarUpdate, PerfilUpdate
from app.services.usuario_service import UsuarioService

router = APIRouter(prefix="/api", tags=["usuarios"])

CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get(
    "/me",
    response_model=UsuarioResponse,
    summary="Get the authenticated user's profile",
)
def get_me(
    current_user: CurrentUser,
) -> UsuarioResponse:
    """
    Return the authenticated user's profile.

    Requires a valid access_token cookie.
    NEVER returns password_hash.
    """
    return UsuarioResponse.model_validate(current_user)


# ── C-05: PATCH /api/me ───────────────────────────────────────────────────────


@router.patch(
    "/me",
    response_model=UsuarioResponse,
    summary="Update the authenticated user's profile (partial)",
)
def patch_me(
    body: PerfilUpdate,
    current_user: CurrentUser,
    session: DbSession,
) -> UsuarioResponse:
    """
    Apply a partial update to the authenticated user's optional profile fields.

    Accepts any subset of: telefono, nombre_negocio, tema_preferido.
    Fields that are NOT present in the payload are left unchanged.
    Identity fields (email, nombre, password) cannot be modified here.

    The service scopes every operation to the authenticated user's id.
    """
    svc = UsuarioService(session)
    updated = svc.actualizar_perfil(current_user.id, body)
    session.commit()
    session.refresh(updated)
    return UsuarioResponse.model_validate(updated)


# ── C-05: POST /api/me/avatar ────────────────────────────────────────────────


@router.post(
    "/me/avatar",
    response_model=UsuarioResponse,
    summary="Set the authenticated user's avatar URL",
)
def post_me_avatar(
    body: AvatarUpdate,
    current_user: CurrentUser,
    session: DbSession,
) -> UsuarioResponse:
    """
    Persist a Cloudinary URL as the authenticated user's avatar.

    The URL MUST point to the configured Cloudinary account (D4 — the
    schema validator checks host and cloud_name). The service scopes
    the write to the authenticated user's id.
    """
    svc = UsuarioService(session)
    updated = svc.actualizar_avatar(current_user.id, str(body.avatar_url))
    session.commit()
    session.refresh(updated)
    return UsuarioResponse.model_validate(updated)


__all__ = ["router"]
