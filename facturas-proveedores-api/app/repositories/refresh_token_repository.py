"""
RefreshTokenRepository — data access for RefreshToken entities.

Pure data access: no business logic, no authorization.
Business validity rules (revoked_at IS NULL AND expires_at > now())
are enforced in the service layer (app/services/usuario_service.py).

C-03: D-C03-2 — token_hash is the lookup key; no raw token ever stored here.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlmodel import Session, select

from app.models.refresh_token import RefreshToken


class RefreshTokenRepository:
    """Repository for RefreshToken. No soft delete (revoked_at semantics differ)."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self,
        usuario_id: uuid.UUID,
        token_hash: str,
        expires_at: datetime,
    ) -> RefreshToken:
        """
        Persist a new refresh token row.

        Only stores the hash; the raw token is handled by the caller.
        Returns the created row (flushed, not committed — caller controls tx).
        """
        rt = RefreshToken(
            usuario_id=usuario_id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
        self.session.add(rt)
        self.session.flush()
        self.session.refresh(rt)
        return rt

    def get_by_hash(self, token_hash: str) -> Optional[RefreshToken]:
        """
        Look up a refresh token by its SHA-256 hash.

        Used on POST /api/auth/refresh and /logout.
        Returns None if not found.
        """
        statement = select(RefreshToken).where(RefreshToken.token_hash == token_hash)
        return self.session.exec(statement).first()

    def revoke(self, token_id: uuid.UUID) -> Optional[RefreshToken]:
        """
        Mark a refresh token as revoked by setting revoked_at = now().

        If the token does not exist, returns None (no-op, no exception).
        Caller must commit.
        """
        rt = self.session.get(RefreshToken, token_id)
        if rt is None:
            return None

        rt.revoked_at = datetime.now(timezone.utc)
        self.session.add(rt)
        self.session.flush()
        return rt

    def revoke_all_for_usuario(self, usuario_id: uuid.UUID) -> int:
        """
        Revoke every still-active refresh token of a user. Returns how many.

        Used when an admin deactivates a member (C-29, RN-NEG-07). Access dies
        on their next request anyway — get_current_user checks `desactivado` —
        but that only kills the current access token; without this they could
        keep minting new ones until the refresh expired.

        Already-revoked rows are left alone, so calling twice is a no-op.
        Caller commits.
        """
        ahora = datetime.now(timezone.utc)
        statement = select(RefreshToken).where(
            RefreshToken.usuario_id == usuario_id,
            RefreshToken.revoked_at.is_(None),
        )
        activos = list(self.session.exec(statement))
        for rt in activos:
            rt.revoked_at = ahora
            self.session.add(rt)
        if activos:
            self.session.flush()
        return len(activos)


__all__ = ["RefreshTokenRepository"]
