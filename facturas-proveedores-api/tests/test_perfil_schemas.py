"""
Tests for perfil Pydantic schemas (C-05 tasks 1.1, 1.2, 1.3 — TDD RED).

Covers:
- PerfilUpdate: all fields optional; tema_preferido is TemaPreferido enum;
  no email/nombre/password fields; partial update via exclude_unset.
- AvatarUpdate: validated Cloudinary URL (well-formed + cloud-name check).
- PresetFirmadoResponse: signature, timestamp, api_key, cloud_name, constraints.
- TipoUpload: enum with 'avatar' value (designed for future extension).
"""

import pytest
from pydantic import ValidationError

from app.models.enums import TemaPreferido


# ── PerfilUpdate ───────────────────────────────────────────────────────────────


class TestPerfilUpdate:
    """Spec: PATCH /api/me accepts any subset of optional fields."""

    def test_perfil_update_all_fields_optional(self):
        """Spec: empty payload is valid (no field required)."""
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate()
        assert p.telefono is None
        assert p.nombre_negocio is None
        assert p.tema_preferido is None

    def test_perfil_update_telefono_only(self):
        """Spec: only telefono is provided; other fields stay None."""
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(telefono="1122334455")
        assert p.telefono == "1122334455"
        assert p.nombre_negocio is None
        assert p.tema_preferido is None

    def test_perfil_update_nombre_negocio_only(self):
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(nombre_negocio="Kiosco Don Pepe")
        assert p.nombre_negocio == "Kiosco Don Pepe"
        assert p.telefono is None
        assert p.tema_preferido is None

    def test_perfil_update_tema_preferido_claro(self):
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(tema_preferido="CLARO")
        assert p.tema_preferido == TemaPreferido.CLARO

    def test_perfil_update_tema_preferido_oscuro(self):
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(tema_preferido="OSCURO")
        assert p.tema_preferido == TemaPreferido.OSCURO

    def test_perfil_update_invalid_tema_rejected(self):
        """Spec: tema_preferido outside CLARO/OSCURO → ValidationError."""
        from app.schemas.perfil import PerfilUpdate

        with pytest.raises(ValidationError):
            PerfilUpdate(tema_preferido="ROSA")

    def test_perfil_update_partial_via_exclude_unset(self):
        """Spec: only provided fields are exported via exclude_unset."""
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(telefono="1100000000", nombre_negocio="Acme")
        dumped = p.model_dump(exclude_unset=True)
        assert dumped == {"telefono": "1100000000", "nombre_negocio": "Acme"}

    def test_perfil_update_tema_only_excludes_other_fields(self):
        """Spec: with only tema_preferido set, dump excludes telefono/nombre_negocio."""
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(tema_preferido=TemaPreferido.OSCURO)
        dumped = p.model_dump(exclude_unset=True)
        assert dumped == {"tema_preferido": "OSCURO"}
        assert "telefono" not in dumped
        assert "nombre_negocio" not in dumped

    def test_perfil_update_no_identity_fields(self):
        """Spec: email/nombre/password MUST NOT be settable via PerfilUpdate."""
        from app.schemas.perfil import PerfilUpdate

        forbidden = {"email", "nombre", "password", "password_hash"}
        for field in forbidden:
            assert field not in PerfilUpdate.model_fields, (
                f"PerfilUpdate must NOT expose '{field}'"
            )

    def test_perfil_update_empty_telefono_accepted(self):
        """Spec: empty string telefono is accepted (clearing the field)."""
        from app.schemas.perfil import PerfilUpdate

        p = PerfilUpdate(telefono="")
        assert p.telefono == ""

    def test_perfil_update_telefono_max_length(self):
        """Spec: telefono longer than 30 chars is rejected."""
        from app.schemas.perfil import PerfilUpdate

        with pytest.raises(ValidationError):
            PerfilUpdate(telefono="1" * 31)

    def test_perfil_update_nombre_negocio_max_length(self):
        """Spec: nombre_negocio longer than 120 chars is rejected."""
        from app.schemas.perfil import PerfilUpdate

        with pytest.raises(ValidationError):
            PerfilUpdate(nombre_negocio="n" * 121)


