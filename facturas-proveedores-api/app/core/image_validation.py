"""
Image validation helper (C-14, RN-IA-01).

Validates that the bytes of a multipart upload look like a supported image
format (JPEG, PNG, WebP) by inspecting MAGIC BYTES — never the
`Content-Type` header, which a client can lie about.

The function is intentionally pure: no I/O, no globals, no side effects.
It belongs in `app.core` (transport policy) and is consumed by the
`/extraer-ia` routers. The service layer trusts that any bytes it receives
have already passed this check.

Rejected cases raise `ValueError` with a Spanish, user-facing message —
the router turns the exception into HTTP 422.
"""

from typing import Final, Literal

_IMAGE_FORMAT = Literal["jpeg", "png", "webp"]

JPEG_SOI: Final[bytes] = b"\xff\xd8\xff"
PNG_SIG: Final[bytes] = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a"
WEBP_RIFF: Final[bytes] = b"RIFF"
WEBP_TAG: Final[bytes] = b"WEBP"

MAX_IMAGE_BYTES: Final[int] = 10 * 1024 * 1024
MIN_IMAGE_BYTES: Final[int] = 12


def _looks_like_pdf(data: bytes) -> bool:
    return data[:4] == b"%PDF"


def _looks_like_gif(data: bytes) -> bool:
    return data[:6] in (b"GIF87a", b"GIF89a")


def _looks_like_heic(data: bytes) -> bool:
    # HEIC/HEIF: bytes 4-7 = 'ftyp', then 4-byte brand like 'heic'/'heix'/'mif1'
    return len(data) >= 8 and data[4:8] == b"ftyp"


def _looks_like_tiff(data: bytes) -> bool:
    return data[:4] in (b"II*\x00", b"MM\x00*")


def _looks_like_bmp(data: bytes) -> bool:
    return len(data) >= 2 and data[:2] == b"BM"


def validate_image_bytes(data: bytes) -> _IMAGE_FORMAT:
    """
    Inspect magic bytes and return the detected image format.

    Raises `ValueError` with a user-facing Spanish message if the file is
    empty, too small to inspect, larger than 10 MB, or in an unsupported
    format (PDF, GIF, HEIC, TIFF, BMP, or anything else).

    The 10 MB ceiling matches the Cloudinary free-tier limit (Q-05) and the
    extractor's API budget per call.
    """
    if not data:
        raise ValueError("archivo vacío")
    if len(data) < MIN_IMAGE_BYTES:
        raise ValueError("archivo muy pequeño para validar formato")
    if len(data) > MAX_IMAGE_BYTES:
        raise ValueError("archivo excede 10 MB")

    if _looks_like_pdf(data):
        raise ValueError("PDF no soportado (use imagen)")
    if _looks_like_gif(data):
        raise ValueError("GIF no soportado (use JPEG, PNG o WebP)")
    if _looks_like_heic(data):
        raise ValueError("HEIC no soportado (use JPEG, PNG o WebP)")
    if _looks_like_tiff(data):
        raise ValueError("TIFF no soportado (use JPEG, PNG o WebP)")
    if _looks_like_bmp(data):
        raise ValueError("BMP no soportado (use JPEG, PNG o WebP)")

    if data[:3] == JPEG_SOI:
        return "jpeg"
    if data[:8] == PNG_SIG:
        return "png"
    if data[:4] == WEBP_RIFF and len(data) >= 12 and data[8:12] == WEBP_TAG:
        return "webp"

    raise ValueError("formato no soportado (use JPEG, PNG o WebP)")


__all__ = ["validate_image_bytes", "MAX_IMAGE_BYTES"]
