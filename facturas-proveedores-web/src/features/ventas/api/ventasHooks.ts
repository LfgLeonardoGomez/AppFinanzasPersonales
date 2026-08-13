/**
 * TanStack Query hooks for ventas (sales).
 *
 * Server state (list, single) → TanStack Query.
 * UI state (filters, dialogs) → local useState / URL search params in
 * components (design.md D9).
 *
 * Mirrors the C-13 `pagosHooks.ts` structure for predictability.
 *
 * D6/D7 (design.md) — cross-feature cache invalidation: every mutation that
 * affects a sale ALSO invalidates `CLIENTE_KEYS.all` whenever the sale is (or
 * was) on `CUENTA_CORRIENTE`, so C-35/C-36's customer account view
 * reactively refreshes — mirroring the `CUENTA_CORRIENTE_KEYS` invalidation
 * in `pagosHooks.ts` (C-13). A cash sale never touches the customer cache.
 *
 * `updateVenta`/`useUpdateVenta` follow the D4/D5 contract: `cliente_id` is
 * never sent as `null`. Whether the *previous* state of the sale was on
 * account is passed in by the caller (`VentaForm`/`DeudaDesapareceDialog`,
 * section 6/8) via `previousFormaPago`, because the PATCH response alone
 * cannot tell us what changed (the server does not echo "was CUENTA_CORRIENTE
 * before this request").
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listVentas, getVenta, createVenta, updateVenta, deleteVenta } from './ventasApi'
import type { VentaCreate, VentaUpdate, VentasFilters, VentaDeleteInput } from '@shared/api/api'
import { CLIENTE_KEYS } from '@features/clientes/api/clientesHooks'

// ── Query keys ────────────────────────────────────────────────────────────────

export const VENTA_KEYS = {
  all: ['ventas'] as const,
  list: (filters: VentasFilters) => ['ventas', 'list', filters] as const,
  detail: (id: string) => ['ventas', 'detail', id] as const,
}

// ── useVentas ─────────────────────────────────────────────────────────────────

export function useVentas(filters: VentasFilters = {}) {
  return useQuery({
    queryKey: VENTA_KEYS.list(filters),
    queryFn: () => listVentas(filters),
  })
}

// ── useVenta (single) ─────────────────────────────────────────────────────────

export function useVenta(id: string) {
  return useQuery({
    queryKey: VENTA_KEYS.detail(id),
    queryFn: () => getVenta(id),
    enabled: Boolean(id),
    retry: false,
  })
}

// ── useCreateVenta ────────────────────────────────────────────────────────────

export function useCreateVenta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: VentaCreate) => createVenta(data),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: VENTA_KEYS.all })
      // D6/D7 — a sale created on account changes the customer's cached
      // balance view; a cash sale touches no customer.
      if (created.forma_pago === 'CUENTA_CORRIENTE') {
        void queryClient.invalidateQueries({ queryKey: CLIENTE_KEYS.all })
      }
    },
  })
}

// ── useUpdateVenta ────────────────────────────────────────────────────────────

interface UpdateVentaVariables {
  id: string
  data: VentaUpdate
  /**
   * Whether the sale was on `CUENTA_CORRIENTE` before this update, so the
   * customer cache is invalidated even when the update MOVES the sale away
   * from cuenta corriente (the response's own `forma_pago` reflects only the
   * new state, not the transition).
   */
  wasOnAccount?: boolean
}

export function useUpdateVenta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: UpdateVentaVariables) => updateVenta(id, data),
    onSuccess: (updated, variables) => {
      void queryClient.invalidateQueries({ queryKey: VENTA_KEYS.all })
      queryClient.setQueryData(VENTA_KEYS.detail(updated.id), updated)
      // D6/D7 — invalidate the customer cache whenever the sale is on
      // account now, OR was on account before this edit (leaving cuenta
      // corriente also changes the customer's balance).
      if (updated.forma_pago === 'CUENTA_CORRIENTE' || variables.wasOnAccount) {
        void queryClient.invalidateQueries({ queryKey: CLIENTE_KEYS.all })
      }
    },
  })
}

// ── useDeleteVenta ────────────────────────────────────────────────────────────

export function useDeleteVenta() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: VentaDeleteInput) => deleteVenta(input),
    onSuccess: (_void, variables) => {
      void queryClient.invalidateQueries({ queryKey: VENTA_KEYS.all })
      // D6/D7 — deleting a sale on account removes a live charge from that
      // customer's balance; a cash sale touches no customer.
      if (variables.forma_pago === 'CUENTA_CORRIENTE') {
        void queryClient.invalidateQueries({ queryKey: CLIENTE_KEYS.all })
      }
    },
  })
}
