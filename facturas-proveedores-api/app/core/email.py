"""
Email sending, behind an interface (C-31, D6).

Same shape as the vision provider abstraction (D-07): one interface, several
implementations, chosen by an environment variable. The reason is the same too
— an outbound integration should be swappable and, above all, mockable, because
a test suite that reaches a real mail service is a test suite that spams people.

The default is `console` deliberately. A default that tried to send for real
would either fail loudly on every machine without credentials, or — worse —
succeed, and start mailing users from someone's laptop.
"""

import logging
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)


def _dominio(direccion: str) -> str:
    """Recipient domain only, for logging. Never log the full address here —
    it is not a secret, but there is no reason to put it in logs either."""
    return direccion.rsplit("@", 1)[-1] if "@" in direccion else "?"


class EmailSender(Protocol):
    """Anything that can deliver a message."""

    def enviar(self, destinatario: str, asunto: str, cuerpo: str) -> None:
        """Deliver one message. Implementations must not raise on bad input."""
        ...


class ConsoleEmailSender:
    """
    Prints the message instead of sending it.

    This is what development and tests use. It opens no network connection, so
    a misconfigured environment cannot leak mail to real addresses.

    It writes to stdout directly, not only through `logger`. The whole point of
    this provider is that a developer can read the link and finish the flow, and
    under uvicorn's default logging config an INFO record from this module never
    reaches the console. Found the hard way while driving the real flow: the
    token was created, the endpoint answered 202, and the link was nowhere to be
    seen. A console provider whose output is invisible is not a provider.
    """

    def __init__(self) -> None:
        self.enviados: list[dict[str, str]] = []

    def enviar(self, destinatario: str, asunto: str, cuerpo: str) -> None:
        self.enviados.append(
            {"destinatario": destinatario, "asunto": asunto, "cuerpo": cuerpo}
        )
        print(
            f"\n[email:console] para={destinatario} asunto={asunto}\n{cuerpo}\n",
            flush=True,
        )
        logger.info(
            "[email:console] para=%s asunto=%s", destinatario, asunto
        )


class SmtpEmailSender:
    """
    Sends mail through a generic SMTP server (stdlib `smtplib`, no vendor SDK).

    Chosen over a provider-specific SDK because config alone — host, port,
    user, password — already covers Gmail (app password), Brevo, Resend's SMTP
    endpoint, Mailgun's SMTP endpoint, and effectively every transactional
    provider: they all speak SMTP as a baseline, so one implementation serves
    all of them and swapping providers is an env var change, not a deploy.

    TLS is never optional: STARTTLS (`SMTP_SECURITY=starttls`, the default,
    port 587) or implicit TLS (`SMTP_SECURITY=ssl`, `SMTP.SMTP_SSL`, port 465).
    There is no plaintext path — credentials and the reset link never go out
    unencrypted, and `ssl.create_default_context()` verifies the server
    certificate rather than trusting it blindly.

    Raises on failure rather than silently doing nothing: a system that
    believes it sent a recovery link it never sent is worse than one that
    fails. It is the CALLER's job to decide what "failing" means in its own
    context — here, the caller runs this in a background task (see
    `usuario_service._despachar_correo_reset`) precisely so that a raise here
    reaches a log line, never the HTTP response.

    Never logs the message body or the reset link — the link IS a bearer
    credential for the account (D2, C-31). Only the recipient's domain and a
    success/failure outcome are logged.
    """

    def enviar(self, destinatario: str, asunto: str, cuerpo: str) -> None:
        mensaje = EmailMessage()
        mensaje["From"] = settings.SMTP_FROM
        mensaje["To"] = destinatario
        mensaje["Subject"] = asunto
        mensaje["Date"] = formatdate(localtime=True)
        mensaje["Message-ID"] = make_msgid()
        mensaje.set_content(cuerpo)

        host = settings.SMTP_HOST
        port = settings.SMTP_PORT
        timeout = settings.SMTP_TIMEOUT_S
        usuario = settings.SMTP_USER
        password = settings.SMTP_PASSWORD.get_secret_value()
        contexto_tls = ssl.create_default_context()

        try:
            if settings.SMTP_SECURITY == "ssl":
                with smtplib.SMTP_SSL(
                    host, port, timeout=timeout, context=contexto_tls
                ) as smtp:
                    smtp.login(usuario, password)
                    smtp.send_message(mensaje)
            else:
                with smtplib.SMTP(host, port, timeout=timeout) as smtp:
                    smtp.starttls(context=contexto_tls)
                    smtp.login(usuario, password)
                    smtp.send_message(mensaje)
        except Exception:
            logger.exception(
                "[email:smtp] fallo enviando a dominio=%s", _dominio(destinatario)
            )
            raise
        else:
            logger.info(
                "[email:smtp] enviado a dominio=%s", _dominio(destinatario)
            )


def get_email_sender() -> EmailSender:
    """
    Resolve the configured sender.

    Read at call time (not at import) so the settings proxy from C-16 keeps
    working: tests mutate the environment between cases and expect it to take.
    """
    proveedor = (settings.EMAIL_PROVIDER or "console").strip().lower()

    if proveedor == "smtp":
        return SmtpEmailSender()
    return ConsoleEmailSender()


def construir_enlace_reset(token: str) -> str:
    """
    The link the user clicks, built on the configured frontend origin.

    The raw token exists here and in the email, nowhere else — only its hash is
    persisted.
    """
    origen = settings.FRONTEND_ORIGIN.rstrip("/")
    return f"{origen}/reset?token={token}"


def construir_mensaje_reset(enlace: str, ttl_minutos: int) -> tuple[str, str]:
    """Subject and body for the recovery email."""
    asunto = "Recuperá tu contraseña"
    cuerpo = (
        "Pediste recuperar el acceso a tu cuenta.\n\n"
        f"Entrá acá para elegir una contraseña nueva:\n{enlace}\n\n"
        f"El enlace sirve una sola vez y vence en {ttl_minutos} minutos.\n"
        "Si no lo pediste vos, ignorá este mensaje: tu contraseña no cambió."
    )
    return asunto, cuerpo


__all__ = [
    "EmailSender",
    "ConsoleEmailSender",
    "SmtpEmailSender",
    "get_email_sender",
    "construir_enlace_reset",
    "construir_mensaje_reset",
]
