"""
Tests for image validation helper (C-14, RN-IA-01).

The helper `validate_image_bytes(data: bytes) -> Literal["jpeg","png","webp"]`
inspects magic bytes (NOT the Content-Type header) and rejects unsupported
file types (PDF, GIF, HEIC, TIFF, BMP, etc.) and oversize files (> 10 MB)
with a ValueError.

Why this lives in app/core (not the IA service): the router owns HTTP transport
policy. The helper is a pure function with zero I/O — easy to test in isolation.
"""

import pytest


# ── Happy path: supported formats ─────────────────────────────────────────────


class TestAcceptsSupportedFormats:
    def test_jpeg_jfif_marker(self):
        from app.core.image_validation import validate_image_bytes

        # JPEG with JFIF EXIF marker (FFE0), padded to 16 bytes total
        data = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x00\x00\x00"
        assert validate_image_bytes(data) == "jpeg"

    def test_jpeg_exif_marker(self):
        from app.core.image_validation import validate_image_bytes

        # JPEG with Exif marker (FFE1), padded to 16 bytes total
        data = b"\xff\xd8\xff\xe1\x00\x10Exif\x00\x00\x00\x00\x00\x00\x00\x00"
        assert validate_image_bytes(data) == "jpeg"

    def test_jpeg_no_marker_byte(self):
        from app.core.image_validation import validate_image_bytes

        # 4th byte is random (not FFE0/FFE1) — should still be a valid JPEG start
        data = b"\xff\xd8\xff\xdb\x00\x80" + b"\x00" * 8  # DQT marker + padding
        assert validate_image_bytes(data) == "jpeg"

    def test_png_signature(self):
        from app.core.image_validation import validate_image_bytes

        # Full PNG signature (8 bytes) + IHDR chunk header
        data = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a" + b"\x00\x00\x00\x0dIHDR"
        assert validate_image_bytes(data) == "png"

    def test_webp_signature(self):
        from app.core.image_validation import validate_image_bytes

        # RIFF<size>WEBP — 12-byte header is the canonical WebP signature
        data = b"RIFF\x10\x00\x00\x00WEBPVP8 "
        assert validate_image_bytes(data) == "webp"


# ── Rejection: unsupported formats ────────────────────────────────────────────


class TestRejectsUnsupportedFormats:
    def test_pdf_rejected(self):
        from app.core.image_validation import validate_image_bytes

        data = b"%PDF-1.4" + b"\x00" * 8
        with pytest.raises(ValueError, match=r"PDF no soportado"):
            validate_image_bytes(data)

    def test_gif_rejected(self):
        from app.core.image_validation import validate_image_bytes

        data = b"GIF89a" + b"\x00" * 8
        with pytest.raises(ValueError, match=r"GIF no soportado"):
            validate_image_bytes(data)

    def test_heic_rejected(self):
        from app.core.image_validation import validate_image_bytes

        # HEIC/HEIF ftyp box (simplified): bytes 4-7 are 'ftyp'
        data = b"\x00\x00\x00\x20ftypheic" + b"\x00" * 4
        with pytest.raises(ValueError, match=r"HEIC no soportado"):
            validate_image_bytes(data)

    def test_tiff_little_endian_rejected(self):
        from app.core.image_validation import validate_image_bytes

        data = b"II*\x00" + b"\x00" * 12
        with pytest.raises(ValueError, match=r"TIFF no soportado"):
            validate_image_bytes(data)

    def test_tiff_big_endian_rejected(self):
        from app.core.image_validation import validate_image_bytes

        data = b"MM\x00*" + b"\x00" * 12
        with pytest.raises(ValueError, match=r"TIFF no soportado"):
            validate_image_bytes(data)

    def test_bmp_rejected(self):
        from app.core.image_validation import validate_image_bytes

        data = b"BM" + b"\x00" * 14
        with pytest.raises(ValueError, match=r"BMP no soportado"):
            validate_image_bytes(data)

    def test_unknown_format_rejected(self):
        from app.core.image_validation import validate_image_bytes

        data = b"\x00\x00\x00\x00some random data"
        with pytest.raises(ValueError, match=r"formato no soportado"):
            validate_image_bytes(data)


# ── Rejection: size and shape ────────────────────────────────────────────────


class TestRejectsBadShape:
    def test_empty_bytes_rejected(self):
        from app.core.image_validation import validate_image_bytes

        with pytest.raises(ValueError, match=r"archivo vac[ií]o"):
            validate_image_bytes(b"")

    def test_too_small_rejected(self):
        from app.core.image_validation import validate_image_bytes

        with pytest.raises(ValueError, match=r"archivo muy peque"):
            validate_image_bytes(b"\xff\xd8")  # only 2 bytes

    def test_oversize_rejected(self):
        from app.core.image_validation import validate_image_bytes

        # 10 MB + 1 byte: 10 * 1024 * 1024 + 1
        data = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a" + b"\x00" * (10 * 1024 * 1024 + 1)
        with pytest.raises(ValueError, match=r"excede 10 MB"):
            validate_image_bytes(data)

    def test_exactly_10mb_accepted(self):
        """A file at the size limit (10 MB exactly) is accepted; over is rejected."""
        from app.core.image_validation import validate_image_bytes

        data = b"\x89\x50\x4e\x47\x0d\x0a\x1a\x0a" + b"\x00" * (10 * 1024 * 1024 - 8)
        assert validate_image_bytes(data) == "png"
