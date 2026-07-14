"""
Tests for the VisionExtractor factory (C-14, D-IA-6).

Covers:
- get_vision_extractor() returns ClaudeVisionExtractor when VISION_PROVIDER=claude
- get_vision_extractor() returns OpenAIVisionExtractor when VISION_PROVIDER=openai
- get_vision_extractor() is a cached singleton (same instance across calls)
- get_vision_extractor() raises ValueError for unsupported VISION_PROVIDER
- VisionExtractor is a typing.Protocol with the right methods
- The protocol can be checked at runtime via @runtime_checkable
"""

from typing import Protocol


# ── Protocol introspection ────────────────────────────────────────────────────


class TestVisionExtractorProtocol:
    def test_protocol_exists(self):
        from app.services.ia_extraccion_service import VisionExtractor

        assert VisionExtractor is not None

    def test_protocol_is_typing_protocol(self):
        from app.services.ia_extraccion_service import VisionExtractor

        # A Protocol has the _is_protocol attribute (set by typing internals)
        assert getattr(VisionExtractor, "_is_protocol", False) is True

    def test_protocol_has_extraer_factura_and_extraer_pago(self):
        from app.services.ia_extraccion_service import VisionExtractor

        # hasattr works on Protocol because the methods are declared
        assert hasattr(VisionExtractor, "extraer_factura")
        assert hasattr(VisionExtractor, "extraer_pago")

    def test_structural_protocol_satisfied_by_stub(self):
        """A stub class that defines the right methods satisfies the Protocol
        without explicit inheritance — Protocol is structural, not nominal."""
        from app.services.ia_extraccion_service import VisionExtractor
        from app.schemas.factura import PropuestaFactura
        from app.schemas.pago import PropuestaPago

        class StubExtractor:
            def extraer_factura(self, imagen_bytes, content_type) -> PropuestaFactura:
                return PropuestaFactura()

            def extraer_pago(self, imagen_bytes, content_type) -> PropuestaPago:
                return PropuestaPago()

        # @runtime_checkable allows isinstance()
        assert isinstance(StubExtractor(), VisionExtractor)

    def test_structural_protocol_rejects_incomplete_stub(self):
        from app.services.ia_extraccion_service import VisionExtractor
        from app.schemas.factura import PropuestaFactura

        class IncompleteStub:
            def extraer_factura(self, imagen_bytes, content_type) -> PropuestaFactura:
                return PropuestaFactura()
            # Missing extraer_pago

        assert not isinstance(IncompleteStub(), VisionExtractor)


# ── Factory behavior ──────────────────────────────────────────────────────────


class TestFactory:
    def test_claude_provider_returns_claude_extractor(self, monkeypatch):
        from app.services import ia_extraccion_service as svc

        monkeypatch.setenv("VISION_PROVIDER", "claude")
        # C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings`
        # is no longer cached.
        svc.get_vision_extractor.cache_clear()

        ext = svc.get_vision_extractor()
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        assert isinstance(ext, ClaudeVisionExtractor)

    def test_openai_provider_returns_openai_extractor(self, monkeypatch):
        from app.services import ia_extraccion_service as svc

        monkeypatch.setenv("VISION_PROVIDER", "openai")
        # C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings`
        # is no longer cached.
        svc.get_vision_extractor.cache_clear()

        ext = svc.get_vision_extractor()
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        assert isinstance(ext, OpenAIVisionExtractor)

    def test_singleton_same_instance(self, monkeypatch):
        from app.services import ia_extraccion_service as svc

        monkeypatch.setenv("VISION_PROVIDER", "claude")
        # C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings`
        # is no longer cached.
        svc.get_vision_extractor.cache_clear()

        ext1 = svc.get_vision_extractor()
        ext2 = svc.get_vision_extractor()
        assert ext1 is ext2  # @lru_cache

    def test_invalid_provider_raises_value_error(self, monkeypatch):
        """If VISION_PROVIDER is somehow not in {claude, openai} (defensive),
        the factory raises ValueError."""
        from app.services import ia_extraccion_service as svc

        # Bypass Settings validator by directly monkey-patching `get_settings`
        # in the ia_extraccion_service module — this is a defensive branch
        # in the factory that shouldn't normally be reachable.
        # C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings`
        # is no longer cached.
        svc.get_vision_extractor.cache_clear()

        class _FakeSettings:
            VISION_PROVIDER = "bogus"
            ANTHROPIC_API_KEY = "x"
            OPENAI_API_KEY = "y"

        monkeypatch.setattr(svc, "get_settings", lambda: _FakeSettings())

        with __import__("pytest").raises(ValueError, match=r"bogus"):
            svc.get_vision_extractor()

    def test_cache_survives_settings_mutation(self, monkeypatch):
        """The @lru_cache is by design — the factory is called once per process.
        Changing VISION_PROVIDER after the first call does NOT swap the
        instance (single-instance MVP). cache_clear() resets it explicitly."""
        from app.services import ia_extraccion_service as svc

        monkeypatch.setenv("VISION_PROVIDER", "claude")
        # C-16 (D-3): `get_settings.cache_clear()` removed — `get_settings`
        # is no longer cached.
        svc.get_vision_extractor.cache_clear()

        first = svc.get_vision_extractor()

        # Change env without clearing cache
        monkeypatch.setenv("VISION_PROVIDER", "openai")
        # factory cache NOT cleared, so we still get the original instance
        second = svc.get_vision_extractor()
        assert first is second
