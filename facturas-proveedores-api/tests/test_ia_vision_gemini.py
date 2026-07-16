"""
Tests for the Gemini vision provider (free-tier, OpenAI-compatible endpoint).

Gemini exposes an OpenAI-compatible API, so `GeminiVisionExtractor` reuses
`OpenAIVisionExtractor`'s request/parse logic and only overrides the provider
label, the default model and the base_url. All SDK calls are mocked — no real
network, no tokens spent (project rule 9: external services always mocked).

Covers:
- GeminiVisionExtractor points the OpenAI SDK at Gemini's base_url.
- Provider label is "gemini" (for the IA call log).
- Success path parses JSON exactly like the OpenAI extractor.
- Markdown-fenced JSON (```json ... ```) is stripped and parsed — Gemini
  sometimes wraps the object in a code fence even with response_format set.
- Default model is overridable via constructor.
- The factory returns a GeminiVisionExtractor when VISION_PROVIDER=gemini.
- The `_parse_model_json` pure helper strips fences for every provider.
"""

import json
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest


GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"


def _make_openai_message(text: str) -> SimpleNamespace:
    """Build a mock openai chat completion with the given text content."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))]
    )


# ── _parse_model_json pure helper ─────────────────────────────────────────────


class TestParseModelJson:
    def test_plain_json_object(self):
        from app.services.ia_extraccion_service import _parse_model_json

        assert _parse_model_json('{"a": 1}') == {"a": 1}

    def test_strips_json_fence(self):
        from app.services.ia_extraccion_service import _parse_model_json

        fenced = '```json\n{"a": 1}\n```'
        assert _parse_model_json(fenced) == {"a": 1}

    def test_strips_bare_fence(self):
        from app.services.ia_extraccion_service import _parse_model_json

        fenced = '```\n{"a": 1}\n```'
        assert _parse_model_json(fenced) == {"a": 1}

    def test_surrounding_whitespace(self):
        from app.services.ia_extraccion_service import _parse_model_json

        assert _parse_model_json('  \n{"a": 1}\n  ') == {"a": 1}

    def test_non_object_raises(self):
        from app.services.ia_extraccion_service import _parse_model_json

        with pytest.raises(ValueError):
            _parse_model_json("[1, 2, 3]")

    def test_malformed_raises(self):
        from app.services.ia_extraccion_service import _parse_model_json

        with pytest.raises((ValueError, json.JSONDecodeError)):
            _parse_model_json("not json at all")


# ── GeminiVisionExtractor ─────────────────────────────────────────────────────


class TestGeminiExtractor:
    @pytest.fixture
    def mock_openai_client(self):
        """Patches `openai.OpenAI` so no real client is created."""
        with patch("app.services.ia_extraccion_service.openai.OpenAI") as Mock:
            client = MagicMock()
            Mock.return_value = client
            yield Mock, client

    def test_provider_label_is_gemini(self):
        from app.services.ia_extraccion_service import GeminiVisionExtractor

        assert GeminiVisionExtractor.PROVIDER == "gemini"

    def test_points_sdk_at_gemini_base_url(self, mock_openai_client):
        from app.services.ia_extraccion_service import GeminiVisionExtractor

        Mock, _client = mock_openai_client
        GeminiVisionExtractor(api_key="test-key")

        call_kwargs = Mock.call_args.kwargs
        assert call_kwargs.get("base_url") == GEMINI_BASE_URL
        assert call_kwargs.get("api_key") == "test-key"

    def test_honors_custom_model(self, mock_openai_client):
        from app.services.ia_extraccion_service import GeminiVisionExtractor

        ext = GeminiVisionExtractor(api_key="k", model="gemini-custom")
        assert ext._model == "gemini-custom"

    @pytest.mark.asyncio
    async def test_extraer_factura_success(self, mock_openai_client):
        from app.services.ia_extraccion_service import GeminiVisionExtractor

        _Mock, client = mock_openai_client
        payload = {
            "proveedor_nombre": "Gemini SA",
            "numero": "0001-002",
            "fecha_emision": "2026-06-20",
            "monto_total": 5000.00,
        }
        client.chat.completions.create.return_value = _make_openai_message(
            json.dumps(payload)
        )

        ext = GeminiVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.proveedor_nombre == "Gemini SA"
        assert propuesta.monto_total == Decimal("5000.00")
        assert propuesta.fecha_emision == date(2026, 6, 20)

    @pytest.mark.asyncio
    async def test_strips_markdown_fenced_json(self, mock_openai_client):
        from app.services.ia_extraccion_service import GeminiVisionExtractor

        _Mock, client = mock_openai_client
        payload = {"proveedor_nombre": "Fenced SA", "monto_total": 100}
        fenced = f"```json\n{json.dumps(payload)}\n```"
        client.chat.completions.create.return_value = _make_openai_message(fenced)

        ext = GeminiVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        # Without fence-stripping this would be error=True (JSON parse error).
        assert propuesta.error is False
        assert propuesta.proveedor_nombre == "Fenced SA"


# ── Factory ───────────────────────────────────────────────────────────────────


class TestGeminiFactory:
    def test_gemini_provider_returns_gemini_extractor(self, monkeypatch):
        from app.services import ia_extraccion_service as svc
        from app.services.ia_extraccion_service import GeminiVisionExtractor

        monkeypatch.setenv("VISION_PROVIDER", "gemini")
        monkeypatch.setenv("GEMINI_API_KEY", "test-gemini-key")
        svc.get_vision_extractor.cache_clear()

        # Patch the SDK so no real client is constructed by the factory.
        with patch("app.services.ia_extraccion_service.openai.OpenAI"):
            ext = svc.get_vision_extractor()

        assert isinstance(ext, GeminiVisionExtractor)
        svc.get_vision_extractor.cache_clear()
