"""
TokenResetRepository — data access for TokenReset.

Pure data access. As with invitations, the validity predicate lives here in the
WHERE clause rather than in a caller's judgement: resolving a token and checking
it is alive has to be one query, so no caller can forget the second half or leak
which half failed.

Lookup is by hash — the raw token is never stored (C-31, D1).
"""

import uuid
from datetime import datetime, timezone
from typing import Optional, Sequence

from sqlmodel import Session, select

from app.core.security import hash_token_reset
from app.models.token_reset import TokenReset


class TokenResetRepository:
    """Repository for TokenReset."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def create(
        self, usuario_id: uuid.UUID, token_hash: str, expira_en: datetime
    ) -> TokenReset:
        """Persist a pending token. Caller controls the transaction."""
        token = TokenReset(
            usuario_id=usuario_id, token_hash=token_hash, expira_en=expira_en
        )
        self.session.add(token)
        self.session.flush()
        self.session.refresh(token)
        return token

    def get_valido_by_token(self, token: str) -> Optional[TokenReset]:
        """
        Resolve a raw token to a live row, or None.

        Valid ⟺ usado_en IS NULL AND expira_en > now(). Unknown, expired and
        already-used all collapse to None on purpose, so the caller cannot
        accidentally tell them apart in its response.
        """
        statement = select(TokenReset).where(
            TokenReset.token_hash == hash_token_reset(token),
            TokenReset.usado_en.is_(None),
            TokenReset.expira_en > datetime.now(timezone.utc),
        )
        return self.session.exec(statement).first()

    def listar_pendientes(self, usuario_id: uuid.UUID) -> Sequence[TokenReset]:
        """Live tokens of one user, oldest first (so the oldest is easy to drop)."""
        statement = (
            select(TokenReset)
            .where(
                TokenReset.usuario_id == usuario_id,
                TokenReset.usado_en.is_(None),
                TokenReset.expira_en > datetime.now(timezone.utc),
            )
            .order_by(TokenReset.created_at.asc(), TokenReset.id.asc())
        )
        return list(self.session.exec(statement))

    def invalidar(self, tokens: Sequence[TokenReset]) -> int:
        """
        Mark the given tokens as used. Returns how many were still live.

        Used both when consuming one (the others die with it) and when trimming
        a user's pending pile. Already-used rows keep their original timestamp,
        so calling twice is a no-op.
        """
        ahora = datetime.now(timezone.utc)
        tocados = 0
        for token in tokens:
            if token.usado_en is None:
                token.usado_en = ahora
                self.session.add(token)
                tocados += 1
        if tocados:
            self.session.flush()
        return tocados

    def invalidar_pendientes_de_usuario(
        self, usuario_id: uuid.UUID, excepto: Optional[uuid.UUID] = None
    ) -> int:
        """
        Kill every live token of a user, optionally sparing one.

        `excepto` exists for the reset flow: the token being consumed is marked
        separately, and everything else that was outstanding dies with it — a
        stale token left alive is enough to repeat the takeover.
        """
        pendientes = [
            t for t in self.listar_pendientes(usuario_id) if t.id != excepto
        ]
        return self.invalidar(pendientes)


__all__ = ["TokenResetRepository"]
