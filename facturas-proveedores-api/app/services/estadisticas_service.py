"""
EstadisticasService — business logic for /api/estadisticas (C-37).

Read-only. Owns everything the router and repository deliberately do not
(this project's convention: authorization and derived values live in the
service layer, never in router or repository — Regla Dura #3/#8):

- `negocio_id` scoping: a `proveedor_id` from another negocio is 404, never
  403 (enumeration-leak prevention, same as factura_service).
- The tope check (D5): rejected BEFORE the aggregation query runs, and
  BEFORE the zero-fill — a request that would exceed it gets no series at
  all, not a truncated one.
- Composing `resumen` from the SAME repository aggregations that serve
  `/compras` and `/ventas` (D6) — never a query of its own.
"""

import uuid
from datetime import date
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, status
from sqlmodel import Session

from app.models.enums import FormaPago, Granularidad
from app.repositories.estadisticas_repository import EstadisticasRepository
from app.repositories.proveedor_repository import ProveedorRepository
from app.schemas.estadisticas import (
    ComprasResponse,
    PeriodoTotal,
    ResumenResponse,
    VentaPeriodo,
    VentasResponse,
)
from app.services.estadisticas_engine import (
    MAX_PERIODOS,
    Periodo,
    RangoInvertido,
    TopeDePeriodosExcedido,
    contar_periodos,
    enumerar_periodos,
    rellenar_periodos,
)

_PROVEEDOR_NOT_FOUND = HTTPException(
    status_code=status.HTTP_404_NOT_FOUND,
    detail="Proveedor not found",
)

_RANGO_INVERTIDO = HTTPException(
    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
    detail="`desde` no puede ser posterior a `hasta`.",
)


def _error_tope_excedido(periodos_estimados: int, tope: int) -> HTTPException:
    """
    422, never a truncated series (D5, task 6.3): the caller gets told
    exactly how many periods the request would have produced and how to
    shrink it, instead of a response that silently degrades.
    """
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "mensaje": (
                f"El rango pedido produciría {periodos_estimados} períodos, "
                f"por encima del tope de {tope}."
            ),
            "periodos_estimados": periodos_estimados,
            "tope": tope,
            "sugerencia": "Usá una granularidad más gruesa o un rango más corto.",
        },
    )


