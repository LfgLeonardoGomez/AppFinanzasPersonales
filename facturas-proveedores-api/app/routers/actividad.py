"""
Actividad router — HTTP endpoint for the Home screen's recent-activity feed.

Design (Home redesign backend addition, see specs/design/HOME.md):
- GET /api/actividad-reciente merges the authenticated user's most recent
  facturas and pagos into one read-only feed (no persistence, no mutation).
- Pattern mirrors app/routers/proveedores.py: auth + scoping enforced in
  the service layer, router stays thin, no session.commit() (read-only).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from sqlmodel import Session

from app.core.deps import get_current_user, get_db
from app.models.usuario import Usuario
from app.schemas.actividad import ActividadRecienteItem
from app.services.actividad_service import ActividadService

router = APIRouter(tags=["actividad"])

# Type aliases for shared dependencies (FastAPI SKILL pattern)
CurrentUser = Annotated[Usuario, Depends(get_current_user)]
DbSession = Annotated[Session, Depends(get_db)]


@router.get(
    "/api/actividad-reciente",
    response_model=list[ActividadRecienteItem],
    summary="Merged recent activity feed (facturas + pagos) for the Home screen",
)
def get_actividad_reciente(
    limit: Annotated[
        int,
        Query(ge=1, le=50, description="Max items to return (default 8)"),
    ] = 8,
    current_user: CurrentUser = ...,
    session: DbSession = ...,
) -> list[ActividadRecienteItem]:
    """
    Return the authenticated user's most recent facturas + pagos, merged.

    Most-recent-first by fecha, tiebreak created_at desc. Read-only —
    no session.commit() is issued. Scoped entirely by negocio_id in the
    service layer (never trusts the caller beyond authentication).
    """
    svc = ActividadService(session)
    return svc.listar_reciente(current_user.negocio_id, limit=limit)


__all__ = ["router"]
