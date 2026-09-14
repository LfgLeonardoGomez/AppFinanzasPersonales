/**
 * TanStack Query hooks for estadísticas (C-38).
 *
 * Server state (the three aggregations) → TanStack Query.
 * UI state (range, granularity) → URL search params in the components
 * (design.md D3). Mirrors the `ventasHooks.ts` structure.
 *
 * The query keys carry the FULL query — range, granularity and, for compras,
 * the supplier. That is not bookkeeping: it is what makes a granularity
 * change a refetch rather than a cache hit on a differently-bucketed series.
 * The frontend must never re-bucket a series it already has (design.md
 * Non-Goals), because that would be a second implementation of the backend's
 * aggregation, and two implementations of one sum eventually disagree.
 *
 * These are read-only endpoints: no mutations, so no invalidation graph.
 */
import { useQuery } from '@tanstack/react-query'
import { getVentas, getResumen } from './estadisticasApi'
import type { VentasQuery, ResumenQuery } from './estadisticasApi'

// ── Query keys ───────────────────────────────────────────────────────────────

export const ESTADISTICAS_KEYS = {
  all: ['estadisticas'] as const,
  ventas: (query: VentasQuery) =>
    ['estadisticas', 'ventas', query.desde, query.hasta, query.granularidad] as const,
  resumen: (query: ResumenQuery) =>
    ['estadisticas', 'resumen', query.desde, query.hasta] as const,
}

// ── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Named `useVentasEstadisticas` rather than `useVentas` on purpose: the
 * sales feature already exports a `useVentas` that lists sale ROWS. Two
 * hooks with the same name and different meanings, one returning rows and
 * one returning period totals, is an import waiting to be made wrong.
 */
export function useVentasEstadisticas(query: VentasQuery) {
  return useQuery({
    queryKey: ESTADISTICAS_KEYS.ventas(query),
    queryFn: () => getVentas(query),
  })
}

export function useResumen(query: ResumenQuery) {
  return useQuery({
    queryKey: ESTADISTICAS_KEYS.resumen(query),
    queryFn: () => getResumen(query),
  })
}
