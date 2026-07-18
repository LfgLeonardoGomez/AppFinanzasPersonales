"""
Tests de app/core/config.py — carga tipada de variables de entorno.

TDD cycle:
  RED   → tests escritos antes de que config.py existiera
  GREEN → config.py implementa BaseSettings con fail-fast
  TRIANGULATE → segundo escenario: falla si falta variable obligatoria

Spec: requirement "Carga tipada de variables de entorno"
  Scenario 1: Configuración válida carga sin errores
  Scenario 2: Falla en arranque si falta una variable obligatoria

C-16 regression test (D-1, D-3): the `settings` proxy MUST reflect live
`os.environ` reads. Mutating an env var between two reads MUST be observed
by the second read. This test would FAIL if `@lru_cache` is re-introduced
on `get_settings()` or if a cached Settings() instance is captured at import
time.
"""

import os
import pytest
from pydantic import ValidationError


class TestSettingsLoading:
    """Verifica la carga de Settings desde variables de entorno."""

    def test_valid_env_loads_correctly(self, env_vars):
        """
        Scenario 1: Configuración válida carga.

        WHEN todas las variables obligatorias están definidas
        THEN Settings se instancia sin error y expone valores tipados.
        """
        from app.core.config import Settings

        s = Settings()
        assert isinstance(s.ACCESS_TOKEN_TTL_MIN, int)
        assert isinstance(s.REFRESH_TOKEN_TTL_DAYS, int)
        assert s.ACCESS_TOKEN_TTL_MIN > 0
        assert s.REFRESH_TOKEN_TTL_DAYS > 0
        assert s.FRONTEND_ORIGIN.startswith("http")

    def test_missing_required_variable_raises(self, env_vars):
        """
        Scenario 2: Falla en arranque si falta una variable obligatoria.

        WHEN falta DATABASE_URL
        THEN se lanza ValidationError (impide el arranque).
        """
        from app.core.config import Settings

        original = os.environ.pop("DATABASE_URL", None)
        try:
            with pytest.raises(ValidationError) as exc_info:
                Settings(_env_file=None)  # type: ignore[call-arg]
            # Verificar que el error menciona DATABASE_URL
            assert "DATABASE_URL" in str(exc_info.value).upper() or \
                   "database_url" in str(exc_info.value).lower()
        finally:
            if original is not None:
                os.environ["DATABASE_URL"] = original

    def test_wildcard_origin_rejected(self, env_vars):
        """
        WHEN FRONTEND_ORIGIN es '*'
        THEN Settings rechaza el valor con ValidationError
        (CORS wildcard con credentials está prohibido).
        """
        from app.core.config import Settings

        original = os.environ.get("FRONTEND_ORIGIN")
        os.environ["FRONTEND_ORIGIN"] = "*"
        try:
            with pytest.raises(ValidationError):
                Settings(_env_file=None)  # type: ignore[call-arg]
        finally:
            if original is not None:
                os.environ["FRONTEND_ORIGIN"] = original
            else:
                os.environ.pop("FRONTEND_ORIGIN", None)


class TestSettingsProxyLiveEnvReads:
    """
    C-16 (D-1, D-3) regression suite for the `settings` read-through proxy.

    The proxy MUST re-read `os.environ` on every attribute access, with no
    caching. Mutating an env var between two `settings.X` reads MUST be
    observed by the second read.
    """

    def test_settings_proxy_reads_live_env(self, env_vars):
        """
        C-16 D-1: mutating `os.environ["DATABASE_URL"]` between two
        `settings.DATABASE_URL` reads MUST be observed by the second read.

        This test would FAIL if `@lru_cache` is re-introduced on
        `get_settings()` (it would return the cached value) or if a
        frozen `Settings()` instance is captured at import time.
        """
        from app.core.config import settings

        original_url = os.environ["DATABASE_URL"]
        first_marker = "postgresql+psycopg2://first@host:5432/db"
        second_marker = "postgresql+psycopg2://second@host:5432/db"

        try:
            os.environ["DATABASE_URL"] = first_marker
            first_read = settings.DATABASE_URL
            assert first_read == first_marker, (
                f"First read should reflect current env. "
                f"Expected {first_marker!r}, got {first_read!r}."
            )

            os.environ["DATABASE_URL"] = second_marker
            second_read = settings.DATABASE_URL
            assert second_read == second_marker, (
                f"Second read should reflect the new env (no caching). "
                f"Expected {second_marker!r}, got {second_read!r}. "
                "If this fails, @lru_cache was re-introduced on get_settings()."
            )
        finally:
            os.environ["DATABASE_URL"] = original_url

    def test_settings_proxy_does_not_cache_across_attributes(self, env_vars):
        """
        C-16 D-1: each `settings.X` access re-reads `os.environ`; the
        proxy does not hold a single captured `Settings()` instance.
        """
        from app.core.config import settings

        original_url = os.environ["DATABASE_URL"]
        marker = "postgresql+psycopg2://re-read@host:5432/db"

        try:
            os.environ["DATABASE_URL"] = marker
            assert settings.DATABASE_URL == marker
            # A second read of the SAME attribute on a proxy that
            # captures Settings() at import time would return the
            # import-time value. With a true read-through proxy, both
            # reads return the current value.
            assert settings.DATABASE_URL == marker
        finally:
            os.environ["DATABASE_URL"] = original_url

    def test_get_settings_returns_fresh_instance(self, env_vars):
        """
        C-16 D-1: `get_settings()` (retained for explicit callers) MUST
        NOT be decorated with `@lru_cache` (or any cache). Two consecutive
        calls after a mutation MUST return values reflecting the mutation.
        """
        from app.core.config import get_settings

        original_url = os.environ["DATABASE_URL"]
        marker = "postgresql+psycopg2://fresh@host:5432/db"

        try:
            os.environ["DATABASE_URL"] = marker
            first = get_settings()
            assert first.DATABASE_URL == marker
            os.environ["DATABASE_URL"] = "postgresql+psycopg2://other@host:5432/db"
            second = get_settings()
            assert second.DATABASE_URL == "postgresql+psycopg2://other@host:5432/db"
        finally:
            os.environ["DATABASE_URL"] = original_url

    def test_settings_proxy_preserves_call_sites(self, env_vars):
        """
        C-16 D-1: every existing call site of `settings.X` keeps working
        without code changes (proxy preserves the public API).
        """
        from app.core.config import settings

        # The env_vars fixture populates these; the proxy must surface
        # them verbatim.
        assert settings.CLOUDINARY_URL == "cloudinary://key:secret@cloud"
        assert settings.SECRET_KEY == "test-secret-key-must-be-at-least-32-chars-long"
        assert settings.ACCESS_TOKEN_TTL_MIN == 30
        assert settings.VISION_PROVIDER == "claude"
        assert settings.FRONTEND_ORIGIN == "http://localhost:5173"
        assert settings.COOKIE_DOMAIN == "localhost"


