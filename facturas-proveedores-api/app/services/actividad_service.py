"""
ActividadService — merged recent-activity feed for the Home screen.

Design (Home redesign backend addition):
- Read-only. No mutation, no commit ever issued from this service.
- Merges the user's most recent active facturas and pagos into a single
  most-recent-first feed, WITHOUT introducing any factura<->pago link
  (RN-PAG-01 stays intact — the merge is purely a display-layer concern).
- usuario_id scoping happens in the repository queries (Factura/Pago rows
  are always filtered by usuario_id); this is the service-layer contract
  the project's hard rules require (auth/scoping enforced above router,
  never trusted from the payload).
- No N+1: fetches at most `limit` facturas + `limit` pagos (two queries),
  then a single bulk proveedor-name lookup (third query) for however many
  distinct proveedor_id values appear across both lists.
"""

import uuid

from sqlmodel import Session

from app.repositories.factura_repository import FacturaRepository
from app.repositories.pago_repository import PagoRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.actividad import ActividadRecienteItem


class ActividadService:
    """Business logic for the merged recent-activity feed."""

    def __init__(self, session: Session) -> None:
        self._factura_repo = FacturaRepository(session)
        self._pago_repo = PagoRepository(session)
        self._proveedor_repo = ProveedorRepository(session)

    def listar_reciente(
        self,
        usuario_id: uuid.UUID,
        limit: int = 8,
    ) -> list[ActividadRecienteItem]:
        """
        Return the `limit` most recent facturas+pagos for usuario_id, merged.

        Ordering: fecha DESC, tiebreak created_at DESC. Only the caller's
        own data is ever considered — both repo queries filter by
        usuario_id (RN: never trust a resource without scoping it).
        """
        facturas = self._factura_repo.list_recientes(usuario_id, limit)
        pagos = self._pago_repo.list_recientes(usuario_id, limit)

        proveedor_ids = {f.proveedor_id for f in facturas} | {
            p.proveedor_id for p in pagos
        }
        nombres = self._proveedor_repo.get_nombres_by_ids(proveedor_ids)

        items: list[ActividadRecienteItem] = []
        for f in facturas:
            items.append(
                ActividadRecienteItem(
                    tipo="factura",
                    id=f.id,
                    proveedor_id=f.proveedor_id,
                    proveedor_nombre=nombres.get(f.proveedor_id),
                    monto=f.monto_total,
                    fecha=f.fecha_emision,
                    created_at=f.created_at,
                )
            )
        for p in pagos:
            items.append(
                ActividadRecienteItem(
                    tipo="pago",
                    id=p.id,
                    proveedor_id=p.proveedor_id,
                    proveedor_nombre=nombres.get(p.proveedor_id),
                    monto=p.monto,
                    fecha=p.fecha,
                    created_at=p.created_at,
                )
            )

        items.sort(key=lambda it: (it.fecha, it.created_at), reverse=True)
        return items[:limit]


__all__ = ["ActividadService"]
