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


class TestSmtpSettings:
    """
    C-31 fase 2: real SMTP delivery. `EMAIL_PROVIDER=smtp` requires
    SMTP_HOST/SMTP_FROM/SMTP_USER/SMTP_PASSWORD, fail-fast at startup —
    mirrors how VISION_PROVIDER validates its allowed set.
    """

    _SMTP_KEYS = (
        "SMTP_HOST",
        "SMTP_PORT",
        "SMTP_USER",
        "SMTP_PASSWORD",
        "SMTP_FROM",
        "SMTP_SECURITY",
        "SMTP_TIMEOUT_S",
    )

    def _snapshot_and_clear(self) -> dict:
        original = {k: os.environ.pop(k, None) for k in self._SMTP_KEYS}
        original["EMAIL_PROVIDER"] = os.environ.get("EMAIL_PROVIDER")
        return original

    def _restore(self, original: dict) -> None:
        for k, v in original.items():
            if v is not None:
                os.environ[k] = v
            else:
                os.environ.pop(k, None)

    def test_email_provider_smtp_sin_host_falla_al_arrancar(self, env_vars):
        """
        WHEN EMAIL_PROVIDER=smtp pero no hay SMTP_HOST configurado
        THEN Settings falla (fail-fast), igual que un VISION_PROVIDER mal
        configurado — nunca debe arrancar creyendo que puede enviar correo
        y no poder.
        """
        from app.core.config import Settings

        original = self._snapshot_and_clear()
        os.environ["EMAIL_PROVIDER"] = "smtp"
        os.environ["SMTP_FROM"] = "no-responder@midominio.com"
        os.environ["SMTP_USER"] = "no-responder@midominio.com"
        os.environ["SMTP_PASSWORD"] = "x"
        try:
            with pytest.raises(ValidationError) as exc_info:
                Settings(_env_file=None)  # type: ignore[call-arg]
            assert "SMTP_HOST" in str(exc_info.value)
        finally:
            self._restore(original)

    def test_email_provider_smtp_sin_credenciales_falla_al_arrancar(self, env_vars):
        """WHEN falta SMTP_USER/SMTP_PASSWORD THEN falla (auth es obligatoria)."""
        from app.core.config import Settings

        original = self._snapshot_and_clear()
        os.environ["EMAIL_PROVIDER"] = "smtp"
        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ["SMTP_FROM"] = "no-responder@midominio.com"
        try:
            with pytest.raises(ValidationError) as exc_info:
                Settings(_env_file=None)  # type: ignore[call-arg]
            mensaje = str(exc_info.value)
            assert "SMTP_USER" in mensaje
            assert "SMTP_PASSWORD" in mensaje
        finally:
            self._restore(original)

    def test_email_provider_invalido_rechazado(self, env_vars):
        """WHEN EMAIL_PROVIDER no es console ni smtp THEN Settings lo rechaza."""
        from app.core.config import Settings

        original = os.environ.get("EMAIL_PROVIDER")
        os.environ["EMAIL_PROVIDER"] = "sendgrid-magico"
        try:
            with pytest.raises(ValidationError):
                Settings(_env_file=None)  # type: ignore[call-arg]
        finally:
            if original is not None:
                os.environ["EMAIL_PROVIDER"] = original
            else:
                os.environ.pop("EMAIL_PROVIDER", None)

    def test_smtp_security_invalido_rechazado(self, env_vars):
        """WHEN SMTP_SECURITY no es starttls ni ssl THEN Settings lo rechaza."""
        from app.core.config import Settings

        original = os.environ.get("SMTP_SECURITY")
        os.environ["SMTP_SECURITY"] = "plaintext"
        try:
            with pytest.raises(ValidationError):
                Settings(_env_file=None)  # type: ignore[call-arg]
        finally:
            if original is not None:
                os.environ["SMTP_SECURITY"] = original
            else:
                os.environ.pop("SMTP_SECURITY", None)

    def test_smtp_completo_arranca_sin_error(self, env_vars):
        """WHEN EMAIL_PROVIDER=smtp con todos los campos requeridos THEN arranca."""
        from app.core.config import Settings

        original = self._snapshot_and_clear()
        os.environ["EMAIL_PROVIDER"] = "smtp"
        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ["SMTP_FROM"] = "no-responder@midominio.com"
        os.environ["SMTP_USER"] = "no-responder@midominio.com"
        os.environ["SMTP_PASSWORD"] = "app-password-xyz"
        try:
            s = Settings(_env_file=None)  # type: ignore[call-arg]
            assert s.EMAIL_PROVIDER == "smtp"
            assert s.SMTP_PASSWORD.get_secret_value() == "app-password-xyz"
            assert "app-password-xyz" not in repr(s.SMTP_PASSWORD)
            assert "app-password-xyz" not in str(s.SMTP_PASSWORD)
        finally:
            self._restore(original)

    def test_defaults_de_puerto_seguridad_y_timeout(self, env_vars):
        """WHEN no se configura SMTP_* THEN los defaults son 587/starttls/10s."""
        from app.core.config import Settings

        original = self._snapshot_and_clear()
        try:
            s = Settings(_env_file=None)  # type: ignore[call-arg]
            assert s.SMTP_PORT == 587
            assert s.SMTP_SECURITY == "starttls"
            assert s.SMTP_TIMEOUT_S == 10
        finally:
            self._restore(original)

    def test_factory_devuelve_smtp_email_sender(self, env_vars):
        """WHEN EMAIL_PROVIDER=smtp THEN get_email_sender() devuelve SmtpEmailSender."""
        from app.core.email import SmtpEmailSender, get_email_sender

        original = self._snapshot_and_clear()
        os.environ["EMAIL_PROVIDER"] = "smtp"
        os.environ["SMTP_HOST"] = "smtp.example.com"
        os.environ["SMTP_FROM"] = "no-responder@midominio.com"
        os.environ["SMTP_USER"] = "no-responder@midominio.com"
        os.environ["SMTP_PASSWORD"] = "app-password-xyz"
        try:
            assert isinstance(get_email_sender(), SmtpEmailSender)
        finally:
            self._restore(original)


