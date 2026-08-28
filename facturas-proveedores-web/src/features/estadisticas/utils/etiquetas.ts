/**
 * Human labels for a period bucket (C-38).
 *
 * `timeZone: 'UTC'` is not optional here. The backend's `periodo` is a
 * date-only value with no time and no zone (C-37 D-78), and
 * `new Date('2026-01-01')` parses it as UTC midnight — so formatting it
 * with the host's local zone renders "31 dic" for every user west of
 * Greenwich, including this app's own UTC-3 users. Every row would be
 * labelled one day early, consistently enough to look intentional.
 */
import type { Granularidad } from '@shared/api/api'

export function etiquetaPeriodo(periodo: string, granularidad: Granularidad): string {
  const fecha = new Date(`${periodo}T00:00:00Z`)

  if (granularidad === 'mes') {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'UTC',
      month: 'short',
      year: 'numeric',
    }).format(fecha)
  }

  const diaMes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
  }).format(fecha)

  return granularidad === 'semana' ? `sem. ${diaMes}` : diaMes
}
