"""
Configuración tipada del backend.

Carga variables de entorno mediante Pydantic BaseSettings.
Si falta una variable obligatoria el proceso falla en el arranque
(fail-fast), evitando despliegues con configuración incompleta.

Uso:
    from app.core.config import settings
    print(settings.DATABASE_URL)

C-16 (D-1): `settings` is a read-through proxy. Every attribute access
constructs a fresh `Settings()` instance, which reads `os.environ` at
construction time via pydantic-settings. No caching, no staleness, no
fixture-side `cache_clear()` required. Regression-locked by
`tests/test_config.py::TestSettingsProxyLiveEnvReads`.
"""

from typing import Any

from pydantic import AnyUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """
    Variables de entorno de la aplicación.

    Todas las variables sin default son OBLIGATORIAS: su ausencia
    provoca un ValidationError al instanciar Settings, lo que detiene
    el arranque del proceso.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        # No ignorar campos extra — fuerza mantener .env.example sincronizado
        extra="ignore",
    )

    # ── Base de datos ─────────────────────────────────────────────────────────
    DATABASE_URL: str = Field(
        ...,
        description="URL de conexión a PostgreSQL. "
        "Formato: postgresql+psycopg2://user:pass@host:port/db",
    )

    # ── Seguridad ─────────────────────────────────────────────────────────────
    SECRET_KEY: str = Field(
        ...,
        min_length=32,
        description="Clave secreta para firmar tokens JWT. Mínimo 32 caracteres.",
    )

    # ── Cloudinary ────────────────────────────────────────────────────────────
    CLOUDINARY_URL: str = Field(
        ...,
        description="URL de Cloudinary. Formato: cloudinary://api_key:api_secret@cloud_name",
    )

    # ── Proveedor de visión IA ────────────────────────────────────────────────
    VISION_PROVIDER: str = Field(
        ...,
        description="Proveedor de IA para extracción de facturas. Opciones: claude | openai | gemini",
    )
    ANTHROPIC_API_KEY: str = Field(
        default="",
        description="API key de Anthropic. Requerida si VISION_PROVIDER=claude",
    )
    OPENAI_API_KEY: str = Field(
        default="",
        description="API key de OpenAI. Requerida si VISION_PROVIDER=openai",
    )
    GEMINI_API_KEY: str = Field(
        default="",
        description="API key de Google Gemini (AI Studio). Requerida si VISION_PROVIDER=gemini",
    )
    GEMINI_MODEL: str = Field(
        default="gemini-flash-latest",
        description="Modelo de visión de Gemini. Default 'gemini-flash-latest' (tiene free tier). "
        "Alternativas: gemini-2.0-flash, gemini-flash-lite-latest",
    )

    # ── Tokens de sesión ─────────────────────────────────────────────────────
    ACCESS_TOKEN_TTL_MIN: int = Field(
        ...,
        gt=0,
        description="Duración del access token en minutos. Recomendado: 30",
    )
    REFRESH_TOKEN_TTL_DAYS: int = Field(
        ...,
        gt=0,
        description="Duración del refresh token en días. Recomendado: 30",
    )

    # ── CORS ──────────────────────────────────────────────────────────────────
    FRONTEND_ORIGIN: str = Field(
        ...,
        description="Origen del frontend para CORS con credentials:true. "
        "Nunca '*'. Ejemplo: https://facturas.midominio.com",
    )

    # ── Cookie ────────────────────────────────────────────────────────────────
    COOKIE_DOMAIN: str = Field(
        ...,
        description="Dominio para la cookie de sesión. Ejemplo: .midominio.com",
    )

    # ── Validación cruzada ────────────────────────────────────────────────────
    @field_validator("FRONTEND_ORIGIN")
    @classmethod
    def frontend_origin_must_not_be_wildcard(cls, v: str) -> str:
        """CORS con credentials:true requiere origen explícito, nunca '*'."""
        if v.strip() == "*":
            raise ValueError(
                "FRONTEND_ORIGIN no puede ser '*' cuando se usan credenciales. "
                "Usar un origen explícito (ej. http://localhost:5173)."
            )
        return v

    @field_validator("VISION_PROVIDER")
    @classmethod
    def vision_provider_must_be_valid(cls, v: str) -> str:
        allowed = {"claude", "openai", "gemini"}
        if v.lower() not in allowed:
            raise ValueError(
                f"VISION_PROVIDER debe ser uno de {allowed}. Recibido: '{v}'"
            )
        return v.lower()


class _SettingsProxy:
    """
    Read-through proxy: every attribute access constructs a fresh `Settings()`.

    `Settings()` reads `os.environ` at construction time via pydantic-settings.
    No cache, no staleness, no fixture-side `cache_clear()` required.

    The proxy preserves every public name (`settings`, `get_settings`) so
    existing call sites (`settings.DATABASE_URL`, `settings.CLOUDINARY_URL`,
    etc.) keep working unchanged.

    C-16 (D-1): do NOT re-introduce `@lru_cache` on `get_settings()` or
    capture a frozen `Settings()` instance at import time. Either would
    re-introduce the import-time pollution that masked real regressions
    (see `openspec-apply-progress.md` §"Deuda técnica" in the C-14 cycle).
    Regression-locked by
    `tests/test_config.py::TestSettingsProxyLiveEnvReads`.
    """

    def __getattr__(self, name: str) -> Any:
        return getattr(Settings(), name)


def get_settings() -> Settings:
    """
    Returns a fresh `Settings()` instance reading the current `os.environ`.

    Retained for explicit callers; NOT cached. Two consecutive calls after
    a mutation to `os.environ` return values reflecting the mutation.
    """
    return Settings()


def get_cloudinary_cloud_name() -> str:
    """
    Extract the cloud_name from the CLOUDINARY_URL setting.

    CLOUDINARY_URL format: cloudinary://api_key:api_secret@cloud_name
    Returns the substring after the last '@'.

    Used by the avatar-URL validator to ensure the persisted URL points
    to the configured Cloudinary account (D4 — don't trust the client).
    """
    url = settings.CLOUDINARY_URL
    if "@" not in url:
        return ""
    return url.rsplit("@", 1)[-1].strip() or ""


# Singleton de acceso directo — read-through proxy (C-16 D-1).
settings = _SettingsProxy()
