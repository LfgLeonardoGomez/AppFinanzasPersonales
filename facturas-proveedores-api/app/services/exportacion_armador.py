"""
exportacion_armador — the document armador for cuenta-corriente exports (C-39).

Design decisions implemented (design.md D1, D2):

- D1: this module NEVER opens a query, NEVER imports a repository, and
  NEVER imports the FIFO engine (`cuenta_corriente_engine`). It receives
  the already-computed `saldo` and `historial` — exactly the pair
  `ProveedorService.get_cuenta_corriente` / `ClienteService.get_cuenta_corriente`
  already return — and only formats/filters them. That restriction is what
  makes "the export matches the screen" a STRUCTURAL property instead of a
  promise someone has to keep testing forever: a service with its own
  queries starts identical and drifts on the first rule change applied on
  only one side.

- D2: when the caller passes a range (`desde`/`hasta`), the document opens
  with `saldo_anterior` — the `saldo_acumulado` of the last historial row
  strictly before `desde`, or zero if there is none. That number is READ
  from a row the caller already supplied, never summed — summing it would
  silently reintroduce a second calculation path, exactly what D1 forbids.
  The reconciliation this buys (`saldo_anterior + Σ(rango) ==
  historial[-1].saldo_acumulado`) holds by construction: `saldo_acumulado`
  is already a running total over the FULL history, so the delta between
  any two of its rows is, by definition, the sum of what happened between
  them.

No DB access. No side effects. No PDF/XLSX generation (that lives in
`exportacion_generadores`, which consumes `DocumentoExportacion`).
"""

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Optional


@dataclass(frozen=True)
class FilaDocumento:
    """One row as the document will render it — a straight copy of a
    historial dict entry, never recomputed (D1)."""

    id: uuid.UUID
    tipo: str
    fecha: date
    monto: Decimal
    saldo_acumulado: Decimal


@dataclass(frozen=True)
class SaldoRotulado:
    """A saldo with the date it corresponds to (D2) — never an unlabeled
    number, which is exactly what makes two different saldos honest instead
    of a trap."""

    saldo: Decimal
    fecha: date


@dataclass(frozen=True)
class DocumentoExportacion:
    """
    The fully-formatted, format-agnostic export document.

    `exportacion_generadores.generar_pdf`/`generar_xlsx` render this same
    structure into bytes — neither generator recomputes anything either.
    """

    nombre_negocio: str
    nombre_cuenta: str
    fecha_emision: date
    saldo: Decimal
    incluye_historial: bool
    filas: list[FilaDocumento]
    # None when there is no date range at all (historial sin acotar, o
    # incluir_historial=False). Decimal("0") when there IS a range but no
    # row precedes it — never confused with "no range" (task 3.6).
    saldo_anterior: Optional[Decimal]
    desde: Optional[date]
    hasta: Optional[date]
    # Only set when `hasta` is strictly before `fecha_emision` (D2) — a
    # second, dated saldo alongside the header's "today" saldo.
    saldo_cierre_rango: Optional[SaldoRotulado]


def armar_documento(
    *,
    saldo: Decimal,
    historial: list[dict],
    nombre_cuenta: str,
    nombre_negocio: str,
    fecha_emision: date,
    incluir_historial: bool,
    desde: Optional[date] = None,
    hasta: Optional[date] = None,
) -> DocumentoExportacion:
    """
    Build the export document from the already-computed cuenta-corriente
    triple. Pure function — see module docstring for D1/D2.

    `historial` is the list of dicts as `ProveedorService.get_cuenta_corriente`
    / `ClienteService.get_cuenta_corriente` return it: already sorted
    chronologically ascending, each row already carrying its running
    `saldo_acumulado` (RN-HIST).
    """
    if not incluir_historial:
        return DocumentoExportacion(
            nombre_negocio=nombre_negocio,
            nombre_cuenta=nombre_cuenta,
            fecha_emision=fecha_emision,
            saldo=saldo,
            incluye_historial=False,
            filas=[],
            saldo_anterior=None,
            desde=None,
            hasta=None,
            saldo_cierre_rango=None,
        )

    hay_rango = desde is not None or hasta is not None

    filas = [
        FilaDocumento(
            id=h["id"],
            tipo=h["tipo"],
            fecha=h["fecha"],
            monto=h["monto"],
            saldo_acumulado=h["saldo_acumulado"],
        )
        for h in historial
        if (desde is None or h["fecha"] >= desde) and (hasta is None or h["fecha"] <= hasta)
    ]

    saldo_anterior: Optional[Decimal] = None
    if hay_rango:
        if desde is not None:
            anteriores = [h for h in historial if h["fecha"] < desde]
            saldo_anterior = anteriores[-1]["saldo_acumulado"] if anteriores else Decimal("0")
        else:
            # No hay `desde`: nada se recorta al principio del historial, así
            # que no hay nada "anterior" que arrastrar (task 3.6, generalizado).
            saldo_anterior = Decimal("0")

    saldo_cierre_rango: Optional[SaldoRotulado] = None
    if hasta is not None and hasta < fecha_emision:
        saldo_cierre = filas[-1].saldo_acumulado if filas else (saldo_anterior or Decimal("0"))
        saldo_cierre_rango = SaldoRotulado(saldo=saldo_cierre, fecha=hasta)

    return DocumentoExportacion(
        nombre_negocio=nombre_negocio,
        nombre_cuenta=nombre_cuenta,
        fecha_emision=fecha_emision,
        saldo=saldo,
        incluye_historial=True,
        filas=filas,
        saldo_anterior=saldo_anterior,
        desde=desde,
        hasta=hasta,
        saldo_cierre_rango=saldo_cierre_rango,
    )


__all__ = ["FilaDocumento", "SaldoRotulado", "DocumentoExportacion", "armar_documento"]
