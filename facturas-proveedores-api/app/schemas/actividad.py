"""
Pydantic schema for GET /api/actividad-reciente (Home redesign backend addition).

Design:
- ActividadRecienteItem is a read-only merged row representing either a
  Factura or a Pago — the Home screen shows "what happened lately" without
  duplicating the dedicated factura/pago list endpoints.
- `tipo` disambiguates the origin entity (RN: a Pago never links to a
  Factura — this schema does NOT introduce such a link; it only merges
  two independent read models for display).
- `monto` = factura.monto_total or pago.monto; `fecha` = factura.fecha_emision
  or pago.fecha. Both fields are always populated (never null) because every
  factura/pago row has them.
- `proveedor_nombre` is None when the supplier has since been soft-deleted
  (same convention as PagoResponse.proveedor_nombre, C-18 FE-005).
"""

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict


class ActividadRecienteItem(BaseModel):
    """
    One row of the merged recent-activity feed (facturas + pagos).

    Sorted by the caller (service layer) by (fecha DESC, created_at DESC).
    """

    model_config = ConfigDict(from_attributes=True)

    tipo: Literal["factura", "pago"]
    id: uuid.UUID
    proveedor_id: uuid.UUID
    proveedor_nombre: Optional[str] = None
    monto: Decimal
    fecha: date
    created_at: datetime


__all__ = ["ActividadRecienteItem"]
