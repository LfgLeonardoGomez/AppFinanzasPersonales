/**
 * TanStack Query hooks for facturas (invoices).
 *
 * Server state (list, single) → TanStack Query.
 * UI state (modals, selected item) → local useState in components.
 *
 * estado is NEVER computed on the frontend — it always comes from the API response (RN-FAC-09).
 * items_sum_mismatch from the response is the authoritative mismatch signal (RN-FAC-04).
 * Cloudinary is ALWAYS mocked in tests (hard rule #9).
 *
 * C-13 (D6) — cross-feature cache invalidation: every mutation of a
 * `Factura` ALSO invalidates the cuenta-corriente key for the affected
 * supplier. The cuenta-corriente is recomputed on-demand; the cache must
 * reflect the new state so the view reactively refreshes. The
 * `proveedorId` is read from the mutation payload (`create`), the PATCH
 * response (`update`), or the `FacturaDeleteInput` shape (`delete`).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listFacturas,
  getFactura,
  createFactura,
  updateFactura,
  deleteFactura,
  getCloudinaryPreset,
  type CloudinaryPreset,
} from './facturasApi'
import { CUENTA_CORRIENTE_KEYS } from '@features/cuenta-corriente/api/cuentaCorrienteHooks'
import type {
  FacturaCreate,
  FacturaUpdate,
  FacturasFilters,
  FacturaDeleteInput,
} from '@shared/api/api'

// ── Query keys ────────────────────────────────────────────────────────────────

export const FACTURA_KEYS = {
  all: ['facturas'] as const,
  list: (filters: FacturasFilters) => ['facturas', 'list', filters] as const,
  detail: (id: string) => ['facturas', 'detail', id] as const,
  cloudinaryPreset: (tipo: string) => ['cloudinary', 'preset', tipo] as const,
}

// ── useFacturas ───────────────────────────────────────────────────────────────

export function useFacturas(filters: FacturasFilters = {}) {
  return useQuery({
    queryKey: FACTURA_KEYS.list(filters),
    queryFn: () => listFacturas(filters),
  })
}

// ── useFactura (single) ───────────────────────────────────────────────────────

export function useFactura(id: string) {
  return useQuery({
    queryKey: FACTURA_KEYS.detail(id),
    queryFn: () => getFactura(id),
    enabled: Boolean(id),
    retry: false,
  })
}

// ── useCreateFactura ──────────────────────────────────────────────────────────

export function useCreateFactura() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: FacturaCreate) => createFactura(data),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: FACTURA_KEYS.all })
      // C-13 D6 — invalidate the cuenta-corriente view for the supplier
      // the new factura belongs to.
      void queryClient.invalidateQueries({
        queryKey: CUENTA_CORRIENTE_KEYS.detail(created.proveedor_id),
      })
    },
  })
}

// ── useUpdateFactura ──────────────────────────────────────────────────────────

export function useUpdateFactura() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: FacturaUpdate }) =>
      updateFactura(id, data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: FACTURA_KEYS.all })
      queryClient.setQueryData(FACTURA_KEYS.detail(updated.id), updated)
      // C-13 D6 — invalidate the cuenta-corriente view for the supplier
      // the updated factura belongs to (read from the PATCH response).
      void queryClient.invalidateQueries({
        queryKey: CUENTA_CORRIENTE_KEYS.detail(updated.proveedor_id),
      })
    },
  })
}

// ── useDeleteFactura ──────────────────────────────────────────────────────────

export function useDeleteFactura() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: FacturaDeleteInput) => deleteFactura(input),
    onSuccess: (_void, variables) => {
      void queryClient.invalidateQueries({ queryKey: FACTURA_KEYS.all })
      // C-13 D6 — invalidate the cuenta-corriente view for the supplier
      // of the deleted factura. The `proveedor_id` is carried in the
      // delete input (the list row already has it).
      void queryClient.invalidateQueries({
        queryKey: CUENTA_CORRIENTE_KEYS.detail(variables.proveedor_id),
      })
    },
  })
}

// ── useCloudinaryPreset ───────────────────────────────────────────────────────

/**
 * Fetches a signed Cloudinary upload preset for the given tipo.
 * Disabled when tipo is empty. Used by FileUploadField.
 * Cloudinary is ALWAYS mocked in tests via MSW.
 */
export function useCloudinaryPreset(tipo: string) {
  return useQuery<CloudinaryPreset>({
    queryKey: FACTURA_KEYS.cloudinaryPreset(tipo),
    queryFn: () => getCloudinaryPreset(tipo),
    enabled: tipo.length > 0,
    staleTime: 1000 * 60 * 5, // 5 min — signed presets are short-lived
  })
}
