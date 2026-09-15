"""
SmtpEmailSender — real SMTP delivery (C-31 fase 2).

`smtplib.SMTP`/`SMTP_SSL` are always mocked (regla dura #12: external
services never touch the network in tests). What has to be proven:

1. The message is built correctly: From/To/Subject/Date/Message-ID headers,
   and the body carries the link untouched.
2. STARTTLS mode connects plain, then calls starttls() BEFORE login(),
   BEFORE send_message() — and the context manager quits the connection.
3. SSL mode uses SMTP_SSL directly and never calls starttls().
4. The configured timeout reaches the SMTP client constructor.
5. Nothing sensitive lands in the logs: not the password, not the link,
   not the body — only the recipient's domain and a success/failure line.
6. A delivery failure raises (loud, not swallowed) — this class's own
   contract, unchanged from the NotImplementedError placeholder it replaces.
"""

import logging
from unittest.mock import MagicMock, patch

import pytest


def _set_smtp_env(monkeypatch, **overrides):
    valores = {
        "EMAIL_PROVIDER": "smtp",
        "SMTP_HOST": "smtp.example.com",
        "SMTP_PORT": "587",
        "SMTP_USER": "no-responder@example.com",
        "SMTP_PASSWORD": "s3cr3t-app-password",
        "SMTP_FROM": "Facturas <no-responder@example.com>",
        "SMTP_SECURITY": "starttls",
        "SMTP_TIMEOUT_S": "10",
        **overrides,
    }
    for k, v in valores.items():
        monkeypatch.setenv(k, v)


def _mocked_smtp_instance(mock_cls) -> MagicMock:
    """Wire a MagicMock so `with smtplib.SMTP(...) as smtp:` yields it."""
    instancia = MagicMock()
    mock_cls.return_value.__enter__.return_value = instancia
    return instancia


class TestMensajeConstruido:
    def test_headers_y_cuerpo(self, env_vars, monkeypatch):
        _set_smtp_env(monkeypatch)
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
            instancia = _mocked_smtp_instance(mock_smtp_cls)

            SmtpEmailSender().enviar(
                "alguien@destino.com",
                "Recuperá tu contraseña",
                "Entrá acá: http://x/reset?token=abc123",
            )

        assert instancia.send_message.call_count == 1
        mensaje = instancia.send_message.call_args[0][0]
        assert mensaje["To"] == "alguien@destino.com"
        assert mensaje["Subject"] == "Recuperá tu contraseña"
        assert mensaje["From"] == "Facturas <no-responder@example.com>"
        assert mensaje["Date"] is not None
        assert mensaje["Message-ID"] is not None
        assert "http://x/reset?token=abc123" in mensaje.get_content()


class TestOrdenStarttls:
    def test_starttls_antes_de_login_y_send(self, env_vars, monkeypatch):
        _set_smtp_env(monkeypatch, SMTP_SECURITY="starttls", SMTP_PORT="587")
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
            instancia = _mocked_smtp_instance(mock_smtp_cls)
            orden: list[str] = []
            instancia.starttls.side_effect = lambda *a, **k: orden.append("starttls")
            instancia.login.side_effect = lambda *a, **k: orden.append("login")
            instancia.send_message.side_effect = lambda *a, **k: orden.append(
                "send_message"
            )

            SmtpEmailSender().enviar("a@b.com", "asunto", "cuerpo")

        mock_smtp_cls.assert_called_once()
        args, kwargs = mock_smtp_cls.call_args
        assert args[0] == "smtp.example.com"
        assert args[1] == 587
        assert kwargs["timeout"] == 10
        assert orden == ["starttls", "login", "send_message"], (
            "STARTTLS debe negociarse antes de autenticar, y autenticar antes "
            "de mandar el mensaje."
        )

    def test_no_usa_smtp_ssl(self, env_vars, monkeypatch):
        _set_smtp_env(monkeypatch, SMTP_SECURITY="starttls")
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls, patch(
            "app.core.email.smtplib.SMTP_SSL"
        ) as mock_ssl_cls:
            _mocked_smtp_instance(mock_smtp_cls)
            SmtpEmailSender().enviar("a@b.com", "asunto", "cuerpo")

        mock_ssl_cls.assert_not_called()