class EstadisticasService:
    """Read-only aggregation over Factura and Venta, scoped to one negocio."""

    def __init__(self, session: Session) -> None:
        self._repo = EstadisticasRepository(session)
        self._prov_repo = ProveedorRepository(session)

    # ── helpers ───────────────────────────────────────────────────────────────

    def _get_owned_proveedor(
        self, negocio_id: uuid.UUID, proveedor_id: uuid.UUID
    ) -> None:
        """Mirrors factura_service._get_owned_proveedor: foreign → 404."""
        entity = self._prov_repo.get(proveedor_id)
        if (
            entity is None
            or entity.deleted_at is not None
            or entity.negocio_id != negocio_id
        ):
            raise _PROVEEDOR_NOT_FOUND

    def _periodos_dentro_del_tope(
        self, desde: date, hasta: date, granularidad: Granularidad
    ) -> list[Periodo]:
        """
        Validate the range, enforce the tope (D5), and only then build the
        full period list. Never generates `enumerar_periodos` for a request
        that is going to be rejected anyway.
        """
        try:
            cantidad = contar_periodos(desde, hasta, granularidad)
        except RangoInvertido:
            raise _RANGO_INVERTIDO

        if cantidad > MAX_PERIODOS:
            raise _error_tope_excedido(cantidad, MAX_PERIODOS)

        return enumerar_periodos(desde, hasta, granularidad)

    # ── compras ───────────────────────────────────────────────────────────────

    def compras(
        self,
        negocio_id: uuid.UUID,
        desde: date,
        hasta: date,
        granularidad: Granularidad,
        proveedor_id: Optional[uuid.UUID] = None,
    ) -> ComprasResponse:
        """Purchase totals by period. `factura.monto_total` only — never `pago` (D3)."""
        if proveedor_id is not None:
            self._get_owned_proveedor(negocio_id, proveedor_id)

        periodos = self._periodos_dentro_del_tope(desde, hasta, granularidad)
        totales = self._repo.totales_compras(
            negocio_id, desde, hasta, granularidad, proveedor_id
        )
        serie = rellenar_periodos(periodos, totales)

        return ComprasResponse(
            desde=desde,
            hasta=hasta,
            granularidad=granularidad,
            proveedor_id=proveedor_id,
            periodos=[PeriodoTotal(**row) for row in serie],
        )

    # ── ventas ────────────────────────────────────────────────────────────────

    def ventas(
        self,
        negocio_id: uuid.UUID,
        desde: date,
        hasta: date,
        granularidad: Granularidad,
    ) -> VentasResponse:
        """
        Sales totals by period, with a payment-method breakdown. `venta.monto`
        only — never `cobro_cliente` (D3, the trap this whole change exists to
        avoid: a fiado already counted as a sale the day it happened; its
        later cobro is the same money arriving, not a second sale).

        `total` and `desglose` are built from the SAME grouped rows in one
        pass, so `sum(desglose.values()) == total` holds by construction —
        not two numbers that happen to agree today.
        """
        periodos = self._periodos_dentro_del_tope(desde, hasta, granularidad)
        rows = self._repo.totales_ventas(negocio_id, desde, hasta, granularidad)

        desglose_por_periodo: dict[date, dict[FormaPago, Decimal]] = {}
        total_por_periodo: dict[date, Decimal] = {}
        for periodo_inicio, forma_pago, monto in rows:
            desglose_por_periodo.setdefault(periodo_inicio, {})[forma_pago] = monto
            total_por_periodo[periodo_inicio] = (
                total_por_periodo.get(periodo_inicio, Decimal("0.00")) + monto
            )

        serie = rellenar_periodos(periodos, total_por_periodo)

        periodos_out: list[VentaPeriodo] = []
        for row in serie:
            desglose_del_periodo = desglose_por_periodo.get(row["periodo"], {})
            desglose_completo = {
                fp: desglose_del_periodo.get(fp, Decimal("0.00")) for fp in FormaPago
            }
            periodos_out.append(VentaPeriodo(**row, desglose=desglose_completo))

        return VentasResponse(
            desde=desde, hasta=hasta, granularidad=granularidad, periodos=periodos_out
        )

    # ── resumen ───────────────────────────────────────────────────────────────

    def resumen(
        self, negocio_id: uuid.UUID, desde: date, hasta: date
    ) -> ResumenResponse:
        """
        Compras vs. ventas for the whole range — no `granularidad` param, no
        periods, no tope (design.md D6): this is a scalar, not a series.

        Composed from the exact same repository aggregations `compras()` and
        `ventas()` call, summed across whatever buckets came back — never a
        query of its own. `Granularidad.MES` here is an implementation
        detail, not something the caller chose: summing the grouped totals
        gives the same answer regardless of which granularidad grouped them,
        because the sum over any partition of the same range is the range's
        total. That is also why this never risks the D5 tope: it groups
        internally but never zero-fills or returns periods.
        """
        if desde > hasta:
            raise _RANGO_INVERTIDO

        compras_por_periodo = self._repo.totales_compras(
            negocio_id, desde, hasta, Granularidad.MES
        )
        compras_total = sum(compras_por_periodo.values(), Decimal("0.00"))

        ventas_rows = self._repo.totales_ventas(negocio_id, desde, hasta, Granularidad.MES)
        ventas_total = sum((monto for _, _, monto in ventas_rows), Decimal("0.00"))

        return ResumenResponse(
            desde=desde,
            hasta=hasta,
            compras=compras_total,
            ventas=ventas_total,
            diferencia=ventas_total - compras_total,
        )


__all__ = ["EstadisticasService"]
