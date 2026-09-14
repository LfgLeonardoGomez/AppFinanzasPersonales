/**
 * TanStack Query hook for the actividad-reciente (recent-activity) feed.
 *
 * Relocated from `features/home/api/homeHooks.ts` (C-44, D2).
 */
import { useQuery } from '@tanstack/react-query'
import { getActividadReciente } from './actividadRecienteApi'

// ── Query keys ────────────────────────────────────────────────────────────────

export const ACTIVIDAD_RECIENTE_KEYS = {
  all: ['actividad-reciente'] as const,
  list: (limit: number) => ['actividad-reciente', limit] as const,
}

// ── useActividadReciente ──────────────────────────────────────────────────────

export function useActividadReciente(limit = 8) {
  return useQuery({
    queryKey: ACTIVIDAD_RECIENTE_KEYS.list(limit),
    queryFn: () => getActividadReciente(limit),
  })
}
