"""
Cloudinary signed-preset router (C-05 + C-08 + C-10).

Provides:
  GET /api/cloudinary/preset-firmado?tipo=avatar   (C-05)
  GET /api/cloudinary/preset-firmado?tipo=factura  (C-08)
  GET /api/cloudinary/preset-firmado?tipo=comprobante  (C-10)

The endpoint:
  - Requires an authenticated user (D3).
  - Returns ONLY public parameters (signature, timestamp, api_key,
    cloud_name, folder, allowed_formats, max_file_size) — NEVER the
    api_secret.
  - Tipo is a constrained enum (D5) — adding new values (comprobante)
    is additive and does not break the existing C-05 / C-08 contracts.

The signing helper lives in app.core.cloudinary_signer; it reads the
secret from CLOUDINARY_URL in the environment.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.core.cloudinary_signer import (
    sign_avatar_preset,
    sign_comprobante_preset,
    sign_factura_preset,
)
from app.core.deps import get_current_user
from app.models.usuario import Usuario
from app.schemas.perfil import PresetFirmadoResponse, TipoUpload

router = APIRouter(
    prefix="/api/cloudinary", tags=["cloudinary"]
)

CurrentUser = Annotated[Usuario, Depends(get_current_user)]


@router.get(
    "/preset-firmado",
    response_model=PresetFirmadoResponse,
    summary="Issue a signed Cloudinary upload preset for the given tipo",
)
def get_signed_preset(
    tipo: Annotated[
        TipoUpload,
        Query(
            description=(
                "Upload kind: 'avatar' (C-05), 'factura' (C-08), "
                "'comprobante' (C-10)."
            )
        ),
    ],
    _current_user: CurrentUser = ...,
) -> PresetFirmadoResponse:
    """
    Return a signed Cloudinary upload preset for the requested tipo.

    The signature is computed server-side from the api_secret in env;
    only public parameters are returned. Cloudinary will enforce the
    signed constraints (folder, allowed formats, max size) regardless
    of what the client claims.
    """
    if tipo == TipoUpload.AVATAR:
        payload = sign_avatar_preset()
    elif tipo == TipoUpload.FACTURA:
        payload = sign_factura_preset()
    elif tipo == TipoUpload.COMPROBANTE:
        payload = sign_comprobante_preset()
    else:  # pragma: no cover — Pydantic enum validation rejects other values
        # before reaching this branch (422 from FastAPI).
        raise ValueError(f"Unsupported tipo: {tipo}")

    return PresetFirmadoResponse(**payload)


__all__ = ["router"]
