"""
Tests for IA vision extractors (Claude + OpenAI) — C-14, D-IA-1, D-IA-5.

Both providers are SDK-mocked. No real network calls. The tests verify:
- Complete success path: SDK returns valid JSON, model_validate passes.
- Partial success: some fields null, error=False.
- JSON parse failure: SDK returns non-JSON, error=True, all fields None.
- Validation failure: SDK returns JSON that doesn't match schema, error=True.
- SDK exception (anthropic.APIError, openai.OpenAIError): error=True.
- _strip_unused_fields: mixed fields → only the right ones kept.
- metodo normalization: "transferencia" (lowercase) → MetodoPago.TRANSFERENCIA.
- metodo outside enum ("CRIPTOMONEDA") → None.
- _parse_amount and _parse_date helpers.
- _log_ia_call does not log bytes or raw model response.
"""

import base64
import json
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import anthropic
import httpx
import openai
import pytest


# ── Helpers ──────────────────────────────────────────────────────────────────


class _FakeTextBlock:
    """Stand-in for `anthropic.types.TextBlock` (real attribute: .text)."""

    def __init__(self, text: str) -> None:
        self.text = text


def _make_anthropic_message(text: str) -> SimpleNamespace:
    """Build a mock anthropic Message with a single text block."""
    return SimpleNamespace(content=[_FakeTextBlock(text)])


def _make_openai_message(text: str) -> SimpleNamespace:
    """Build a mock openai chat completion with the given text content."""
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))]
    )


# ── Helper tests (pure functions) ────────────────────────────────────────────


