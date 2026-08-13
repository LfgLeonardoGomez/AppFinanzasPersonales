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
 * `monto` is a Decimal string on the wire (design.md D4). It is parsed here,
 * at the aggregation boundary, and summed in integer cents so repeated
 * addition of arbitrary decimal amounts cannot drift the way raw
 * floating-point addition can (e.g. 0.10 + 0.20 !== 0.30 in IEEE 754). The
 * public result is converted back to plain decimal numbers for display.
 */
import type { FormaPago, VentaListItem } from '@shared/api/api'

export interface TotalesDelDia {
  total: number
  porFormaPago: Partial<Record<FormaPago, number>>
}

function toCentavos(monto: string): number {
  const n = Number(monto)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
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
