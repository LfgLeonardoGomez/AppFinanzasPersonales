"""
Pydantic schemas for perfil (C-05).

Design decisions (C-05 design.md):
- D1: Separate PATCH /api/me (scalar profile) and POST /api/me/avatar (avatar URL).
- D2: PerfilUpdate applies only explicitly-sent fields (model_dump(exclude_unset=True))
      in the service layer — every field is Optional. Identity fields (email, nombre,
      password) are simply NOT on the schema, so they cannot be modified through it.
- D3: The signed-preset response is public parameters only — never the API secret.
- D4: AvatarUpdate re-validates that the URL points to the configured Cloudinary
      account before persisting (backend re-validation, never trust the client).
- D5: TipoUpload is an enum, designed to extend to 'factura' / 'comprobante'.
"""

import enum
import re
from typing import List, Optional
from urllib.parse import urlparse

from pydantic import BaseModel, ConfigDict, Field, field_validator, HttpUrl

from app.core.config import get_cloudinary_cloud_name
from app.models.enums import TemaPreferido

# Cloudinary upload host (D4).
_CLOUDINARY_UPLOAD_HOST = "res.cloudinary.com"


# ── TipoUpload ────────────────────────────────────────────────────────────────


class TipoUpload(str, enum.Enum):
    """
    Constrained set of upload kinds for the signed-preset endpoint.

    - AVATAR: user profile picture (C-05).
    - FACTURA: invoice PDF/image uploaded to back the archivo_url (C-08).
    - COMPROBANTE: payment receipt PDF/image uploaded to back the
      comprobante_url on a Pago (C-10).
    """

    AVATAR = "avatar"
    FACTURA = "factura"
    COMPROBANTE = "comprobante"


# ── PerfilUpdate ──────────────────────────────────────────────────────────────


class PerfilUpdate(BaseModel):
    """
    Payload for PATCH /api/me — partial update of optional profile fields.

    All fields optional. The service layer applies only fields explicitly
    sent in the request (model_dump(exclude_unset=True)). Identity fields
    (email, nombre, password) are intentionally absent from this schema:
    the frontend cannot modify them through this path.
    """

    telefono: Optional[str] = Field(default=None, max_length=30)
    nombre_negocio: Optional[str] = Field(default=None, max_length=120)
    tema_preferido: Optional[TemaPreferido] = None

    model_config = ConfigDict(extra="forbid")


# ── AvatarUpdate ──────────────────────────────────────────────────────────────


class AvatarUpdate(BaseModel):
    """
    Payload for POST /api/me/avatar.

    avatar_url MUST be a well-formed URL AND it MUST point to the configured
    Cloudinary account (D4). Validation happens here in Pydantic so the
    service layer can trust the input.
    """

    avatar_url: HttpUrl

    @field_validator("avatar_url")
    @classmethod
    def must_be_cloudinary_url(cls, v: HttpUrl) -> HttpUrl:
        """
        Re-validate that the URL is hosted on the configured Cloudinary account.

        Format: https://res.cloudinary.com/<cloud_name>/<resource>/...
        """
        # HttpUrl is normalized to a string with no trailing slash.
        raw = str(v)
        parsed = urlparse(raw)
        if parsed.scheme != "https":
            raise ValueError("avatar_url must use https")
        if parsed.netloc.lower() != _CLOUDINARY_UPLOAD_HOST:
            raise ValueError(
                f"avatar_url must be hosted on {_CLOUDINARY_UPLOAD_HOST}"
            )

        # Path is /<cloud_name>/<rest...>; reject if the cloud_name doesn't match.
        expected_cloud = get_cloudinary_cloud_name()
        path_parts = [p for p in parsed.path.split("/") if p]
        if not path_parts or path_parts[0] != expected_cloud:
            raise ValueError(
                f"avatar_url must point to the configured cloud '{expected_cloud}'"
            )
        return v

    model_config = ConfigDict(extra="forbid")


# ── PresetFirmadoResponse ─────────────────────────────────────────────────────


class PresetFirmadoResponse(BaseModel):
    """
    Signed Cloudinary upload preset returned to the client.

    Public parameters only (D3):
      - signature, timestamp, api_key, cloud_name, folder, allowed_formats, max_file_size
    The API secret is NEVER part of this response (and never logged).
    """

    signature: str
    timestamp: int
    api_key: str
    cloud_name: str
    folder: str
    allowed_formats: List[str]
    max_file_size: int


__all__ = [
    "TipoUpload",
    "PerfilUpdate",
    "AvatarUpdate",
    "PresetFirmadoResponse",
]