class TestModoSsl:
    def test_usa_smtp_ssl_sin_starttls(self, env_vars, monkeypatch):
        _set_smtp_env(monkeypatch, SMTP_SECURITY="ssl", SMTP_PORT="465")
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP_SSL") as mock_ssl_cls, patch(
            "app.core.email.smtplib.SMTP"
        ) as mock_plain_cls:
            instancia = _mocked_smtp_instance(mock_ssl_cls)
            orden: list[str] = []
            instancia.login.side_effect = lambda *a, **k: orden.append("login")
            instancia.send_message.side_effect = lambda *a, **k: orden.append(
                "send_message"
            )

            SmtpEmailSender().enviar("a@b.com", "asunto", "cuerpo")

        mock_plain_cls.assert_not_called()
        mock_ssl_cls.assert_called_once()
        args, kwargs = mock_ssl_cls.call_args
        assert args[0] == "smtp.example.com"
        assert args[1] == 465
        assert kwargs["timeout"] == 10
        assert instancia.starttls.call_count == 0
        assert orden == ["login", "send_message"]


class TestTimeout:
    def test_timeout_configurado_llega_al_cliente_smtp(self, env_vars, monkeypatch):
        _set_smtp_env(monkeypatch, SMTP_TIMEOUT_S="25")
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
            _mocked_smtp_instance(mock_smtp_cls)
            SmtpEmailSender().enviar("a@b.com", "asunto", "cuerpo")

        _, kwargs = mock_smtp_cls.call_args
        assert kwargs["timeout"] == 25


class TestNoLoguearSecretos:
    def test_password_y_enlace_nunca_aparecen_en_logs(
        self, env_vars, monkeypatch, caplog
    ):
        _set_smtp_env(monkeypatch, SMTP_PASSWORD="password-super-secreto")
        from app.core.email import SmtpEmailSender

        with caplog.at_level(logging.DEBUG, logger="app.core.email"):
            with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
                _mocked_smtp_instance(mock_smtp_cls)
                SmtpEmailSender().enviar(
                    "alguien@destino.com",
                    "asunto",
                    "cuerpo con enlace http://x/reset?token=zzz999",
                )

        salida = caplog.text
        assert "password-super-secreto" not in salida
        assert "zzz999" not in salida
        assert "reset?token" not in salida
        # Lo único que se loguea es el dominio del destinatario.
        assert "destino.com" in salida

    def test_password_no_aparece_en_logs_cuando_falla(
        self, env_vars, monkeypatch, caplog
    ):
        _set_smtp_env(monkeypatch, SMTP_PASSWORD="password-super-secreto")
        from app.core.email import SmtpEmailSender

        with caplog.at_level(logging.DEBUG, logger="app.core.email"):
            with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
                mock_smtp_cls.return_value.__enter__.side_effect = OSError(
                    "no conecta"
                )
                with pytest.raises(OSError):
                    SmtpEmailSender().enviar(
                        "a@destino.com",
                        "asunto",
                        "cuerpo con enlace http://x/reset?token=secreto123",
                    )

        assert "password-super-secreto" not in caplog.text
        assert "secreto123" not in caplog.text


class TestFallaRuidosa:
    """Creer que mandaste un enlace que nunca saliste es peor que fallar."""

    def test_una_falla_de_conexion_se_propaga(self, env_vars, monkeypatch):
        _set_smtp_env(monkeypatch)
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
            mock_smtp_cls.return_value.__enter__.side_effect = OSError("timeout")
            with pytest.raises(OSError):
                SmtpEmailSender().enviar("a@b.com", "asunto", "cuerpo")

    def test_una_falla_de_autenticacion_se_propaga(self, env_vars, monkeypatch):
        import smtplib

        _set_smtp_env(monkeypatch)
        from app.core.email import SmtpEmailSender

        with patch("app.core.email.smtplib.SMTP") as mock_smtp_cls:
            instancia = _mocked_smtp_instance(mock_smtp_cls)
            instancia.login.side_effect = smtplib.SMTPAuthenticationError(
                535, b"bad credentials"
            )
            with pytest.raises(smtplib.SMTPAuthenticationError):
                SmtpEmailSender().enviar("a@b.com", "asunto", "cuerpo")