class TestAislamientoDelArchivoEnv:
    """
    Los tests NO deben leer el archivo `.env` del desarrollador.

    Descubierto el 2026-09-20: `Settings.model_config` declara
    `env_file=".env"`, resuelto **relativo al directorio desde el que se lanza
    pytest**. Con un `.env` real en `facturas-proveedores-api/`, un test que
    borra una variable del entorno para comprobar su default terminaba leyendo
    el valor del archivo. Efecto concreto:
    `TestProveedorDeCorreo::test_el_default_es_consola` pasaba lanzando pytest
    desde la raíz del repo y fallaba lanzándolo desde `facturas-proveedores-api/`
    — el mismo commit, verde o rojo según la carpeta y según lo que cada
    desarrollador tuviera en su `.env` local.

    La fixture `aislar_env_file` de conftest.py neutraliza `env_file` durante
    todo el suite. Estos tests son su cierre de regresión.
    """

    def test_settings_ignora_un_env_file_del_directorio_actual(
        self, env_vars, monkeypatch, tmp_path
    ):
        """
        GIVEN un archivo .env en el directorio de trabajo que pisa un default
        WHEN se instancia Settings() sin la variable en el entorno
        THEN gana el default del código, no el archivo.
        """
        (tmp_path / ".env").write_text(
            "\n".join(
                [
                    "EMAIL_PROVIDER=smtp",
                    "SMTP_HOST=smtp.delarchivo.com",
                    "SMTP_USER=alguien@delarchivo.com",
                    "SMTP_PASSWORD=secreto-del-archivo",
                    "SMTP_FROM=alguien@delarchivo.com",
                ]
            ),
            encoding="utf-8",
        )
        monkeypatch.chdir(tmp_path)
        monkeypatch.delenv("EMAIL_PROVIDER", raising=False)
        from app.core.config import Settings

        s = Settings()

        assert s.EMAIL_PROVIDER == "console"
        assert s.SMTP_HOST == ""

    def test_el_entorno_sigue_mandando(self, env_vars, monkeypatch, tmp_path):
        """
        Triangulación: aislar el archivo NO debe sordear el entorno.

        Las fixtures configuran los tests vía os.environ; si el aislamiento
        también bloqueara eso, el suite entero quedaría leyendo defaults.
        """
        (tmp_path / ".env").write_text("EMAIL_PROVIDER=console", encoding="utf-8")
        monkeypatch.chdir(tmp_path)
        monkeypatch.setenv("EMAIL_PROVIDER", "smtp")
        monkeypatch.setenv("SMTP_HOST", "smtp.delentorno.com")
        monkeypatch.setenv("SMTP_USER", "alguien@delentorno.com")
        monkeypatch.setenv("SMTP_PASSWORD", "secreto-del-entorno")
        monkeypatch.setenv("SMTP_FROM", "alguien@delentorno.com")
        from app.core.config import Settings

        s = Settings()

        assert s.EMAIL_PROVIDER == "smtp"
        assert s.SMTP_HOST == "smtp.delentorno.com"
