"""
IA vision extraction service (C-14).

This module owns:
- The `VisionExtractor` Protocol (the abstraction the routers depend on).
- Two concrete implementations: `ClaudeVisionExtractor` (Anthropic SDK) and
  `OpenAIVisionExtractor` (OpenAI SDK).
- A cached factory `get_vision_extractor()` keyed off `settings.VISION_PROVIDER`.
- Pure helpers (`_parse_amount`, `_parse_date`, `_strip_unused_fields`,
  `_normalize_metodo`, `_build_prompt`) used by both extractors.

Architectural rules (RN-IA-01..06):
- Extractors NEVER persist. They receive image bytes and return a
  `PropuestaFactura` / `PropuestaPago` proposal — nothing more.
- Extractors NEVER raise. Any exception (SDK, network, JSON parse,
  Pydantic validation) is encapsulated into `error=True` + `error_message`.
- Extractors NEVER log raw image bytes or raw model responses. They
  log a minimal `usuario_id, endpoint, provider, latency_ms, success,
  error_class` envelope.
- Extractors NEVER match the supplier name against the user's
  `Proveedor` table — that is the frontend's job (RN-IA-06).
"""

import base64
import json
import logging
import time
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from functools import lru_cache
from typing import Any, Literal, Optional, Protocol, runtime_checkable

import anthropic
import openai

from app.core.config import get_settings
from app.models.enums import MetodoPago
from app.schemas.factura import PropuestaFactura
from app.schemas.pago import PropuestaPago

logger = logging.getLogger("app.services.ia_extraccion")


# ── Protocol ─────────────────────────────────────────────────────────────────


@runtime_checkable
class VisionExtractor(Protocol):
    """
    Abstraction over a vision-capable LLM provider.

    The routers depend on this Protocol, not on a concrete class. Two
    concrete implementations live in this module: `ClaudeVisionExtractor`
    (uses `anthropic`) and `OpenAIVisionExtractor` (uses `openai`).

    Marked `@runtime_checkable` so tests can assert contract compliance
    with `isinstance(stub, VisionExtractor)`.
    """

    def extraer_factura(
        self, imagen_bytes: bytes, content_type: str
    ) -> PropuestaFactura: ...

    def extraer_pago(
        self, imagen_bytes: bytes, content_type: str
    ) -> PropuestaPago: ...


# ── Shared system prompt ─────────────────────────────────────────────────────


_FACTURA_FIELDS = ("proveedor_nombre", "numero", "fecha_emision", "monto_total")
_PAGO_FIELDS = ("proveedor_nombre", "monto", "fecha", "metodo")
_VALID_METODOS = {m.value for m in MetodoPago}

_SYSTEM_PROMPT_TEMPLATE = """\
You are an information extractor for a personal-finance app. You receive ONE image of an
Argentine invoice (Factura) or payment receipt (Comprobante de Pago). Your only job is to
read the visible header and return a single JSON object.

RULES (NON-NEGOTIABLE):
- Extract ONLY header fields. Line items, product lists, taxes are NOT extracted.
- If a field is unreadable, partially visible, or uncertain, return null for that field.
  NEVER invent, guess, or estimate a value.
- Dates must be ISO-8601 (YYYY-MM-DD). If only "DD/MM/YY" is visible, expand to YYYY-MM-DD
  assuming 20YY for two-digit years in the 00-69 range, 19YY for 70-99.
- Amounts must be numbers (no thousands separator). If the amount is unreadable, return null.
  NEVER compute subtotals + IVA yourself.
- Proveedor (vendor) name: return the legal/commercial name as printed on the document.
  If the user is a consumer (the document is addressed to "Consumidor Final"), return null.
  Do NOT return the seller's own tax ID as the name.
- Return ONLY the JSON object. No commentary, no markdown fences, no extra text.

SCHEMA (JSON object, all fields nullable):
{{
  "proveedor_nombre": string | null,
  "numero": string | null,            // only for invoices
  "fecha_emision": string | null,     // ISO date, only for invoices
  "monto_total": number | null,       // only for invoices
  "monto": number | null,             // only for payments
  "fecha": string | null,             // ISO date, only for payments
  "metodo": string | null             // one of: {metodos}, only for payments
}}

For an {documento} return ONLY the fields that apply:
  {campos}
"""