class TestIARateLimitSettings:
    """
    C-21: the IA rate limit (`/extraer-ia` endpoints) is configurable via
    env instead of the C-14 hardcoded 10/3600s. `Settings` exposes
    `IA_RATE_MAX_REQUESTS` (default 60) and `IA_RATE_WINDOW_SECONDS`
    (default 3600), both required to be `> 0`, and read live through the
    C-16 proxy — mirrors `TestSettingsProxyLiveEnvReads`.
    """

    def test_defaults_are_60_requests_per_3600_seconds(self, env_vars):
        """
        WHEN neither IA_RATE_MAX_REQUESTS nor IA_RATE_WINDOW_SECONDS is set
        THEN Settings defaults to 60 requests / 3600 seconds.
        """
        from app.core.config import Settings

        original_max = os.environ.pop("IA_RATE_MAX_REQUESTS", None)
        original_window = os.environ.pop("IA_RATE_WINDOW_SECONDS", None)
        try:
            s = Settings(_env_file=None)  # type: ignore[call-arg]
            assert s.IA_RATE_MAX_REQUESTS == 60
            assert s.IA_RATE_WINDOW_SECONDS == 3600
        finally:
            if original_max is not None:
                os.environ["IA_RATE_MAX_REQUESTS"] = original_max
            if original_window is not None:
                os.environ["IA_RATE_WINDOW_SECONDS"] = original_window

    def test_ia_rate_max_requests_must_be_positive(self, env_vars):
        """WHEN IA_RATE_MAX_REQUESTS is 0 THEN Settings rejects it (gt=0)."""
        from app.core.config import Settings

        original = os.environ.get("IA_RATE_MAX_REQUESTS")
        os.environ["IA_RATE_MAX_REQUESTS"] = "0"
        try:
            with pytest.raises(ValidationError):
                Settings(_env_file=None)  # type: ignore[call-arg]
        finally:
            if original is not None:
                os.environ["IA_RATE_MAX_REQUESTS"] = original
            else:
                os.environ.pop("IA_RATE_MAX_REQUESTS", None)

    def test_ia_rate_window_seconds_must_be_positive(self, env_vars):
        """WHEN IA_RATE_WINDOW_SECONDS is negative THEN Settings rejects it (gt=0)."""
        from app.core.config import Settings

        original = os.environ.get("IA_RATE_WINDOW_SECONDS")
        os.environ["IA_RATE_WINDOW_SECONDS"] = "-1"
        try:
            with pytest.raises(ValidationError):
                Settings(_env_file=None)  # type: ignore[call-arg]
        finally:
            if original is not None:
                os.environ["IA_RATE_WINDOW_SECONDS"] = original
            else:
                os.environ.pop("IA_RATE_WINDOW_SECONDS", None)

    def test_settings_proxy_reads_ia_rate_limit_live(self, env_vars):
        """
        C-16 D-1: mutating `os.environ["IA_RATE_MAX_REQUESTS"]` between two
        `settings.IA_RATE_MAX_REQUESTS` reads MUST be observed by the
        second read (no caching, no import-time freeze).
        """
        from app.core.config import settings

        original = os.environ.get("IA_RATE_MAX_REQUESTS")
        try:
            os.environ["IA_RATE_MAX_REQUESTS"] = "5"
            first_read = settings.IA_RATE_MAX_REQUESTS
            assert first_read == 5

            os.environ["IA_RATE_MAX_REQUESTS"] = "15"
            second_read = settings.IA_RATE_MAX_REQUESTS
            assert second_read == 15, (
                "Second read should reflect the new env (no caching)."
            )
        finally:
            if original is not None:
                os.environ["IA_RATE_MAX_REQUESTS"] = original
            else:
                os.environ.pop("IA_RATE_MAX_REQUESTS", None)