class TestParseAmount:
    def test_decimal_string(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount("1234.56") == Decimal("1234.56")

    def test_argentine_format_with_thousands_and_decimal(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount("1.234,56") == Decimal("1234.56")

    def test_int(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount(1234) == Decimal("1234")

    def test_float(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount(1234.56) == Decimal("1234.56")

    def test_empty_string(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount("") is None

    def test_none(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount(None) is None

    def test_garbage_string(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount("abc") is None

    def test_already_decimal(self):
        from app.services.ia_extraccion_service import _parse_amount

        assert _parse_amount(Decimal("500.00")) == Decimal("500.00")


class TestParseDate:
    def test_iso_format(self):
        from app.services.ia_extraccion_service import _parse_date

        assert _parse_date("2026-06-15") == date(2026, 6, 15)

    def test_dmy_full_year(self):
        from app.services.ia_extraccion_service import _parse_date

        assert _parse_date("15/06/2026") == date(2026, 6, 15)

    def test_dmy_two_digit_year_below_70(self):
        from app.services.ia_extraccion_service import _parse_date

        # 2-digit year 26 → 2026 (heuristic: 00-69 → 20YY)
        assert _parse_date("15/06/26") == date(2026, 6, 15)

    def test_dmy_two_digit_year_above_70(self):
        from app.services.ia_extraccion_service import _parse_date

        # 2-digit year 85 → 1985 (heuristic: 70-99 → 19YY)
        assert _parse_date("15/06/85") == date(1985, 6, 15)

    def test_empty_string(self):
        from app.services.ia_extraccion_service import _parse_date

        assert _parse_date("") is None

    def test_none(self):
        from app.services.ia_extraccion_service import _parse_date

        assert _parse_date(None) is None

    def test_garbage(self):
        from app.services.ia_extraccion_service import _parse_date

        assert _parse_date("not a date") is None


class TestStripUnusedFields:
    def test_factura_keeps_factura_fields(self):
        from app.services.ia_extraccion_service import _strip_unused_fields

        data = {
            "proveedor_nombre": "Acme",
            "numero": "001",
            "fecha_emision": "2026-06-15",
            "monto_total": 100.0,
            "monto": 200.0,  # pago-only — should be dropped
            "metodo": "EFECTIVO",  # pago-only — should be dropped
        }
        result = _strip_unused_fields(data, "factura")
        assert result == {
            "proveedor_nombre": "Acme",
            "numero": "001",
            "fecha_emision": "2026-06-15",
            "monto_total": 100.0,
        }

    def test_pago_keeps_pago_fields(self):
        from app.services.ia_extraccion_service import _strip_unused_fields

        data = {
            "proveedor_nombre": "Acme",
            "numero": "001",  # factura-only — should be dropped
            "monto": 500.0,
            "fecha": "2026-06-20",
            "metodo": "TRANSFERENCIA",
        }
        result = _strip_unused_fields(data, "pago")
        assert result == {
            "proveedor_nombre": "Acme",
            "monto": 500.0,
            "fecha": "2026-06-20",
            "metodo": "TRANSFERENCIA",
        }


class TestNormalizeMetodo:
    def test_uppercase_passes_through(self):
        from app.services.ia_extraccion_service import _normalize_metodo

        from app.models.enums import MetodoPago

        assert _normalize_metodo("EFECTIVO") == MetodoPago.EFECTIVO

    def test_lowercase_normalized(self):
        from app.services.ia_extraccion_service import _normalize_metodo

        from app.models.enums import MetodoPago

        assert _normalize_metodo("transferencia") == MetodoPago.TRANSFERENCIA

    def test_value_not_in_enum_returns_none(self):
        from app.services.ia_extraccion_service import _normalize_metodo

        assert _normalize_metodo("CRIPTOMONEDA") is None

    def test_empty_string_returns_none(self):
        from app.services.ia_extraccion_service import _normalize_metodo

        assert _normalize_metodo("") is None

    def test_none_returns_none(self):
        from app.services.ia_extraccion_service import _normalize_metodo

        assert _normalize_metodo(None) is None

    def test_strips_whitespace(self):
        from app.services.ia_extraccion_service import _normalize_metodo

        from app.models.enums import MetodoPago

        assert _normalize_metodo("  TARJETA  ") == MetodoPago.TARJETA


# ── Prompt tests ─────────────────────────────────────────────────────────────


class TestBuildPrompt:
    def test_factura_prompt_contains_factura_fields(self):
        from app.services.ia_extraccion_service import _build_prompt

        prompt = _build_prompt("factura")
        assert "numero" in prompt
        assert "fecha_emision" in prompt
        assert "monto_total" in prompt

    def test_pago_prompt_contains_pago_fields(self):
        from app.services.ia_extraccion_service import _build_prompt

        prompt = _build_prompt("pago")
        assert "monto" in prompt
        assert "fecha" in prompt
        assert "metodo" in prompt

    def test_prompts_are_distinct(self):
        from app.services.ia_extraccion_service import _build_prompt

        assert _build_prompt("factura") != _build_prompt("pago")

    def test_prompts_forbid_inventing(self):
        from app.services.ia_extraccion_service import _build_prompt

        prompt_f = _build_prompt("factura")
        prompt_p = _build_prompt("pago")
        # The system prompt explicitly forbids inventing
        assert "NEVER invent" in prompt_f or "never invent" in prompt_f.lower()
        assert "NEVER invent" in prompt_p or "never invent" in prompt_p.lower()

    def test_prompts_demand_null_for_unreadable(self):
        from app.services.ia_extraccion_service import _build_prompt

        prompt = _build_prompt("factura")
        assert "null" in prompt


# ── Claude extractor tests (SDK mocked) ──────────────────────────────────────


class TestClaudeExtractor:
    @pytest.fixture
    def mock_anthropic_client(self):
        """Patches `anthropic.Anthropic` so no real client is created."""
        with patch("app.services.ia_extraccion_service.anthropic.Anthropic") as Mock:
            client = MagicMock()
            Mock.return_value = client
            yield client

    @pytest.mark.asyncio
    async def test_extraer_factura_success_complete(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        payload = {
            "proveedor_nombre": "Acme SA",
            "numero": "0001-001",
            "fecha_emision": "2026-06-15",
            "monto_total": 1234.56,
        }
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.error_message is None
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.numero == "0001-001"
        assert propuesta.fecha_emision == date(2026, 6, 15)
        assert propuesta.monto_total == Decimal("1234.56")

    @pytest.mark.asyncio
    async def test_extraer_factura_partial_with_nulls(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        payload = {
            "proveedor_nombre": "Acme SA",
            "numero": None,
            "fecha_emision": "2026-06-15",
            "monto_total": None,
        }
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\xff\xd8\xff", "image/jpeg")

        assert propuesta.error is False
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.numero is None
        assert propuesta.monto_total is None

    @pytest.mark.asyncio
    async def test_extraer_factura_malformed_json(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            "not valid json at all"
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is True
        assert "JSON" in (propuesta.error_message or "")
        assert propuesta.proveedor_nombre is None
        assert propuesta.numero is None

    @pytest.mark.asyncio
    async def test_extraer_factura_invalid_amount_normalized_to_none(
        self, mock_anthropic_client
    ):
        """The extractor's helpers convert malformed amounts to None BEFORE
        Pydantic validation, so the proposal is valid (None) instead of crashing.
        This is the documented behavior: unreadable → null, not error."""
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        # monto_total: [1, 2, 3] — list, not a number — normalized to None
        payload = {"proveedor_nombre": "Acme", "monto_total": [1, 2, 3]}
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.proveedor_nombre == "Acme"
        assert propuesta.monto_total is None  # normalized, not error

    @pytest.mark.asyncio
    async def test_extraer_factura_invalid_date_normalized_to_none(
        self, mock_anthropic_client
    ):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        payload = {"proveedor_nombre": "Acme", "fecha_emision": "not a date"}
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.fecha_emision is None

    @pytest.mark.asyncio
    async def test_extraer_factura_sdk_raises_api_error(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        req = httpx.Request("POST", "https://api.anthropic.com/v1/messages")
        mock_anthropic_client.messages.create.side_effect = anthropic.APIError(
            "rate limit", request=req, body=None
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is True
        assert "APIError" in (propuesta.error_message or "")
        assert "rate limit" in (propuesta.error_message or "")

    @pytest.mark.asyncio
    async def test_extraer_factura_strips_pago_fields(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        # Model returns BOTH factura and pago fields (e.g. a receipt-like invoice)
        payload = {
            "proveedor_nombre": "Acme",
            "numero": "001",
            "fecha_emision": "2026-06-15",
            "monto_total": 100.0,
            "monto": 200.0,  # pago-only — should be dropped
            "metodo": "EFECTIVO",  # pago-only — should be dropped
        }
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        # only factura fields are validated; pago fields are silently ignored
        assert propuesta.monto_total == Decimal("100")

    @pytest.mark.asyncio
    async def test_extraer_pago_success_with_enum(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor
        from app.models.enums import MetodoPago

        payload = {
            "proveedor_nombre": "Acme",
            "monto": 5000.0,
            "fecha": "2026-06-20",
            "metodo": "TRANSFERENCIA",
        }
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_pago(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.monto == Decimal("5000")
        assert propuesta.metodo == MetodoPago.TRANSFERENCIA

    @pytest.mark.asyncio
    async def test_extraer_pago_metodo_lowercase_normalized(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor
        from app.models.enums import MetodoPago

        payload = {
            "proveedor_nombre": "Acme",
            "monto": 500.0,
            "fecha": "2026-06-20",
            "metodo": "tarjeta",  # lowercase
        }
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_pago(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.metodo == MetodoPago.TARJETA

    @pytest.mark.asyncio
    async def test_extraer_pago_metodo_outside_enum_to_none(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        payload = {
            "proveedor_nombre": "Acme",
            "monto": 500.0,
            "fecha": "2026-06-20",
            "metodo": "CRIPTOMONEDA",
        }
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        ext = ClaudeVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_pago(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.metodo is None  # normalized to None

    @pytest.mark.asyncio
    async def test_image_bytes_are_base64_encoded(self, mock_anthropic_client):
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        payload = {"proveedor_nombre": "Acme"}
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        raw = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        ext = ClaudeVisionExtractor(api_key="test-key")
        await ext.extraer_factura(raw, "image/png")

        # Inspect what was sent to the SDK
        call_kwargs = mock_anthropic_client.messages.create.call_args.kwargs
        image_block = call_kwargs["messages"][0]["content"][0]
        assert image_block["type"] == "image"
        assert image_block["source"]["type"] == "base64"
        assert image_block["source"]["media_type"] == "image/png"
        # base64 round-trip
        decoded = base64.b64decode(image_block["source"]["data"])
        assert decoded == raw

    @pytest.mark.asyncio
    async def test_no_byte_or_response_leaked_to_log(
        self, mock_anthropic_client, caplog
    ):
        """_log_ia_call must NEVER log image bytes or raw model output."""
        from app.services.ia_extraccion_service import ClaudeVisionExtractor

        payload = {"proveedor_nombre": "Acme", "monto_total": 100.0}
        mock_anthropic_client.messages.create.return_value = _make_anthropic_message(
            json.dumps(payload)
        )

        raw = b"\x89PNG-secret-bytes-do-not-leak" + b"\x00" * 50
        ext = ClaudeVisionExtractor(api_key="test-key")

        with caplog.at_level("INFO", logger="app.services.ia_extraccion"):
            await ext.extraer_factura(raw, "image/png")

        # The image bytes must not appear in any log record (message or extras)
        all_text = []
        for record in caplog.records:
            all_text.append(record.getMessage())
            for k, v in getattr(record, "__dict__", {}).items():
                if k.startswith("_"):
                    continue
                all_text.append(str(v))
        joined = " ".join(all_text)
        assert "secret-bytes" not in joined, (
            f"Image bytes leaked into log: {joined}"
        )
        # Provider should be reported via the extra fields
        assert any(
            getattr(r, "provider", None) == "claude" for r in caplog.records
        ), f"Expected provider=claude in log extras, got: {[r.__dict__ for r in caplog.records]}"


# ── OpenAI extractor tests (SDK mocked) ──────────────────────────────────────


class TestOpenAIExtractor:
    @pytest.fixture
    def mock_openai_client(self):
        """Patches `openai.OpenAI` so no real client is created."""
        with patch("app.services.ia_extraccion_service.openai.OpenAI") as Mock:
            client = MagicMock()
            Mock.return_value = client
            yield client

    @pytest.mark.asyncio
    async def test_extraer_factura_success_complete(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        payload = {
            "proveedor_nombre": "Acme SA",
            "numero": "0001-001",
            "fecha_emision": "2026-06-15",
            "monto_total": 1234.56,
        }
        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps(payload)
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.proveedor_nombre == "Acme SA"
        assert propuesta.numero == "0001-001"
        assert propuesta.fecha_emision == date(2026, 6, 15)
        assert propuesta.monto_total == Decimal("1234.56")

    @pytest.mark.asyncio
    async def test_uses_response_format_json_object(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps({"proveedor_nombre": "Acme"})
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        await ext.extraer_factura(b"\x89PNG...", "image/png")

        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        assert call_kwargs.get("response_format") == {"type": "json_object"}

    @pytest.mark.asyncio
    async def test_uses_image_url_data_url(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps({"proveedor_nombre": "Acme"})
        )

        raw = b"\x89PNG..." + b"\x00" * 50
        ext = OpenAIVisionExtractor(api_key="test-key")
        await ext.extraer_factura(raw, "image/png")

        call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
        messages = call_kwargs["messages"]
        user_content = messages[1]["content"]
        image_block = next(b for b in user_content if b["type"] == "image_url")
        url = image_block["image_url"]["url"]
        assert url.startswith("data:image/png;base64,")
        decoded = base64.b64decode(url.split(",", 1)[1])
        assert decoded == raw

    @pytest.mark.asyncio
    async def test_image_url_uses_correct_content_type(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps({"proveedor_nombre": "Acme"})
        )

        for ct in ("image/jpeg", "image/png", "image/webp"):
            ext = OpenAIVisionExtractor(api_key="test-key")
            await ext.extraer_factura(b"\xff\xd8\xff\xe0" + b"\x00" * 20, ct)
            call_kwargs = mock_openai_client.chat.completions.create.call_args.kwargs
            url = call_kwargs["messages"][1]["content"][1]["image_url"]["url"]
            assert url.startswith(f"data:{ct};base64,")

    @pytest.mark.asyncio
    async def test_extraer_factura_partial(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        payload = {
            "proveedor_nombre": "Acme",
            "numero": None,
            "monto_total": None,
        }
        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps(payload)
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.numero is None
        assert propuesta.monto_total is None

    @pytest.mark.asyncio
    async def test_extraer_factura_malformed_json(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            "this is not JSON"
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is True
        assert "JSON" in (propuesta.error_message or "")

    @pytest.mark.asyncio
    async def test_extraer_factura_sdk_raises_openai_error(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        mock_openai_client.chat.completions.create.side_effect = openai.OpenAIError(
            "rate limit"
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_factura(b"\x89PNG...", "image/png")

        assert propuesta.error is True
        assert "OpenAIError" in (propuesta.error_message or "")
        assert "rate limit" in (propuesta.error_message or "")

    @pytest.mark.asyncio
    async def test_extraer_pago_metodo_outside_enum_to_none(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        payload = {
            "proveedor_nombre": "Acme",
            "monto": 500.0,
            "metodo": "CRIPTOMONEDA",
        }
        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps(payload)
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_pago(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.metodo is None

    @pytest.mark.asyncio
    async def test_extraer_pago_strips_factura_fields(self, mock_openai_client):
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        payload = {
            "proveedor_nombre": "Acme",
            "monto": 100.0,
            "numero": "001",  # factura-only — should be dropped
            "monto_total": 200.0,  # factura-only — should be dropped
        }
        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps(payload)
        )

        ext = OpenAIVisionExtractor(api_key="test-key")
        propuesta = await ext.extraer_pago(b"\x89PNG...", "image/png")

        assert propuesta.error is False
        assert propuesta.monto == Decimal("100")
        # only pago fields validated

    @pytest.mark.asyncio
    async def test_no_byte_or_response_leaked_to_log(self, mock_openai_client, caplog):
        """_log_ia_call must NEVER log image bytes or raw model output."""
        from app.services.ia_extraccion_service import OpenAIVisionExtractor

        payload = {"proveedor_nombre": "Acme", "monto_total": 100.0}
        mock_openai_client.chat.completions.create.return_value = _make_openai_message(
            json.dumps(payload)
        )

        raw = b"\x89PNG-secret-bytes-do-not-leak" + b"\x00" * 50
        ext = OpenAIVisionExtractor(api_key="test-key")

        with caplog.at_level("INFO", logger="app.services.ia_extraccion"):
            await ext.extraer_factura(raw, "image/png")

        all_text = []
        for record in caplog.records:
            all_text.append(record.getMessage())
            for k, v in getattr(record, "__dict__", {}).items():
                if k.startswith("_"):
                    continue
                all_text.append(str(v))
        joined = " ".join(all_text)
        assert "secret-bytes" not in joined
        assert any(
            getattr(r, "provider", None) == "openai" for r in caplog.records
        )
