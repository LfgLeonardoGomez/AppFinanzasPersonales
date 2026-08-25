"""
estadisticas_engine — the pure bucketing/gap-fill math shared by the compras
and ventas aggregations (C-37, design.md D1).

D-35 asked for "one engine, two sources", and the tempting reading is a
generic `aggregate(table, date_col, amount_col, filters)`. design.md D1
rejects that: compras optionally filters by `proveedor_id`, ventas needs a
`forma_pago` breakdown compras does not have, and the two column names
differ. A generic builder covering both ends up a mini-ORM with flags —
harder to read than the two short queries it replaces.

What genuinely IS shared, because divergence there is silent and dangerous:

1. The bucketing expression (`granularidad` -> which period a date falls
   into). One definition of what "a week" is.
2. Zero-filling absent periods (D2). One definition of which periods a range
   should have.

Both live here, and nowhere else.

Pure functions: no DB access, no side effects, no FastAPI import. Any error
here is a plain `ValueError` subclass — converting it to an HTTP response is
the service layer's job (the same split `cuenta_corriente_engine.py` uses:
pure arithmetic imports neither a domain enum nor a web framework, so both
compras and ventas can depend on it without coupling to each other).

NO TIMEZONE CONVERSION, on purpose. `Venta.fecha` and `Factura.fecha_emision`
are `date` columns, not `datetime` (verified in app/models/venta.py and
app/models/factura.py) — a calendar date has no timezone, so bucketing it is
plain date arithmetic. Converting here would shift movements near a period
boundary into the wrong bucket, silently and systematically. This is
deliberate scope correction from the original roadmap (see proposal.md) —
if you are here to "fix" a UTC-3 gap, there isn't one: don't add it.
"""

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal
from typing import Mapping

from app.models.enums import Granularidad

# D5 — the tope this module enforces via `contar_periodos`. Deliberately
# conservative (design.md Open Questions: "arranca conservador", the
# definitive value gets fixed by measuring real response sizes, not by
# guessing). 400 covers slightly more than a year of daily buckets, or ~30
# years of monthly ones — comfortably past any range a shop would plot.
MAX_PERIODOS = 400


class RangoInvertido(ValueError):
    """`desde` is after `hasta`. Never resolved as a silent empty series."""


class TopeDePeriodosExcedido(ValueError):
    """
    The (rango, granularidad) pair would produce more periods than
    MAX_PERIODOS. Carries enough for the caller to build an explanatory 422
    (design.md D5): how many periods it would have been, and the tope itself.
    """

    def __init__(self, periodos_estimados: int, tope: int) -> None:
        self.periodos_estimados = periodos_estimados
        self.tope = tope
        super().__init__(
            f"El rango pedido produciría {periodos_estimados} períodos, "
            f"por encima del tope de {tope}. Probá una granularidad más "
            f"gruesa o un rango más corto."
        )


@dataclass(frozen=True)
class Periodo:
    """One bucket: its real start and end date, inclusive on both ends."""

    inicio: date
    fin: date


def _validar_rango(desde: date, hasta: date) -> None:
    if desde > hasta:
        raise RangoInvertido("`desde` no puede ser posterior a `hasta`.")


def _inicio_semana(fecha: date) -> date:
    """Monday of the ISO week containing `fecha` (D4). `weekday()`: Mon=0."""
    return fecha - timedelta(days=fecha.weekday())


def _inicio_mes(fecha: date) -> date:
    return fecha.replace(day=1)


def _fin_de_mes(inicio_de_mes: date) -> date:
    ultimo_dia = calendar.monthrange(inicio_de_mes.year, inicio_de_mes.month)[1]
    return inicio_de_mes.replace(day=ultimo_dia)


def _siguiente_mes(inicio_de_mes: date) -> date:
    if inicio_de_mes.month == 12:
        return inicio_de_mes.replace(year=inicio_de_mes.year + 1, month=1)
    return inicio_de_mes.replace(month=inicio_de_mes.month + 1)


def contar_periodos(desde: date, hasta: date, granularidad: Granularidad) -> int:
    """
    How many periods `enumerar_periodos` would return, computed by plain
    arithmetic instead of building the list. This is what lets the tope
    (D5) be enforced BEFORE paying for a query or a fill: a pathological
    range should reject cheaply, not after materializing thousands of rows.
    """
    _validar_rango(desde, hasta)

    if granularidad == Granularidad.DIA:
        return (hasta - desde).days + 1

    if granularidad == Granularidad.SEMANA:
        primera = _inicio_semana(desde)
        ultima = _inicio_semana(hasta)
        return (ultima - primera).days // 7 + 1

    # MES
    return (hasta.year - desde.year) * 12 + (hasta.month - desde.month) + 1


def enumerar_periodos(
    desde: date, hasta: date, granularidad: Granularidad
) -> list[Periodo]:
    """
    Full list of periods covering [desde, hasta], oldest first, each with its
    REAL start and end — a range that starts mid-period (e.g. the 15th of a
    month) includes that whole period, not a partial one.
    """
    _validar_rango(desde, hasta)

    periodos: list[Periodo] = []

    if granularidad == Granularidad.DIA:
        actual = desde
        while actual <= hasta:
            periodos.append(Periodo(actual, actual))
            actual += timedelta(days=1)
        return periodos

    if granularidad == Granularidad.SEMANA:
        actual = _inicio_semana(desde)
        limite = _inicio_semana(hasta)
        while actual <= limite:
            periodos.append(Periodo(actual, actual + timedelta(days=6)))
            actual += timedelta(days=7)
        return periodos

    # MES
    actual = _inicio_mes(desde)
    limite = _inicio_mes(hasta)
    while actual <= limite:
        periodos.append(Periodo(actual, _fin_de_mes(actual)))
        actual = _siguiente_mes(actual)
    return periodos


def rellenar_periodos(
    periodos: list[Periodo], totales: Mapping[date, Decimal]
) -> list[dict]:
    """
    Zero-fill (D2): for every period in `periodos`, attach the total the
    query returned for that period's start date, or `0.00` if the query
    simply had no row there — a period with no movement is not omitted.

    Order is driven entirely by `periodos` (already chronological, from
    `enumerar_periodos`), never by whatever order the database happened to
    return rows in.
    """
    return [
        {
            "periodo": periodo.inicio,
            "desde": periodo.inicio,
            "hasta": periodo.fin,
            "total": totales.get(periodo.inicio, Decimal("0.00")),
        }
        for periodo in periodos
    ]


__all__ = [
    "MAX_PERIODOS",
    "RangoInvertido",
    "TopeDePeriodosExcedido",
    "Periodo",
    "contar_periodos",
    "enumerar_periodos",
    "rellenar_periodos",
]
