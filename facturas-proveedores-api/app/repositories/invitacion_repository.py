"""
InvitacionRepository — data access for InvitacionEmpleado.

Pure data access. The one thing it does own is the validity predicate, because
it belongs in the WHERE clause: resolving a code and checking it is live has to
be a single query, not a fetch followed by a decision the caller might forget.

Lookup is by hash — the raw code is never stored (D-31).
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence

from sqlmodel import Session, select

from app.core.security import hash_codigo_invitacion
from app.models.invitacion_empleado import InvitacionEmpleado


class InvitacionRepository:
    """Repository for InvitacionEmpleado."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def get_valida_by_codigo(self, codigo: str) -> Optional[InvitacionEmpleado]:
        """
        Resolve a readable code to a live invitation, or None.

        Valid ⟺ usado_en IS NULL AND expira_en > now(). Unknown, expired and
        already-used all collapse to None here on purpose: the caller cannot
        accidentally leak which of the three it was (D3).
        """
        statement = select(InvitacionEmpleado).where(
            InvitacionEmpleado.codigo_hash == hash_codigo_invitacion(codigo),
            InvitacionEmpleado.usado_en.is_(None),
            InvitacionEmpleado.expira_en > datetime.now(timezone.utc),
        )
        return self.session.exec(statement).first()

    def list_by_negocio(self, negocio_id: uuid.UUID) -> Sequence[InvitacionEmpleado]:
        """Every invitation issued by a negocio, newest first."""
        statement = (
            select(InvitacionEmpleado)
            .where(InvitacionEmpleado.negocio_id == negocio_id)
            .order_by(InvitacionEmpleado.created_at.desc())
        )
        return list(self.session.exec(statement))


__all__ = ["InvitacionRepository"]