def _build_prompt(documento: Literal["factura", "pago"]) -> str:
    """Build the shared system prompt for a given document type."""
    campos = ", ".join(_FACTURA_FIELDS if documento == "factura" else _PAGO_FIELDS)
    return _SYSTEM_PROMPT_TEMPLATE.format(
        documento=documento, campos=campos, metodos="|".join(sorted(_VALID_METODOS))
    )


_USER_PROMPT = "Extract the JSON described above from the attached image."


# ── Pure helpers ─────────────────────────────────────────────────────────────


def _parse_amount(value: Any) -> Optional[Decimal]:
    """
    Parse an amount that may be a number, a string with '.' thousands
    separator, or an Argentine-formatted string with ',' as decimal.

    Returns None if parsing fails — never raises (the extractor never
    raises; this helper is part of that contract).
    """
    if value is None:
        return None
    if isinstance(value, (int, float, Decimal)):
        try:
            return Decimal(str(value))
        except (InvalidOperation, ValueError):
            return None
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        # Argentine format: '1.234,56' -> '1234.56'
        if "," in s and "." in s and s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        elif "," in s:
            s = s.replace(",", ".")
        try:
            return Decimal(s)
        except (InvalidOperation, ValueError):
            return None
    return None


def _parse_date(value: Any) -> Optional[date]:
    """
    Parse a date that may be an ISO-8601 string, a DD/MM/YYYY string,
    or a DD/MM/YY string (with 20YY/19YY heuristic).

    Returns None if parsing fails.
    """
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    if not isinstance(value, str):
        return None
    s = value.strip()
    if not s:
        return None
    # ISO-8601
    try:
        return date.fromisoformat(s)
    except (ValueError, TypeError):
        pass
    # DD/MM/YYYY or DD/MM/YY
    for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y", "%d-%m-%y"):
        try:
            d = datetime.strptime(s, fmt).date()
            if d.year < 100:
                # 2-digit year: 00-69 -> 20YY, 70-99 -> 19YY
                d = d.replace(year=2000 + d.year if d.year < 70 else 1900 + d.year)
            return d
        except (ValueError, TypeError):
            continue
    return None


def _strip_unused_fields(
    data: dict, documento: Literal["factura", "pago"]
) -> dict:
    """
    Keep only the fields that apply to the document type. The shared
    schema sent to the model has fields for both facturas and pagos;
    we drop the unused ones before Pydantic validation so a `metodo`
    returned for a factura (or vice versa) is silently ignored.
    """
    keep = _FACTURA_FIELDS if documento == "factura" else _PAGO_FIELDS
    return {k: v for k, v in data.items() if k in keep}


def _parse_model_json(text: str) -> dict:
    """
    Parse the model's text response into a JSON object.

    Vision models sometimes wrap the JSON in a markdown code fence
    (```json ... ```) even when told not to — notably Gemini via its
    OpenAI-compatible endpoint. This helper strips an optional fence and
    surrounding whitespace before parsing.

    Raises `json.JSONDecodeError` if the text is not valid JSON, or
    `ValueError` if the parsed value is not a JSON object. Both extractors
    catch these and encapsulate them into `error=True` (RN-IA-05).
    """
    s = text.strip()
    if s.startswith("```"):
        s = s[3:]
        if s[:4].lower() == "json":
            s = s[4:]
        s = s.rstrip()
        if s.endswith("```"):
            s = s[:-3]
        s = s.strip()
    data = json.loads(s)
    if not isinstance(data, dict):
        raise ValueError("model response is not a JSON object")
    return data


def _normalize_metodo(value: Any) -> Optional[MetodoPago]:
    """
    Uppercase + strip the model's response and map it to a `MetodoPago`
    enum. Any value outside the enum is normalized to None (RN-IA-03 —
    the IA never invents a payment method that doesn't exist in our domain).
    """
    if value is None or not isinstance(value, str):
        return None
    s = value.strip().upper()
    if not s:
        return None
    try:
        return MetodoPago(s)
    except ValueError:
        return None


