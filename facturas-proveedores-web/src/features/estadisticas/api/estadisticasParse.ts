/**
 * Wire → public boundary for the estadísticas responses (C-38, design.md D4b).
 *
 * The backend serializes every amount as a Pydantic-v2 Decimal STRING
 * (`Decimal('1234.50')` goes out as `"1234.50"`). This module is the single
 * place where that becomes a `number`, so no component ever receives a
 * string-encoded decimal and silently concatenates where it meant to add.
 * Same pattern as `parseCuentaCorriente` (C-13 D13).
 *
 * A malformed decimal THROWS rather than degrading to `0`. That choice
 * matters more here than it does on the cuenta-corriente screen: a
 * statistics view shows legitimate zeros all the time — a period with no
 * movement is real data (C-37 D2) — so a `0` invented by a failed parse
 * would be visually indistinguishable from a true one. Throwing makes the
 * hook surface `isError` instead of drawing a plausible lie.
 *
 * The `Raw*` interfaces mirror the wire exactly and stay internal to this
 * module.
 */
import { toFiniteNumber } from '@shared/utils/decimal'
import type {
  VentasResponse,
  ResumenResponse,
  VentaPeriodo,
  Granularidad,
  FormaPago,
} from '@shared/api/api'

// ── Wire (raw) shape — decimals as strings ───────────────────────────────────

interface RawVentaPeriodo {
  periodo: string
  desde: string
  hasta: string
  total: string
  desglose: Record<FormaPago, string>
}

export interface RawVentasResponse {
  desde: string
  hasta: string
  granularidad: Granularidad
  periodos: RawVentaPeriodo[]
}

export interface RawResumenResponse {
  desde: string
  hasta: string
  compras: string
  ventas: string
  diferencia: string
}

// ── Wire → public boundary ───────────────────────────────────────────────────

export function parseVentas(raw: RawVentasResponse): VentasResponse {
  return {
    desde: raw.desde,
    hasta: raw.hasta,
    granularidad: raw.granularidad,
    periodos: raw.periodos.map(parseVentaPeriodo),
  }
}

export function parseResumen(raw: RawResumenResponse): ResumenResponse {
  return {
    desde: raw.desde,
    hasta: raw.hasta,
    compras: toFiniteNumber(raw.compras, 'compras', 'parseEstadisticas'),
    ventas: toFiniteNumber(raw.ventas, 'ventas', 'parseEstadisticas'),
    diferencia: toFiniteNumber(raw.diferencia, 'diferencia', 'parseEstadisticas'),
  }
}

/**
 * NOTE — `total` is COPIED from the wire, never recomputed by summing
 * `desglose`. The backend guarantees `sum(desglose) === total` because it
 * derives both from the same grouped rows; re-deriving it here would create
 * a second implementation of that sum which could one day disagree with the
 * first, and the screen would show a number no endpoint ever returned.
 */
function parseVentaPeriodo(raw: RawVentaPeriodo): VentaPeriodo {
  const desglose = {} as Record<FormaPago, number>
  for (const [forma, monto] of Object.entries(raw.desglose) as [FormaPago, string][]) {
    desglose[forma] = toFiniteNumber(
      monto,
      `periodos[${raw.periodo}].desglose.${forma}`,
      'parseEstadisticas',
    )
  }

  return {
    periodo: raw.periodo,
    desde: raw.desde,
    hasta: raw.hasta,
    total: toFiniteNumber(raw.total, `periodos[${raw.periodo}].total`, 'parseEstadisticas'),
    desglose,
  }
}
