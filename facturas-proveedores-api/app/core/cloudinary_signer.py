"""
Cloudinary signing helper (C-05).

Computes a signed upload preset for client-side uploads to Cloudinary.

Design decisions (C-05 D3, D5 / C-10 D10):
- Reads CLOUDINARY_URL (format: cloudinary://api_key:api_secret@cloud_name)
  from environment and never returns the api_secret.
- Bakes upload constraints into the signed params (folder, allowed_formats,
  max_file_size, timestamp) so Cloudinary enforces them server-side even
  if the client is tampered with.
- Returns ONLY public parameters (signature, timestamp, api_key, cloud_name,
  folder, allowed_formats, max_file_size).
- The `cloudinary` Python SDK is used here to compute the signature; the
  same package already ships with the API, no new dependency added.
- Three presets are exposed: avatar (C-05), factura (C-08), comprobante
  (C-10). All three share the same response shape — only the folder,
  allowed_formats, and max_file_size differ.
"""

from __future__ import annotations

import time
from typing import Any, Dict

import cloudinary
import cloudinary.utils

from app.core.config import settings

# ── Constraints per upload kind (C-05 D3, C-10 D10) ─────────────────────────

# Avatar — used for user profile pictures
_AVATAR_FOLDER = "avatars"
_AVATAR_ALLOWED_FORMATS = ("pdf", "jpg", "png")
_AVATAR_MAX_FILE_SIZE = 10 * 1024 * 1024  # ~10 MB

# Factura — used for invoice PDF/image (C-08)
_FACTURA_FOLDER = "facturas"
_FACTURA_ALLOWED_FORMATS = ("pdf", "jpg", "png")
_FACTURA_MAX_FILE_SIZE = 10 * 1024 * 1024  # ~10 MB

# Comprobante — used for payment receipts (C-10)
_COMPROBANTE_FOLDER = "comprobantes"
_COMPROBANTE_ALLOWED_FORMATS = ("pdf", "jpg", "png")
_COMPROBANTE_MAX_FILE_SIZE = 10 * 1024 * 1024  # ~10 MB


def _parse_cloudinary_url(url: str) -> Dict[str, str]:
    """
    Parse a CLOUDINARY_URL of the form cloudinary://api_key:api_secret@cloud_name.

    Returns a dict with keys: api_key, api_secret, cloud_name. Each is a
    non-empty string. Raises ValueError on malformed input.
    """
    if not url.startswith("cloudinary://"):
        raise ValueError("CLOUDINARY_URL must start with 'cloudinary://'")
    rest = url[len("cloudinary://") :]
    if "@" not in rest:
        raise ValueError("CLOUDINARY_URL must contain '@' (api_key:secret@cloud)")
    credentials, cloud_name = rest.rsplit("@", 1)
    if ":" not in credentials:
        raise ValueError("CLOUDINARY_URL credentials must be 'api_key:api_secret'")
    api_key, api_secret = credentials.split(":", 1)
    if not (api_key and api_secret and cloud_name):
        raise ValueError("CLOUDINARY_URL is missing api_key, api_secret, or cloud_name")
    return {
        "api_key": api_key,
        "api_secret": api_secret,
        "cloud_name": cloud_name,
    }


def _now_timestamp() -> int:
    """Return current UTC epoch seconds. Isolated for test determinism."""
    return int(time.time())


def _call_cloudinary_sign(*, params: Dict[str, Any], api_secret: str) -> str:
    """
    Thin wrapper around cloudinary's signature function — isolated for tests.

    `cloudinary.utils.api_sign_request` computes a SHA-1 hex digest of the
    sorted-param string using the api_secret.
    """
    return cloudinary.utils.api_sign_request(params, api_secret)


def _build_preset(
    *,
    folder: str,
    allowed_formats: tuple[str, ...],
    max_file_size: int,
) -> Dict[str, Any]:
    """Internal helper — builds and signs a preset for the given constraints."""
    creds = _parse_cloudinary_url(settings.CLOUDINARY_URL)
    timestamp = _now_timestamp()

    signed_params: Dict[str, Any] = {
        "timestamp": timestamp,
        "folder": folder,
        "allowed_formats": list(allowed_formats),
        "max_file_size": max_file_size,
    }

    signature = _call_cloudinary_sign(
        params=signed_params, api_secret=creds["api_secret"]
    )

    return {
        "signature": signature,
        "timestamp": timestamp,
        "api_key": creds["api_key"],
        "cloud_name": creds["cloud_name"],
        "folder": folder,
        "allowed_formats": list(allowed_formats),
        "max_file_size": max_file_size,
    }


def sign_avatar_preset() -> Dict[str, Any]:
    """Build and sign an avatar upload preset (C-05)."""
    return _build_preset(
        folder=_AVATAR_FOLDER,
        allowed_formats=_AVATAR_ALLOWED_FORMATS,
        max_file_size=_AVATAR_MAX_FILE_SIZE,
    )


def sign_factura_preset() -> Dict[str, Any]:
    """Build and sign a factura upload preset (C-08)."""
    return _build_preset(
        folder=_FACTURA_FOLDER,
        allowed_formats=_FACTURA_ALLOWED_FORMATS,
        max_file_size=_FACTURA_MAX_FILE_SIZE,
    )


def sign_comprobante_preset() -> Dict[str, Any]:
    """Build and sign a comprobante (payment receipt) upload preset (C-10)."""
    return _build_preset(
        folder=_COMPROBANTE_FOLDER,
        allowed_formats=_COMPROBANTE_ALLOWED_FORMATS,
        max_file_size=_COMPROBANTE_MAX_FILE_SIZE,
    )


__all__ = [
    "sign_avatar_preset",
    "sign_factura_preset",
    "sign_comprobante_preset",
    "_parse_cloudinary_url",
]
