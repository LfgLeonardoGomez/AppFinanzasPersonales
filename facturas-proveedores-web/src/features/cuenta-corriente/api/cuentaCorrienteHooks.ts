/**
 * TanStack Query hook for the cuenta-corriente (C-13, D5).
 *
 * Server state → TanStack Query. The hook is the single read-side entry
 * point that consumes the C-12 endpoint via `getCuentaCorriente`. The
 * `parseCuentaCorriente` boundary is co-located with the API helper so
 * the rest of the app sees `number` decimals and never a Pydantic-v2
 * Decimal-string.
 *
 * INVARIANTS:
 *   - `retry: false` mirrors the C-09 / C-11 single-resource hooks — a
 *     404 is a real answer (foreign / soft-deleted / missing supplier,
 *     per C-12), not a transient error. The page renders the "Proveedor
 *     no encontrado" empty state from `isError`, not a retry spinner.
 *   - `staleTime: 0` makes a revisit re-fetch; the cross-feature
 *     invalidation in `facturasHooks` / `pagosHooks` (D6) keeps the
 *     active view in sync without a manual refetch.
 *   - `enabled: Boolean(proveedorId)` — no request fires on an empty id.
 *   - The hook exposes the public `CuentaCorrienteResponse` (numbers
 *     already parsed). It does NOT recompute `saldo`, `estado`, or
 *     `saldo_acumulado` (RN-SALDO, RN-FIFO, RN-HIST).
 */
import { useQuery } from '@tanstack/react-query'
import { getCuentaCorriente } from './cuentaCorrienteApi'

// ── Query keys ────────────────────────────────────────────────────────────────
//
// Mirrors the C-07 / C-09 / C-11 namespace convention. The detail key is
// the contract for cross-feature invalidation — every `useCreateFactura`,
// `useUpdateFactura`, `useDeleteFactura`, `useCreatePago`, `useUpdatePago`,
// `useDeletePago` calls `invalidateQueries({ queryKey:
// CUENTA_CORRIENTE_KEYS.detail(proveedorId) })` (D6). The `cacheInvalidation`
// test suite locks this contract.

export const CUENTA_CORRIENTE_KEYS = {
  all: ['cuenta-corriente'] as const,
  detail: (proveedorId: string) =>
    ['cuenta-corriente', 'detail', proveedorId] as const,
}

// ── useCuentaCorriente ────────────────────────────────────────────────────────

export function useCuentaCorriente(proveedorId: string) {
  return useQuery({
    queryKey: CUENTA_CORRIENTE_KEYS.detail(proveedorId),
    queryFn: () => getCuentaCorriente(proveedorId),
    enabled: Boolean(proveedorId),
    retry: false, // 404 is a real answer, not a transient error (C-12 contract)
    staleTime: 0, // always fresh on revisit
  })
}
