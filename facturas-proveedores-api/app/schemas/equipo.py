"""
Pydantic schemas for the team endpoints (C-29).

Two things these schemas enforce by shape rather than by check:
- `password_hash` never leaves the system.
- `es_admin` and `negocio_id` are outputs, never inputs. There is no request
  schema in this module that carries them, so no payload can move a member
  between shops or grant themselves the privilege.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel


class MiembroResponse(BaseModel):
    """A team member as the admin sees them in the list."""

    id: uuid.UUID
    nombre: str
    email: str
    es_admin: bool
    desactivado: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class InvitacionResponse(BaseModel):
    """
    A freshly issued invitation.

    `codigo` appears here and nowhere else in the API: only its hash is stored,
    so this response is the single chance to read it (D-31). The frontend has
    to make that obvious to the admin.
    """

    id: uuid.UUID
    codigo: str
    expira_en: datetime

    model_config = {"from_attributes": True}


__all__ = ["MiembroResponse", "InvitacionResponse"]
