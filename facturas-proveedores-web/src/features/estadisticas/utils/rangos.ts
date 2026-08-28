/**
 * Default-range helpers for the estadísticas views (C-38).
 *
 * All arithmetic runs in UTC on `YYYY-MM-DD` strings. That is deliberate:
 * `new Date('2026-08-26')` parses as UTC midnight, but `new Date(2026, 7,
 * 26)` builds LOCAL midnight, and mixing the two shifts a boundary by a day
 * in either direction depending on the host's zone. C-37 kept `fecha` a
 * `date` column with no time and no zone precisely so bucketing is pure
 * date arithmetic (D-78); re-introducing a zone here would put the bug back
 * on the client side of the wire.
 *
 * "Today" comes from `getTodayInArgentina()`, the app's single source of it.
 */
import type { Granularidad } from '@shared/api/api'

export interface RangoEstadisticas {
  desde: string
  hasta: string
  granularidad: Granularidad
}

export type VistaEstadisticas = 'compras' | 'ventas'

export function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - dias)
  return toIsoDate(d)
}

/**
 * Subtract whole months, CLAMPING to the last day when the target month is
 * shorter than the source day-of-month.
 *
 * Without the clamp, `setUTCMonth` turns "2026-03-31 minus one month" into
 * 2026-02-31, which JavaScript silently rolls forward to March 3 — so the
 * range would start AFTER the month it was supposed to start in, quietly
 * dropping the first days of data. The user would see a smaller total and
 * no indication why.
 */
export function restarMeses(fecha: string, meses: number): string {
  const d = new Date(`${fecha}T00:00:00Z`)
  const diaOriginal = d.getUTCDate()

  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() - meses)

  const ultimoDiaDelMes = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate()
  d.setUTCDate(Math.min(diaOriginal, ultimoDiaDelMes))

  return toIsoDate(d)
}

/**
 * The default range each view opens with (design.md Open Questions).
 *
 * Both stay far below the backend's 400-period cap: 12 months by month is 13
 * buckets, 30 days by day is 30. A default that 422'd on first paint would
 * make the screen look broken before the user touched anything.
 */
export function rangoPorDefecto(vista: VistaEstadisticas, hoy: string): RangoEstadisticas {
  if (vista === 'ventas') {
    return {
      desde: restarDias(hoy, 29),
      hasta: hoy,
      granularidad: 'dia',
    }
  }

  return {
    desde: restarMeses(hoy, 12),
    hasta: hoy,
    granularidad: 'mes',
  }
}

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}