def _log_ia_call(
    *,
    usuario_id: Optional[Any],
    endpoint: str,
    provider: str,
    latency_ms: int,
    success: bool,
    error_class: Optional[str],
) -> None:
    """
    Minimal IA call log. NEVER logs image bytes or raw model output
    (privacy + cost). Fields follow the security baseline in the KB.
    """
    try:
        user_repr = str(usuario_id) if usuario_id is not None else "anonymous"
    except Exception:
        user_repr = "<unrepr>"
    logger.info(
        "ia_call",
        extra={
            "usuario_id": user_repr,
            "endpoint": endpoint,
            "provider": provider,
            "latency_ms": latency_ms,
            "success": success,
            "error_class": error_class,
        },
    )


# ── ClaudeVisionExtractor ─────────────────────────────────────────────────────


class ClaudeVisionExtractor:
    """
    Extracts invoice / payment headers from images using Anthropic Claude.

    The `anthropic.Anthropic` client is constructed once in `__init__`; the
    SDK is synchronous, so we wrap `messages.create` in `asyncio.to_thread`
    to avoid blocking the FastAPI event loop.
    """

    PROVIDER = "claude"
    DEFAULT_MODEL = "claude-3-5-sonnet-20241022"

    def __init__(self, api_key: str, model: Optional[str] = None) -> None:
        self._client = anthropic.Anthropic(api_key=api_key)
        self._model = model or self.DEFAULT_MODEL

    def _call_sync(self, system: str, user_text: str, image_b64: str, content_type: str) -> str:
        """Synchronous SDK call. Returns the model's text response."""
        response = self._client.messages.create(
            model=self._model,
            max_tokens=1024,
            system=system,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": content_type or "image/jpeg",
                                "data": image_b64,
                            },
                        },
                        {"type": "text", "text": user_text},
                    ],
                }
            ],
        )
        # Concatenate any text blocks in the response
        parts = []
        for block in getattr(response, "content", []) or []:
            text = getattr(block, "text", None)
            if text:
                parts.append(text)
        return "".join(parts)

    async def extraer_factura(
        self, imagen_bytes: bytes, content_type: str
    ) -> PropuestaFactura:
        return await self._run("factura", imagen_bytes, content_type)

    async def extraer_pago(
        self, imagen_bytes: bytes, content_type: str
    ) -> PropuestaPago:
        return await self._run("pago", imagen_bytes, content_type)

    async def _run(
        self,
        documento: Literal["factura", "pago"],
        imagen_bytes: bytes,
        content_type: str,
    ):
        import asyncio

        system = _build_prompt(documento)
        image_b64 = base64.standard_b64encode(imagen_bytes).decode("ascii")
        start = time.monotonic()
        try:
            text = await asyncio.to_thread(
                self._call_sync, system, _USER_PROMPT, image_b64, content_type
            )
        except Exception as exc:  # noqa: BLE001 — RN-IA-05: never propagate
            latency_ms = int((time.monotonic() - start) * 1000)
            _log_ia_call(
                usuario_id=None,
                endpoint=f"/api/{documento}s/extraer-ia",
                provider=self.PROVIDER,
                latency_ms=latency_ms,
                success=False,
                error_class=type(exc).__name__,
            )
            error_msg = f"{type(exc).__name__}: {exc}"
            if documento == "factura":
                return PropuestaFactura(error=True, error_message=error_msg)
            return PropuestaPago(error=True, error_message=error_msg)

        try:
            data = _parse_model_json(text)
            data = _strip_unused_fields(data, documento)
        except (json.JSONDecodeError, ValueError) as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            _log_ia_call(
                usuario_id=None,
                endpoint=f"/api/{documento}s/extraer-ia",
                provider=self.PROVIDER,
                latency_ms=latency_ms,
                success=False,
                error_class="JSONParseError",
            )
            error_msg = f"JSON parse error: {exc}"
            if documento == "factura":
                return PropuestaFactura(error=True, error_message=error_msg)
            return PropuestaPago(error=True, error_message=error_msg)

        # Normalize known types
        if "monto_total" in data:
            data["monto_total"] = _parse_amount(data["monto_total"])
        if "monto" in data:
            data["monto"] = _parse_amount(data["monto"])
        if "fecha_emision" in data:
            data["fecha_emision"] = _parse_date(data["fecha_emision"])
        if "fecha" in data:
            data["fecha"] = _parse_date(data["fecha"])
        if "metodo" in data and documento == "pago":
            data["metodo"] = _normalize_metodo(data["metodo"])

        try:
            if documento == "factura":
                propuesta = PropuestaFactura.model_validate(data)
            else:
                propuesta = PropuestaPago.model_validate(data)
        except Exception as exc:  # noqa: BLE001 — RN-IA-05: never propagate
            latency_ms = int((time.monotonic() - start) * 1000)
            _log_ia_call(
                usuario_id=None,
                endpoint=f"/api/{documento}s/extraer-ia",
                provider=self.PROVIDER,
                latency_ms=latency_ms,
                success=False,
                error_class="ValidationError",
            )
            error_msg = f"ValidationError: {exc}"
            if documento == "factura":
                return PropuestaFactura(error=True, error_message=error_msg)
            return PropuestaPago(error=True, error_message=error_msg)

        latency_ms = int((time.monotonic() - start) * 1000)
        _log_ia_call(
            usuario_id=None,
            endpoint=f"/api/{documento}s/extraer-ia",
            provider=self.PROVIDER,
            latency_ms=latency_ms,
            success=True,
            error_class=None,
        )
        return propuesta


