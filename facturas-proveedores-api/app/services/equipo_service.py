"""
EquipoService — membership management for a Negocio (C-29).

All authorization lives here, never in the router (regla dura del proyecto).
Two rules do the heavy lifting:

- Everything is scoped by `negocio_id`. A member of another shop is 404, the
  same as one that does not exist (D-06).
- A negocio can never be left without an active admin (RN-NEG-08). That one is
  rejected with an explicit error, NOT a 404: the resource exists and the
  caller has the privilege — what fails is a business rule, and saying so is
  the only way the admin can understand why.

The invitation code is generated here and returned exactly once; only its hash
reaches the database (D-31).
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Sequence, Tuple

from fastapi import HTTPException, status
from sqlmodel import Session, select

from app.core.security import generar_codigo_invitacion
from app.models.invitacion_empleado import InvitacionEmpleado
from app.models.usuario import Usuario
from app.repositories.refresh_token_repository import RefreshTokenRepository

# 48h: long enough for "I'll set you up tomorrow", short enough that a code
# leaked in a chat is worthless by the time anyone finds it (D2).
INVITACION_TTL_HORAS = 48

_MIEMBRO_NO_ENCONTRADO = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Miembro not found",
)

_ULTIMO_ADMIN = HTTPException(
    status_code=status.HTTP_409_CONFLICT,
    detail=(
        "No se puede desactivar al único administrador activo del negocio. "
        "El negocio quedaría sin nadie que pueda invitar ni reactivar miembros."
    ),
)


class EquipoService:
    """Team membership operations, all scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self._session = session
        self._rt_repo = RefreshTokenRepository(session)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _get_miembro(self, negocio_id: uuid.UUID, miembro_id: uuid.UUID) -> Usuario:
        """Fetch a member of this negocio, or 404.

        A user of another negocio is indistinguishable from one that does not
        exist — otherwise the endpoint would confirm that an id is real.

        The parameter is `miembro_id`, not `usuario_id`, on purpose: it is the
        identity of the person being acted upon, never a scoping filter. The
        tenancy check is the `negocio_id` comparison below. The C-28 axis guard
        flags the old name in this layer, and widening its whitelist to silence
        that would be trading a real safeguard for a naming convenience.
        """
        usuario = self._session.get(Usuario, miembro_id)
        if usuario is None or usuario.negocio_id != negocio_id:
            raise _MIEMBRO_NO_ENCONTRADO
        return usuario

    def _admins_activos(self, negocio_id: uuid.UUID) -> Sequence[Usuario]:
        statement = select(Usuario).where(
            Usuario.negocio_id == negocio_id,
            Usuario.es_admin == True,  # noqa: E712 — SQL expression, not a bool test
            Usuario.desactivado == False,  # noqa: E712
        )
        return list(self._session.exec(statement))

    # ── listado ───────────────────────────────────────────────────────────────

    def listar_miembros(self, negocio_id: uuid.UUID) -> Sequence[Usuario]:
        """Every member of the negocio, deactivated ones included.

        The deactivated have to show up: otherwise an admin cannot reactivate
        someone they cannot see.
        """
        statement = (
            select(Usuario)
            .where(Usuario.negocio_id == negocio_id)
            .order_by(Usuario.created_at.asc(), Usuario.id.asc())
        )
        return list(self._session.exec(statement))

    # ── invitaciones ──────────────────────────────────────────────────────────

    def crear_invitacion(
        self, negocio_id: uuid.UUID, creado_por_usuario_id: uuid.UUID
    ) -> Tuple[InvitacionEmpleado, str]:
        """
        Issue a single-use join code.

        Returns (invitacion, codigo_legible). The readable code is returned
        here and nowhere else — only its hash is persisted, so there is no way
        to recover it afterwards (D-31).
        """
        codigo, codigo_hash = generar_codigo_invitacion()

        invitacion = InvitacionEmpleado(
            negocio_id=negocio_id,
            codigo_hash=codigo_hash,
            creado_por_usuario_id=creado_por_usuario_id,
            expira_en=datetime.now(timezone.utc)
            + timedelta(hours=INVITACION_TTL_HORAS),
        )
        self._session.add(invitacion)
        self._session.flush()
        self._session.refresh(invitacion)

        return invitacion, codigo

    # ── acceso ────────────────────────────────────────────────────────────────

    def desactivar(self, negocio_id: uuid.UUID, miembro_id: uuid.UUID) -> Usuario:
        """
        Revoke a member's access without deleting anything they loaded.

        Rejects (409) if this would leave the negocio with no active admin —
        that shop could never invite or reactivate anyone again, and with no
        admin promotion in this change there is no way back (RN-NEG-08).
        """
        miembro = self._get_miembro(negocio_id, miembro_id)

        if miembro.desactivado:
            return miembro  # idempotent: already revoked

        if miembro.es_admin:
            activos = self._admins_activos(negocio_id)
            if len([a for a in activos if a.id != miembro.id]) == 0:
                raise _ULTIMO_ADMIN

        miembro.desactivado = True
        self._session.add(miembro)
        self._session.flush()

        # Access dies on their next request via get_current_user; this stops
        # them minting a fresh one from a refresh token they still hold.
        self._rt_repo.revoke_all_for_usuario(miembro.id)

        return miembro

    def reactivar(self, negocio_id: uuid.UUID, miembro_id: uuid.UUID) -> Usuario:
        """Restore access. The member logs in again as usual."""
        miembro = self._get_miembro(negocio_id, miembro_id)

        if not miembro.desactivado:
            return miembro  # idempotent

        miembro.desactivado = False
        self._session.add(miembro)
        self._session.flush()
        return miembro


__all__ = ["EquipoService", "INVITACION_TTL_HORAS"]
