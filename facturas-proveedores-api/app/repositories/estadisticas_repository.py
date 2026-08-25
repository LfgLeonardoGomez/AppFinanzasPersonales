"""
EstadisticasRepository — the two GROUP BY queries behind /api/estadisticas
(C-37, design.md D7).

Pure data access: one indexed, aggregated query per source, no business
logic, no auth (that lives in the service layer, per this project's
convention). `negocio_id` is always filtered here, never trusted from the
caller beyond what the service already resolved (Regla Dura #3).

D7 is explicit about the failure mode this avoids: fetching rows and summing
them in Python turns a cheap indexed aggregate into a memory problem on a
1 GB VPS. Both methods below are a single `GROUP BY` over `date_trunc`,
nothing else touches the rows.

D3 is the trap this module does NOT fall into: `totales_compras` sums
`Factura.monto_total` only (never `Pago.monto`), and `totales_ventas` sums
`Venta.monto` only (never `CobroCliente.monto`). Neither table is even
imported here.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from sqlalchemy import Date, func
from sqlmodel import Session, select

from app.models.enums import FormaPago, Granularidad
from app.models.factura import Factura
from app.models.venta import Venta

_UNIDAD_SQL = {
    Granularidad.DIA: "day",
    Granularidad.SEMANA: "week",
    Granularidad.MES: "month",
}


def _bucket(columna, granularidad: Granularidad):
    """
    `date_trunc` expression, cast back to `date` — Postgres' `date_trunc`
    returns a timestamp, and the caller needs a plain `date` to match against
    `Periodo.inicio` (estadisticas_engine.py).

    `date_trunc('week', ...)` follows the ISO convention (Monday start, D4)
    natively — no hand-written week arithmetic to keep in sync with the pure
    Python version in the engine.

    No timezone argument anywhere: `columna` is already a `date` column, so
    there is no timestamp to convert (see estadisticas_engine.py's module
    docstring for why that matters here).
    """
    unidad = _UNIDAD_SQL[granularidad]
    return func.date_trunc(unidad, columna).cast(Date)


class EstadisticasRepository:
    """Aggregation queries for compras (Factura) and ventas (Venta)."""

    def __init__(self, session: Session) -> None:
        self.session = session

    def totales_compras(
        self,
        negocio_id: uuid.UUID,
        desde: date,
        hasta: date,
        granularidad: Granularidad,
        proveedor_id: Optional[uuid.UUID] = None,
    ) -> dict[date, Decimal]:
        """
        {periodo_inicio: total} for active facturas in [desde, hasta],
        optionally scoped to one proveedor. Periods with no invoices are
        simply absent — zero-filling is the caller's job (D2 lives in the
        engine, not here), because that needs the FULL period list, which is
        not a data-access concern.
        """
        periodo = _bucket(Factura.fecha_emision, granularidad).label("periodo")

        statement = (
            select(periodo, func.sum(Factura.monto_total).label("total"))
            .where(Factura.negocio_id == negocio_id)
            .where(Factura.deleted_at.is_(None))
            .where(Factura.fecha_emision >= desde)
            .where(Factura.fecha_emision <= hasta)
        )
        if proveedor_id is not None:
            statement = statement.where(Factura.proveedor_id == proveedor_id)

        statement = statement.group_by(periodo)

        rows = self.session.exec(statement).all()
        return {row.periodo: Decimal(str(row.total)) for row in rows}

    def totales_ventas(
        self,
        negocio_id: uuid.UUID,
        desde: date,
        hasta: date,
        granularidad: Granularidad,
    ) -> list[tuple[date, FormaPago, Decimal]]:
        """
        Raw grouped rows: (periodo_inicio, forma_pago, total) for active
        ventas in [desde, hasta]. One `GROUP BY (periodo, forma_pago)` query.

        Deliberately NOT shaped into a nested dict here — the service needs
        both the per-period TOTAL (sum across forma_pago) and the per-period
        DESGLOSE (per forma_pago) from this exact same result set, so it
        aggregates both in one pass over these rows. Shaping it here would
        mean choosing one of the two shapes and losing the other, or running
        a second query — this project's repositories are pure data access,
        and "which shape" is a service-layer decision (BaseRepository /
        ProveedorRepository follow the same split).
        """
        periodo = _bucket(Venta.fecha, granularidad).label("periodo")

        statement = (
            select(periodo, Venta.forma_pago, func.sum(Venta.monto).label("total"))
            .where(Venta.negocio_id == negocio_id)
            .where(Venta.deleted_at.is_(None))
            .where(Venta.fecha >= desde)
            .where(Venta.fecha <= hasta)
            .group_by(periodo, Venta.forma_pago)
        )

        rows = self.session.exec(statement).all()
        return [
            (row.periodo, row.forma_pago, Decimal(str(row.total))) for row in rows
        ]


__all__ = ["EstadisticasRepository"]