# ── AvatarUpdate ───────────────────────────────────────────────────────────────


class TestAvatarUpdate:
    """Spec: POST /api/me/avatar requires a Cloudinary URL."""

    def test_avatar_update_valid_cloudinary_url(self):
        """Spec: a URL on the configured cloud is accepted.

        The test env CLOUDINARY_URL is cloudinary://key:secret@cloud, so the
        cloud_name is 'cloud'. A URL on res.cloudinary.com/cloud/... is valid.
        """
        from app.schemas.perfil import AvatarUpdate

        url = "https://res.cloudinary.com/cloud/image/upload/v1/avatar/x.jpg"
        a = AvatarUpdate(avatar_url=url)
        assert str(a.avatar_url) == url

    def test_avatar_update_malformed_url_rejected(self):
        """Spec: not a URL → ValidationError."""
        from app.schemas.perfil import AvatarUpdate

        with pytest.raises(ValidationError):
            AvatarUpdate(avatar_url="not-a-url")

    def test_avatar_update_non_cloudinary_host_rejected(self):
        """Spec: URL on a non-Cloudinary host is rejected (D4)."""
        from app.schemas.perfil import AvatarUpdate

        with pytest.raises(ValidationError):
            AvatarUpdate(avatar_url="https://evil.example.com/avatar.jpg")

    def test_avatar_update_wrong_cloud_name_rejected(self):
        """Spec: URL on res.cloudinary.com but a different cloud_name is rejected (D4)."""
        from app.schemas.perfil import AvatarUpdate

        with pytest.raises(ValidationError):
            AvatarUpdate(
                avatar_url="https://res.cloudinary.com/other-cloud/image/upload/v1/x.jpg"
            )

    def test_avatar_update_missing_url_rejected(self):
        """Spec: avatar_url is required."""
        from app.schemas.perfil import AvatarUpdate

        with pytest.raises(ValidationError):
            AvatarUpdate()


# ── TipoUpload ────────────────────────────────────────────────────────────────


class TestTipoUpload:
    """Spec: GET /api/cloudinary/preset-firmado?tipo=avatar accepts only known tipos."""

    def test_tipo_avatar_accepted(self):
        from app.schemas.perfil import TipoUpload

        assert TipoUpload.AVATAR.value == "avatar"

    def test_tipo_invalid_string_rejected(self):
        """Spec: an unknown tipo value is rejected."""
        from app.schemas.perfil import TipoUpload

        with pytest.raises(ValueError):
            TipoUpload("factura_invalida")


# ── PresetFirmadoResponse ────────────────────────────────────────────────────


class TestPresetFirmadoResponse:
    """Spec: signed-preset response shape — no secret is ever returned."""

    def test_preset_response_shape(self):
        from app.schemas.perfil import PresetFirmadoResponse

        resp = PresetFirmadoResponse(
            signature="abcdef1234567890",
            timestamp=1700000000,
            api_key="public-key-123",
            cloud_name="my-cloud",
            folder="avatars",
            allowed_formats=["pdf", "jpg", "png"],
            max_file_size=10_000_000,
        )
        assert resp.signature == "abcdef1234567890"
        assert resp.timestamp == 1700000000
        assert resp.api_key == "public-key-123"
        assert resp.cloud_name == "my-cloud"
        assert resp.folder == "avatars"
        assert resp.allowed_formats == ["pdf", "jpg", "png"]
        assert resp.max_file_size == 10_000_000

    def test_preset_response_no_secret_field(self):
        """Spec: the response model MUST NOT carry an api_secret field."""
        from app.schemas.perfil import PresetFirmadoResponse

        for forbidden in ("api_secret", "secret", "cloudinary_secret"):
            assert forbidden not in PresetFirmadoResponse.model_fields, (
                f"PresetFirmadoResponse must NOT expose '{forbidden}'"
            )
