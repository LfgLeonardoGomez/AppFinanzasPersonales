"""
Pydantic schemas for auth endpoints.

All validation happens in backend (Pydantic) — never trust the frontend.
(Regla dura #6, D-C03-5)

UsuarioResponse MUST NOT expose password_hash.
"""

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


class RegistroRequest(BaseModel):
    """Payload for POST /api/auth/registro.

    `nombre_negocio` is optional (C-28, D-30): registration creates the Negocio
    alongside the user, and an omitted name is derived from the user's own.
    """

    email: EmailStr
    nombre: str
    password: str
    nombre_negocio: Optional[str] = None

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres.")
        return v

    @field_validator("nombre")
    @classmethod
    def nombre_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("El nombre no puede estar vacío.")
        return v.strip()


class RegistroEmpleadoRequest(BaseModel):
    """Payload for POST /api/auth/registro-empleado (C-29).

    Deliberately has no `negocio_id` and no `es_admin`: the shop comes from the
    invitation code and the privilege is not something you can ask for.
    """

    email: EmailStr
    nombre: str
    password: str
    codigo: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres.")
        return v

    @field_validator("nombre")
    @classmethod
    def nombre_not_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("El nombre no puede estar vacío.")
        return v.strip()

    @field_validator("codigo")
    @classmethod
    def codigo_normalizado(cls, v: str) -> str:
        """Trim and uppercase — the code is dictated, so casing is noise."""
        limpio = v.strip().upper()
        if not limpio:
            raise ValueError("El código no puede estar vacío.")
        return limpio


class RecuperarRequest(BaseModel):
    """Payload for POST /api/auth/recuperar (C-31).

    Only an email. The response is identical whether or not it matches an
    account, so nothing else would be meaningful here.
    """

    email: EmailStr


class ResetRequest(BaseModel):
    """Payload for POST /api/auth/reset (C-31)."""

    token: str
    password: str

    @field_validator("password")
    @classmethod
    def password_min_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("La contraseña debe tener al menos 8 caracteres.")
        return v

    @field_validator("token")
    @classmethod
    def token_no_vacio(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("El token es requerido.")
        return v.strip()


class LoginRequest(BaseModel):
    """Payload for POST /api/auth/login."""

    email: EmailStr
    password: str


class UsuarioResponse(BaseModel):
    """
    Public representation of a user.

    CRITICAL: password_hash is NEVER included here.
    model_config excludes it at the schema level.
    """

    id: uuid.UUID
    # Additive (C-28): the client needs to know which shop the session belongs
    # to. Never accepted as input — it is always derived from the session.
    negocio_id: uuid.UUID
    es_admin: bool = False
    email: str
    nombre: str
    telefono: Optional[str] = None
    avatar_url: Optional[str] = None
    nombre_negocio: Optional[str] = None
    tema_preferido: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


__all__ = [
    "RegistroRequest",
    "RegistroEmpleadoRequest",
    "LoginRequest",
    "RecuperarRequest",
    "ResetRequest",
    "UsuarioResponse",
]
