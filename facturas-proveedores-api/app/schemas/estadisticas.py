"""
Pydantic schemas for /api/estadisticas (C-37).

Output-only — these three endpoints are read-only aggregation, nothing here
is ever persisted (RN-VTA-05, D-01).

`PeriodoTotal` and `VentaPeriodo` share the same `periodo`/`desde`/`hasta`
shape on purpose (design.md D1): it is what makes `resumen` trivial to
compose and what makes the two series trivial to plot side by side. `total`
is always present even for a period with zero movement (D2) — the frontend
never has to fill a gap itself.

`ResumenResponse` reports `compras`, `ventas` and `diferencia` — never
`margen` or `rentabilidad`. The system does not know what the goods it sold
cost (a supplier invoice is the shop's own purchase, not the cost of one
particular sale), so naming this a margin would be a made-up number wearing
an accounting label (design.md D6, Non-Goals).
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict

from app.models.enums import FormaPago, Granularidad


class PeriodoTotal(BaseModel):
    """One bucket of the compras series. `periodo` == `desde` (bucket start)."""

    model_config = ConfigDict(from_attributes=True)

    periodo: date
    desde: date
    hasta: date
    total: Decimal


class ComprasResponse(BaseModel):
    """Purchase totals by period, optionally scoped to one supplier."""

    model_config = ConfigDict(from_attributes=True)

    desde: date
    hasta: date
    granularidad: Granularidad
    proveedor_id: Optional[uuid.UUID] = None
    periodos: list[PeriodoTotal]


class VentaPeriodo(BaseModel):
    """
    One bucket of the ventas series, with its payment-method breakdown.

    `desglose` always carries every `FormaPago` value, defaulting to
    `0.00` — same reasoning as the zero-filled periods (D2): a series ready
    to graph without the client filling in what did not arrive.

    `sum(desglose.values()) == total`, always, by construction: both are
    computed from the exact same grouped rows in the service layer, never
    from two separate queries that could drift apart.
    """

    model_config = ConfigDict(from_attributes=True)

    periodo: date
    desde: date
    hasta: date
    total: Decimal
    desglose: dict[FormaPago, Decimal]


class VentasResponse(BaseModel):
    """Sales totals by period, broken down by payment method."""

    model_config = ConfigDict(from_attributes=True)

    desde: date
    hasta: date
    granularidad: Granularidad
    periodos: list[VentaPeriodo]


class ResumenResponse(BaseModel):
    """
    Purchases vs. sales for one range — composed from the same two
    aggregations that serve `/compras` and `/ventas` (design.md D6), never
    its own query. `diferencia = ventas - compras`; it is not a margin.
    """

    model_config = ConfigDict(from_attributes=True)

    desde: date
    hasta: date
    compras: Decimal
    ventas: Decimal
    diferencia: Decimal


__all__ = [
    "PeriodoTotal",
    "ComprasResponse",
    "VentaPeriodo",
    "VentasResponse",
    "ResumenResponse",
]
