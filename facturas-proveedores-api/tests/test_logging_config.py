"""
Tests de app/core/logging_config.py — configuración de logging de la app.

TDD cycle:
  RED   → tests escritos antes de que logging_config.py existiera
  GREEN → configure_logging() instala un handler en el root logger
  TRIANGULATE → LOG_LEVEL=WARNING silencia INFO; llamadas repetidas no
                duplican handlers

Contexto (2026-09-20): `app.core.email` emite
`logger.info("[email:smtp] enviado a dominio=%s")` en el camino feliz de un
envío SMTP, pero ese registro NUNCA se veía: sin configuración de logging, el
root logger queda sin handlers y el nivel efectivo de los loggers de la app es
WARNING. El fallo de envío sí aparecía (logger.exception → ERROR), así que la
única señal de éxito era la AUSENCIA de un traceback. Esa asimetría es la que
estos tests cierran.
"""

import logging

import pytest


@pytest.fixture
def logging_limpio():
    """
    Aísla el estado global de logging entre tests.

    `logging` es un singleton de proceso: sin esto, el handler que instala un
    test se filtra al siguiente y las aserciones dejan de medir lo que dicen.
    """
    root = logging.getLogger()
    handlers_originales = root.handlers[:]
    nivel_original = root.level
    app_logger = logging.getLogger("app")
    nivel_app_original = app_logger.level

    root.handlers = []

    yield

    root.handlers = handlers_originales
    root.setLevel(nivel_original)
    app_logger.setLevel(nivel_app_original)


class TestConfigureLogging:
    """Verifica que los logs de la app efectivamente salgan."""

    def test_info_de_la_app_queda_habilitado(self, env_vars, logging_limpio):
        """
        Scenario 1: con la configuración por defecto, INFO se emite.

        WHEN configure_logging() corre con LOG_LEVEL por defecto
        THEN un logger de la app tiene INFO habilitado y el root tiene handler.
        """
        from app.core.logging_config import configure_logging

        configure_logging()

        assert logging.getLogger().handlers, "el root logger quedó sin handlers"
        assert logging.getLogger("app.core.email").isEnabledFor(logging.INFO)

    def test_el_registro_de_envio_exitoso_llega_al_handler(
        self, env_vars, logging_limpio, capsys
    ):
        """
        Scenario 2: el mensaje real del camino feliz de SMTP se escribe.

        No alcanza con que el nivel esté habilitado — este test comprueba que
        el registro atraviesa el handler y termina en la salida.
        """
        from app.core.logging_config import configure_logging

        configure_logging()
        logging.getLogger("app.core.email").info(
            "[email:smtp] enviado a dominio=%s", "gmail.com"
        )

        salida = capsys.readouterr()
        assert "[email:smtp] enviado a dominio=gmail.com" in (salida.err + salida.out)

    def test_log_level_configurable_silencia_info(
        self, env_vars, logging_limpio, monkeypatch
    ):
        """
        Scenario 3 (triangulación): LOG_LEVEL manda.

        WHEN LOG_LEVEL=WARNING
        THEN INFO queda deshabilitado y WARNING sigue habilitado.
        """
        monkeypatch.setenv("LOG_LEVEL", "WARNING")
        from app.core.logging_config import configure_logging

        configure_logging()

        logger = logging.getLogger("app.core.email")
        assert not logger.isEnabledFor(logging.INFO)
        assert logger.isEnabledFor(logging.WARNING)

    def test_llamadas_repetidas_no_duplican_handlers(self, env_vars, logging_limpio):
        """
        Scenario 4 (triangulación): idempotencia.

        Uvicorn con --reload importa el módulo más de una vez. Un handler
        agregado por llamada haría que cada línea se imprima N veces.
        """
        from app.core.logging_config import configure_logging

        configure_logging()
        cantidad_tras_primera = len(logging.getLogger().handlers)
        configure_logging()

        assert len(logging.getLogger().handlers) == cantidad_tras_primera

    def test_log_level_invalido_falla_al_arrancar(
        self, env_vars, logging_limpio, monkeypatch
    ):
        """
        Scenario 5: fail-fast, igual que VISION_PROVIDER y EMAIL_PROVIDER.

        Un LOG_LEVEL con un typo no debe degradar en silencio a un default:
        dejaría el sistema sin los logs que el operador creyó haber pedido.
        """
        monkeypatch.setenv("LOG_LEVEL", "VERBOSO")
        from app.core.config import Settings

        with pytest.raises(Exception) as exc:
            Settings()

        assert "LOG_LEVEL" in str(exc.value)