# ── OpenAIVisionExtractor ────────────────────────────────────────────────────


class OpenAIVisionExtractor:
    """
    Extracts invoice / payment headers from images using OpenAI.

    Uses `response_format={"type": "json_object"}` to force the model to
    return strict JSON. Same contract as ClaudeVisionExtractor: never
    raises, never persists, never matches the supplier.
    """

    PROVIDER = "openai"
    DEFAULT_MODEL = "gpt-4o-mini"

    def __init__(
        self,
        api_key: str,
        model: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        # base_url=None → the SDK's default (OpenAI). A non-null base_url
        # repoints the same client at any OpenAI-compatible endpoint
        # (Gemini, Groq, Ollama, …) — see GeminiVisionExtractor.
        self._client = openai.OpenAI(api_key=api_key, base_url=base_url)
        self._model = model or self.DEFAULT_MODEL

    def _call_sync(self, system: str, user_text: str, image_b64: str, content_type: str) -> str:
        """Synchronous SDK call. Returns the model's text response."""
        data_url = f"data:{content_type or 'image/jpeg'};base64,{image_b64}"
        response = self._client.chat.completions.create(
            model=self._model,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": user_text},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                },
            ],
        )
        choices = getattr(response, "choices", []) or []
        if not choices:
            return ""
        return choices[0].message.content or ""

    async def extraer_factura(
        self, imagen_bytes: bytes, content_type: str
    ) -> PropuestaFactura:
        return await self._run("factura", imagen_bytes, content_type)

    async def extraer_pago(
        self, imagen_bytes: bytes, content_type: str
    ) -> PropuestaPago:
        return await self._run("pago", imagen_bytes, content_type)

    async def _run(
        self,
        documento: Literal["factura", "pago"],
        imagen_bytes: bytes,
        content_type: str,
    ):
        import asyncio

        system = _build_prompt(documento)
        image_b64 = base64.standard_b64encode(imagen_bytes).decode("ascii")
        start = time.monotonic()
        try:
            text = await asyncio.to_thread(
                self._call_sync, system, _USER_PROMPT, image_b64, content_type
            )
        except Exception as exc:  # noqa: BLE001 — RN-IA-05: never propagate
            latency_ms = int((time.monotonic() - start) * 1000)
            _log_ia_call(
                usuario_id=None,
                endpoint=f"/api/{documento}s/extraer-ia",
                provider=self.PROVIDER,
                latency_ms=latency_ms,
                success=False,
                error_class=type(exc).__name__,
            )
            error_msg = f"{type(exc).__name__}: {exc}"
            if documento == "factura":
                return PropuestaFactura(error=True, error_message=error_msg)
            return PropuestaPago(error=True, error_message=error_msg)

        try:
            data = _parse_model_json(text)
            data = _strip_unused_fields(data, documento)
        except (json.JSONDecodeError, ValueError) as exc:
            latency_ms = int((time.monotonic() - start) * 1000)
            _log_ia_call(
                usuario_id=None,
                endpoint=f"/api/{documento}s/extraer-ia",
                provider=self.PROVIDER,
                latency_ms=latency_ms,
                success=False,
                error_class="JSONParseError",
            )
            error_msg = f"JSON parse error: {exc}"
            if documento == "factura":
                return PropuestaFactura(error=True, error_message=error_msg)
            return PropuestaPago(error=True, error_message=error_msg)

        if "monto_total" in data:
            data["monto_total"] = _parse_amount(data["monto_total"])
        if "monto" in data:
            data["monto"] = _parse_amount(data["monto"])
        if "fecha_emision" in data:
            data["fecha_emision"] = _parse_date(data["fecha_emision"])
        if "fecha" in data:
            data["fecha"] = _parse_date(data["fecha"])
        if "metodo" in data and documento == "pago":
            data["metodo"] = _normalize_metodo(data["metodo"])

        try:
            if documento == "factura":
                propuesta = PropuestaFactura.model_validate(data)
            else:
                propuesta = PropuestaPago.model_validate(data)
        except Exception as exc:  # noqa: BLE001 — RN-IA-05: never propagate
            latency_ms = int((time.monotonic() - start) * 1000)
            _log_ia_call(
                usuario_id=None,
                endpoint=f"/api/{documento}s/extraer-ia",
                provider=self.PROVIDER,
                latency_ms=latency_ms,
                success=False,
                error_class="ValidationError",
            )
            error_msg = f"ValidationError: {exc}"
            if documento == "factura":
                return PropuestaFactura(error=True, error_message=error_msg)
            return PropuestaPago(error=True, error_message=error_msg)

        latency_ms = int((time.monotonic() - start) * 1000)
        _log_ia_call(
            usuario_id=None,
            endpoint=f"/api/{documento}s/extraer-ia",
            provider=self.PROVIDER,
            latency_ms=latency_ms,
            success=True,
            error_class=None,
        )
        return propuesta


