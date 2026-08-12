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
from typing import Protocol

from app.core.config import settings

logger = logging.getLogger(__name__)


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
    Placeholder for a real provider.

    C-31 ships the abstraction and the console implementation; wiring an actual
    SMTP or API provider is deployment configuration, not application code, and
    it belongs to whoever decides which service to pay for.

    Raises rather than silently doing nothing: a system that believes it sent a
    recovery link it never sent is worse than one that fails.
    """

    def enviar(self, destinatario: str, asunto: str, cuerpo: str) -> None:
        raise NotImplementedError(
            "EMAIL_PROVIDER=smtp todavía no tiene implementación. "
            "Configurá 'console' o implementá este proveedor antes de desplegar."
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
