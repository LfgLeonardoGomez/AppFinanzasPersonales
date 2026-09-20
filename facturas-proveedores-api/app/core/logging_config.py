"""
Configuración de logging de la aplicación.

Sin esto, el root logger de Python queda sin handlers y el nivel efectivo de
los loggers de la app es WARNING. Consecuencia concreta (medida el 2026-09-20):
`app.core.email` emite `logger.info("[email:smtp] enviado a dominio=...")` al
enviar un correo de recuperación, pero ese registro nunca llegaba a los logs
del contenedor. El fallo sí aparecía, porque es `logger.exception` (ERROR).

Esa asimetría deja el envío sin observabilidad positiva: la única señal de
éxito era la AUSENCIA de un traceback, que es indistinguible de "el envío
nunca se intentó".

Se configura el root logger y no solo el logger "app" para que las librerías
de terceros (smtplib, sqlalchemy) también tengan dónde escribir cuando haga
falta subirles el nivel para depurar.
"""

import logging
import sys

from app.core.config import settings

# Marca sobre el handler propio. Permite reconocerlo en una segunda llamada sin
# tocar handlers que haya instalado otro (uvicorn, pytest) ni depender de la
# identidad del stream, que cambia entre procesos.
_MARCA_HANDLER = "_facturas_api_handler"

_FORMATO = "%(asctime)s %(levelname)-8s [%(name)s] %(message)s"


def configure_logging() -> None:
    """
    Instala un handler de consola en el root logger y fija el nivel.

    Idempotente: llamarla más de una vez no agrega handlers duplicados. Importa
    porque uvicorn con --reload reimporta los módulos, y un handler por llamada
    haría que cada línea se imprima N veces.

    El nivel sale de `settings.LOG_LEVEL` (default INFO), que ya viene validado
    contra el conjunto de niveles conocidos.
    """
    root = logging.getLogger()
    nivel = getattr(logging, settings.LOG_LEVEL)

    handler_existente = next(
        (h for h in root.handlers if getattr(h, _MARCA_HANDLER, False)),
        None,
    )

    if handler_existente is None:
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter(_FORMATO))
        setattr(handler, _MARCA_HANDLER, True)
        root.addHandler(handler)
    else:
        handler = handler_existente

    handler.setLevel(nivel)
    root.setLevel(nivel)