# ── GeminiVisionExtractor ─────────────────────────────────────────────────────


class GeminiVisionExtractor(OpenAIVisionExtractor):
    """
    Extracts invoice / payment headers using Google Gemini through its
    OpenAI-compatible endpoint (https://ai.google.dev/gemini-api/docs/openai).

    Gemini speaks the OpenAI Chat Completions protocol, so this class reuses
    every bit of `OpenAIVisionExtractor`'s request/parse logic and only
    overrides the provider label (for the IA log), the default model, and the
    base_url the SDK points at. Same contract: never raises, never persists,
    never matches the supplier (RN-IA-01..06).

    The model name is intentionally configurable (`GEMINI_MODEL`) because
    Gemini model identifiers change often; the default is a safe, vision-capable
    free-tier flash model.
    """

    PROVIDER = "gemini"
    # `*-latest` alias auto-tracks Google's current flash model and, unlike the
    # pinned `gemini-2.0-flash`, has free-tier quota on AI Studio keys.
    DEFAULT_MODEL = "gemini-flash-latest"
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

    def __init__(self, api_key: str, model: Optional[str] = None) -> None:
        super().__init__(api_key=api_key, model=model, base_url=self.BASE_URL)


# ── Factory ──────────────────────────────────────────────────────────────────


@lru_cache(maxsize=1)
def get_vision_extractor() -> VisionExtractor:
    """
    Return a cached singleton `VisionExtractor` based on `settings.VISION_PROVIDER`.

    `@lru_cache(maxsize=1)` guarantees one instance per process. The
    Settings validator already enforces `VISION_PROVIDER ∈ {claude, openai}`,
    so the `else` branch is a defense-in-depth runtime check; it should not
    be reachable in normal operation. Tests should call
    `get_vision_extractor.cache_clear()` to force re-instantiation.
    """
    cfg = get_settings()
    provider = cfg.VISION_PROVIDER
    if provider == "claude":
        return ClaudeVisionExtractor(api_key=cfg.ANTHROPIC_API_KEY)
    if provider == "openai":
        return OpenAIVisionExtractor(api_key=cfg.OPENAI_API_KEY)
    if provider == "gemini":
        return GeminiVisionExtractor(
            api_key=cfg.GEMINI_API_KEY, model=cfg.GEMINI_MODEL
        )
    raise ValueError(f"VISION_PROVIDER desconocido: {provider!r}")


__all__ = [
    "VisionExtractor",
    "ClaudeVisionExtractor",
    "OpenAIVisionExtractor",
    "GeminiVisionExtractor",
    "get_vision_extractor",
    "validate_image_bytes",  # re-export not required but harmless
    "_parse_amount",
    "_parse_date",
    "_parse_model_json",
    "_strip_unused_fields",
    "_normalize_metodo",
    "_build_prompt",
    "_log_ia_call",
]
