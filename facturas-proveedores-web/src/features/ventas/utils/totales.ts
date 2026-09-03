/**
 * calcularTotalesDelDia — pure aggregation of the day's sales (C-34, design.md D2).
 *
 * RN-VTA-05: period totals and their per-payment-method breakdown are
 * on-demand aggregations, never persisted columns (mirrors D-01 for supplier
 * balances). This helper is the entire implementation of that rule — it
 * takes the sales already fetched and reduces them, nothing more.
 *
 * LOAD-BEARING ASSUMPTION: this reduction is complete only because
 * `GET /api/ventas` is NOT paginated (design.md D2) — it returns a bare
 * `VentaListItem[]` for the whole filtered window. If pagination is ever
 * added to that endpoint, this function will silently under-report, because
 * it only ever sees the page it was handed. Call it with the full result of
 * `useVentas(filters)`, never with a page slice.
 *
 * `monto` was a Decimal string on the wire, parsed here at the aggregation
 * boundary — that changed with C-41 (design.md D3): `VentaListItem.monto`
 * is now `number`, converted by `parseVentaListItem` (`ventasApi.ts`) at
 * the API client's boundary, which THROWS on a malformed Decimal (D4,
 * D-88) rather than letting one reach this function. This function still
 * sums in integer cents so repeated addition of arbitrary decimal amounts
 * cannot drift the way raw floating-point addition can (e.g.
 * 0.10 + 0.20 !== 0.30 in IEEE 754). The public result is converted back to
 * plain decimal numbers for display.
 *
 * A NaN or negative `monto` both contribute 0 cents, never a subtraction —
 * this is now DEFENSE IN DEPTH rather than the primary decimal-validity
 * guard (that job moved to `parseVentaListItem`), because `number` does not
 * rule out `NaN` at the type level. The backend guarantees `monto > 0`
 * (`Field(gt=0)`, venta.py) for every sale it persists, so a negative value
 * reaching here means the data is corrupted, not that a discount or refund
 * is intended. Silently letting a negative amount subtract would misstate
 * the day's cash instead of surfacing the corruption — this function must
 * not throw (it renders the counter screen's daily totals and one bad row
 * must not take the whole screen down), so it excludes the row instead.
 */
import type { FormaPago, VentaListItem } from '@shared/api/api'

export interface TotalesDelDia {
  total: number
  porFormaPago: Partial<Record<FormaPago, number>>
}

function toCentavos(monto: number): number {
  if (!Number.isFinite(monto) || monto < 0) return 0
  return Math.round(monto * 100)
}

export function calcularTotalesDelDia(
  ventas: Pick<VentaListItem, 'monto' | 'forma_pago'>[],
): TotalesDelDia {
  let totalCentavos = 0
  const porFormaPagoCentavos: Partial<Record<FormaPago, number>> = {}

  for (const v of ventas) {
    const centavos = toCentavos(v.monto)
    totalCentavos += centavos
    porFormaPagoCentavos[v.forma_pago] = (porFormaPagoCentavos[v.forma_pago] ?? 0) + centavos
  }

  const porFormaPago: Partial<Record<FormaPago, number>> = {}
  for (const [forma, centavos] of Object.entries(porFormaPagoCentavos) as [FormaPago, number][]) {
    porFormaPago[forma] = centavos / 100
  }

  return { total: totalCentavos / 100, porFormaPago }
}
