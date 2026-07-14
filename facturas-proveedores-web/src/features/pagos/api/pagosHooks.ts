/**
 * TanStack Query hooks for pagos (payments).
 *
 * Server state (list, single) → TanStack Query.
 * UI state (modals, selected item) → local useState in components.
 *
 * Mirrors the C-09 `facturasHooks.ts` structure for predictability.
 *
 * INVARIANTS (RN-PAG-01, hard rule #1):
 *   - The mutation function `useCreatePago` accepts a `PagoCreate` value.
 *     `PagoCreate` has NO `factura_id` key. The function signature cannot
 *     be invoked with one. The compile-time + runtime tests in
 *     `src/shared/api/api.pagos.test.ts` lock this.
 *   - `PagoUpdate` similarly excludes `proveedor_id` (D7).
 *   - `useCloudinaryPreset('comprobante')` is reused from the facturas
 *     feature hooks (C-09). The comprobante flow does NOT need its own
 *     preset hook.
 *
 * C-13 (D6) — cross-feature cache invalidation: every mutation of a
 * `Pago` ALSO invalidates the cuenta-corriente key for the affected
 * supplier. The cuenta-corriente is recomputed on-demand; the cache must
 * reflect the new state so the view reactively refreshes. The
 * `proveedorId` is read from the mutation payload (`create`), the PATCH
 * response (`update`), or the `PagoDeleteInput` shape (`delete`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listPagos,
  getPago,
  createPago,
  updatePago,
  deletePago,
} from './pagosApi'
import type {
  PagoCreate,
  PagoUpdate,
  PagosFilters,
  PagoDeleteInput,
} from '@shared/api/api'
import {
  useCloudinaryPreset as useCloudinaryPresetShared,
  FACTURA_KEYS,
} from '@features/facturas/api/facturasHooks'
import { CUENTA_CORRIENTE_KEYS } from '@features/cuenta-corriente/api/cuentaCorrienteHooks'
import { PROVEEDOR_KEYS } from '@features/proveedores/api/proveedoresHooks'

// ── Query keys ────────────────────────────────────────────────────────────────

export const PAGO_KEYS = {
  all: ['pagos'] as const,
  list: (filters: PagosFilters) => ['pagos', 'list', filters] as const,
  detail: (id: string) => ['pagos', 'detail', id] as const,
}

// ── usePagos ──────────────────────────────────────────────────────────────────

export function usePagos(filters: PagosFilters = {}) {
  return useQuery({
    queryKey: PAGO_KEYS.list(filters),
    queryFn: () => listPagos(filters),
  })
}

// ── usePago (single) ──────────────────────────────────────────────────────────

export function usePago(id: string) {
  return useQuery({
    queryKey: PAGO_KEYS.detail(id),
    queryFn: () => getPago(id),
    enabled: Boolean(id),
    retry: false,
  })
}

// ── useCreatePago ─────────────────────────────────────────────────────────────

export function useCreatePago() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: PagoCreate) => createPago(data),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: PAGO_KEYS.all })
      // C-13 D6 — invalidate the cuenta-corriente view for the supplier
      // the new pago belongs to.
      void queryClient.invalidateQueries({
        queryKey: CUENTA_CORRIENTE_KEYS.detail(created.proveedor_id),
      })
      // Also invalidate the supplier list so the saldo column refreshes
      void queryClient.invalidateQueries({ queryKey: PROVEEDOR_KEYS.all })
    },
  })
}

// ── useUpdatePago ─────────────────────────────────────────────────────────────

export function useUpdatePago() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: PagoUpdate }) =>
      updatePago(id, data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: PAGO_KEYS.all })
      queryClient.setQueryData(PAGO_KEYS.detail(updated.id), updated)
      // C-13 D6 — invalidate the cuenta-corriente view for the supplier
      // the updated pago belongs to.
      void queryClient.invalidateQueries({
        queryKey: CUENTA_CORRIENTE_KEYS.detail(updated.proveedor_id),
      })
      // Also invalidate the supplier list so the saldo column refreshes
      void queryClient.invalidateQueries({ queryKey: PROVEEDOR_KEYS.all })
    },
  })
}

// ── useDeletePago ─────────────────────────────────────────────────────────────

export function useDeletePago() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PagoDeleteInput) => deletePago(input),
    onSuccess: (_void, variables) => {
      void queryClient.invalidateQueries({ queryKey: PAGO_KEYS.all })
      // C-13 D6 — invalidate the cuenta-corriente view for the supplier
      // of the deleted pago.
      void queryClient.invalidateQueries({
        queryKey: CUENTA_CORRIENTE_KEYS.detail(variables.proveedor_id),
      })
      // Also invalidate the supplier list so the saldo column refreshes
      void queryClient.invalidateQueries({ queryKey: PROVEEDOR_KEYS.all })
    },
  })
}

// ── useCloudinaryPreset (comprobante) ────────────────────────────────────────
//
// Re-exported from the C-09 facturas hooks module. C-10 added the
// `tipo=comprobante` preset on the backend; C-11 uses it. The cache key is
// shared with the facturas feature (same backend endpoint), so we keep the
// `FACTURA_KEYS.cloudinaryPreset` namespace — no separate pago key needed.
//
// This is intentional: the preset is a transport concern, not a feature one.
// Reusing keeps cache hits across the app and avoids duplicate queries.

export function useCloudinaryPreset(tipo: string) {
  return useCloudinaryPresetShared(tipo)
}

// Re-export FACTURA_KEYS for callers that want to invalidate the cloudinary
// preset (used by tests and the `useCreatePago` invalidation pattern).
export { FACTURA_KEYS }
