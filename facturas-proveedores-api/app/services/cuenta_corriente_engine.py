"""
cuenta_corriente_engine — the pure arithmetic shared by both ledgers (C-35, D1).

Two pieces of math are genuinely identical whether the ledger is "what I owe a
supplier" or "what a customer owes me": the FIFO allocation of a payment pool
over a list of charges, and the chronological merge of charges and credits into
a running balance. This module holds both, and holds nothing else.

`factura_service._compute_estado_fifo` and `proveedor_service._build_historial`
are thin adapters over the two functions here — same names, same signatures,
same return types as before the extraction (see those modules). C-35's
customer ledger is the second, and by design the only other, consumer.

Design decisions (design.md D1, D2):
- `asignar_fifo` returns the AMOUNT allocated to each charge, never a domain
  state. Each ledger maps that number to its own vocabulary (EstadoFactura on
  the supplier side, EstadoVentaFiada on the customer side) — vocabulary is
  domain, arithmetic is not, and this module imports neither enum.
- `construir_historial` takes the caller's tipo labels as arguments instead of
  hardcoding "FACTURA"/"PAGO", so the customer ledger can pass "VENTA"/"COBRO"
  without this module knowing either domain exists.

Pure functions: no DB access, no side effects, no domain enum references.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Sequence


@dataclass(frozen=True)
class Movimiento:
    """One charge or credit, as the engine needs to see it.

    Each ledger adapts its own ORM rows into this shape before calling the
    engine, and maps the engine's plain results back to its own entities.
    """

    id: uuid.UUID
    fecha: date
    created_at: datetime
    monto: Decimal
    archivo_url: Optional[str] = None


def asignar_fifo(
    cargos: Sequence[Movimiento],
    pool: Decimal,
) -> dict[uuid.UUID, Decimal]:
    """
    Allocate `pool` over `cargos`, in the order given (oldest first — the
    caller is responsible for pre-sorting, per RN-FIFO-01).

    For each charge:
        aplicado = min(pool restante, cargo.monto)
        pool restante -= aplicado

    Returns a dict mapping cargo.id -> amount allocated to it (a Decimal,
    never negative, never more than the charge's own monto). The caller
    decides what an amount of 0 / partial / full means in its own vocabulary
    (PENDIENTE/PARCIAL/PAGADA-COBRADA) — this function has no opinion.

    Pure function: no DB access, no side effects.
    """
    resultado: dict[uuid.UUID, Decimal] = {}
    restante = pool

    for cargo in cargos:
        aplicado = min(restante, cargo.monto)
        restante -= aplicado
        resultado[cargo.id] = aplicado

    return resultado


def construir_historial(
    cargos: Sequence[Movimiento],
    abonos: Sequence[Movimiento],
    tipo_cargo: str,
    tipo_abono: str,
) -> list[dict]:
    """
    Merge `cargos` (debit) and `abonos` (credit) into one chronologically
    ordered list, with a running signed `saldo_acumulado`.

    Order: (fecha ASC, created_at ASC, id ASC). Robust to the caller passing
    either list in any order — the union is always re-sorted here.

    Each row is a dict: {id, tipo, fecha, monto, saldo_acumulado, archivo_url}.
    `monto` is always positive; the sign lives in `tipo`. `tipo` is exactly
    `tipo_cargo` or `tipo_abono`, as passed by the caller — the labels
    themselves are the caller's vocabulary, not this module's.

    Pure function: no DB access, no side effects.
    """
    tagged: list[tuple] = []
    for c in cargos:
        tagged.append((c.fecha, c.created_at, c.id, tipo_cargo, c.monto, c.archivo_url))
    for a in abonos:
        tagged.append((a.fecha, a.created_at, a.id, tipo_abono, a.monto, a.archivo_url))

    tagged.sort(key=lambda row: (row[0], row[1], row[2]))

    historial: list[dict] = []
    running = Decimal("0.00")
    for fecha, _created_at, row_id, tipo, monto, archivo_url in tagged:
        if tipo == tipo_cargo:
            running += monto
        else:
            running -= monto
        historial.append(
            {
                "id": row_id,
                "tipo": tipo,
                "fecha": fecha,
                "monto": monto,
                "saldo_acumulado": running,
                "archivo_url": archivo_url,
            }
        )
    return historial


__all__ = ["Movimiento", "asignar_fifo", "construir_historial"]
