"""
Utilidades de UUID — Convención D-16.

DECISIÓN D-16 (resuelve Q-01):
    El campo `id` de todas las entidades es UUID, preferentemente UUIDv7.

    Razones:
    - Resistencia a enumeración: recurso ajeno → 404 sin revelar existencia.
    - UUIDv7 es time-ordered: evita fragmentación de índices en Postgres
      (problema conocido de UUIDv4 puro) y alinea el desempate FIFO
      `(fecha_emision, created_at, id)` con el orden de inserción.
    - Fallback a UUIDv4 si la librería uuid6 no está disponible, para
      no bloquear el arranque.

    Esta convención la APLICAN los modelos SQLModel en C-02.
    C-01 solo documenta y deja la utilidad disponible.

Uso:
    from app.core.uuid_utils import new_uuid

    class MiModelo(SQLModel, table=True):
        id: uuid.UUID = Field(default_factory=new_uuid, primary_key=True)
"""

import uuid
import logging

logger = logging.getLogger(__name__)

try:
    from uuid6 import uuid7  # type: ignore[import]

    def new_uuid() -> uuid.UUID:
        """Genera un UUID v7 (time-ordered). Preferido para IDs de entidades."""
        return uuid7()

    UUID_GENERATOR = "uuidv7"

except ImportError:  # pragma: no cover
    logger.warning(
        "Librería 'uuid6' no disponible. "
        "Usando UUIDv4 como fallback (válido, pero no time-ordered). "
        "Instalar 'uuid6' para habilitar UUIDv7."
    )

    def new_uuid() -> uuid.UUID:  # type: ignore[misc]
        """Genera un UUID v4 (fallback si uuid6 no está instalado)."""
        return uuid.uuid4()

    UUID_GENERATOR = "uuidv4-fallback"


__all__ = ["new_uuid", "UUID_GENERATOR"]
