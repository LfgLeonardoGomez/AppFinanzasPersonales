"""
UsuarioService — authentication and user management business logic.

Design decisions implemented here:
- D-C03-1: Access token JWT stateless; refresh opaque + rotated.
- D-C03-4: TTLs from settings (ACCESS_TOKEN_TTL_MIN, REFRESH_TOKEN_TTL_DAYS).
- D-C03-5: Generic login error; constant-time dummy verify on missing email.
- C-05: actualizar_perfil and actualizar_avatar operate on the supplied
  usuario_id only. Authorization (scoping by user) is the caller's job
  (the router always passes the authenticated user.id).
- All authorization and token logic lives HERE, never in routers or repositories.

Reglas duras:
- Nunca exponer password_hash en respuestas.
- Mensaje de error genérico en login para no revelar si falló email o password.
- Timing attack mitigation: always call verify_password even when email not found.
- Profile updates MUST NEVER allow changing email/nombre/password.
- actualizar_perfil uses model_dump(exclude_unset=True) — omitted fields untouched.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Tuple

from fastapi import HTTPException, status
from sqlmodel import Session

from app.core.config import settings
from app.core.security import (
    hash_password,
    verify_password,
    dummy_verify,
    create_access_token,
    create_refresh_token,
    hash_refresh_token,
)
from app.models.usuario import Usuario
from app.repositories.usuario_repository import UsuarioRepository
from app.repositories.refresh_token_repository import RefreshTokenRepository
from app.schemas.perfil import PerfilUpdate, AvatarUpdate

_INVALID_CREDENTIALS = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Credenciales inválidas",
)

_USER_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Usuario not found",
)


class UsuarioService:
    """
    Handles user registration, login, logout, and token refresh.

    All operations use a single SQLModel Session whose transaction
    boundary is controlled by the caller (router or test).
    """

    def __init__(self, session: Session) -> None:
        self._session = session
        self._usuario_repo = UsuarioRepository(session)
        self._rt_repo = RefreshTokenRepository(session)

    # ── registrar ─────────────────────────────────────────────────────────────

    def registrar(self, email: str, nombre: str, password: str) -> Usuario:
        """
        Register a new user account.

        Validates:
            - Email uniqueness (raises 409 if already in use).
        Persists:
            - Usuario with argon2id-hashed password.

        Returns the created Usuario (not yet committed — caller commits).
        """
        existing = self._usuario_repo.get_by_email(email)
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="El email ya está en uso.",
            )

        password_hash = hash_password(password)
        usuario = self._usuario_repo.create(
            email=email,
            nombre=nombre,
            password_hash=password_hash,
        )
        return usuario

    # ── login ──────────────────────────────────────────────────────────────────

    def login(
        self, email: str, password: str
    ) -> Tuple[str, str, Usuario]:
        """
        Verify credentials and issue a new session (access + refresh tokens).

        Anti-timing-attack: always executes verify_password even when the
        email does not exist (D-C03-5). The error message is IDENTICAL for
        wrong email and wrong password to prevent credential enumeration.

        Returns:
            (access_token, raw_refresh_token, usuario)

        The caller MUST set both tokens as httpOnly cookies.
        The raw_refresh_token MUST NOT be persisted — only its hash is stored.
        """
        usuario = self._usuario_repo.get_by_email(email)

        if usuario is None:
            # Constant-time dummy comparison to prevent timing oracle
            dummy_verify()
            raise _INVALID_CREDENTIALS

        if not verify_password(password, usuario.password_hash):
            raise _INVALID_CREDENTIALS

        access_token = create_access_token(sub=str(usuario.id))
        raw_refresh, token_hash = create_refresh_token()

        expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.REFRESH_TOKEN_TTL_DAYS
        )
        self._rt_repo.create(
            usuario_id=usuario.id,
            token_hash=token_hash,
            expires_at=expires_at,
        )

        return access_token, raw_refresh, usuario

    # ── logout ─────────────────────────────────────────────────────────────────

    def logout(self, raw_refresh_token: str) -> None:
        """
        Revoke the refresh token, ending the session server-side.

        The caller must also clear the cookies (max_age=0) on the response.
        If the token is not found (already revoked/expired), this is a no-op.
        """
        token_hash = hash_refresh_token(raw_refresh_token)
        rt = self._rt_repo.get_by_hash(token_hash)
        if rt is not None:
            self._rt_repo.revoke(rt.id)

    # ── refresh ────────────────────────────────────────────────────────────────

    def refresh(
        self, raw_refresh_token: str
    ) -> Tuple[str, str, Usuario]:
        """
        Rotate the refresh token and issue a new pair of tokens.

        Validates:
            - Token exists in DB (by hash).
            - Token is not revoked (revoked_at IS NULL).
            - Token is not expired (expires_at > now()).

        On success:
            - Revokes the old refresh token.
            - Issues a new access token + new refresh token (persisted as hash).

        Returns:
            (new_access_token, new_raw_refresh_token, usuario)
        """
        token_hash = hash_refresh_token(raw_refresh_token)
        rt = self._rt_repo.get_by_hash(token_hash)

        if rt is None:
            raise _INVALID_CREDENTIALS

        now = datetime.now(timezone.utc)
        # Postgres may return timezone-naive datetimes; treat them as UTC.
        expires_at = rt.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        is_valid = (rt.revoked_at is None) and (expires_at > now)
        if not is_valid:
            raise _INVALID_CREDENTIALS

        usuario = self._usuario_repo.get_by_id(rt.usuario_id)
        if usuario is None:
            raise _INVALID_CREDENTIALS

        # Revoke old token (rotation)
        self._rt_repo.revoke(rt.id)

        # Issue new pair
        new_access_token = create_access_token(sub=str(usuario.id))
        new_raw_refresh, new_token_hash = create_refresh_token()

        new_expires_at = datetime.now(timezone.utc) + timedelta(
            days=settings.REFRESH_TOKEN_TTL_DAYS
        )
        self._rt_repo.create(
            usuario_id=usuario.id,
            token_hash=new_token_hash,
            expires_at=new_expires_at,
        )

        return new_access_token, new_raw_refresh, usuario

    # ── actualizar_perfil (C-05) ──────────────────────────────────────────────

    def actualizar_perfil(
        self,
        usuario_id: uuid.UUID,
        datos: PerfilUpdate,
    ) -> Usuario:
        """
        Apply a partial update to the authenticated user's optional profile fields.

        Only fields explicitly present in `datos` (model_dump(exclude_unset=True))
        are applied; omitted fields are left unchanged. The service never accepts
        identity fields (email, nombre, password) — they are not on PerfilUpdate.

        The user is always the one passed in usuario_id; there is no path
        that could resolve a different record.
        """
        usuario = self._usuario_repo.get_by_id(usuario_id)
        if usuario is None:
            raise _USER_NOT_FOUND

        update_data = datos.model_dump(exclude_unset=True)
        if not update_data:
            # Empty payload — return the user as-is (no-op, no UPDATE issued).
            return usuario

        # TemaPreferido is serialized as the enum's string value.
        if "tema_preferido" in update_data and update_data["tema_preferido"] is not None:
            update_data["tema_preferido"] = update_data["tema_preferido"].value

        updated = self._usuario_repo.update(usuario, **update_data)
        return updated

    # ── actualizar_avatar (C-05) ──────────────────────────────────────────────

    def actualizar_avatar(
        self,
        usuario_id: uuid.UUID,
        avatar_url: str,
    ) -> Usuario:
        """
        Set the authenticated user's avatar_url.

        The URL is pre-validated by AvatarUpdate (Cloudinary host + cloud-name
        check). The service re-applies it to the user's own record.
        """
        usuario = self._usuario_repo.get_by_id(usuario_id)
        if usuario is None:
            raise _USER_NOT_FOUND

        # Re-validate defensively using the schema — never trust the caller.
        AvatarUpdate(avatar_url=avatar_url)

        updated = self._usuario_repo.update(usuario, avatar_url=avatar_url)
        return updated


__all__ = ["UsuarioService"]
