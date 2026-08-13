/**
 * TanStack Query hooks for clientes (customers) — C-32 backend, C-34 frontend.
 *
 * Server state (list, search) → TanStack Query.
 * UI state (dropdown open, active index) → local useState in the consuming
 * component (`ClienteAutocomplete`).
 *
 * `CLIENTE_KEYS` is exported so C-35/C-36's customer account view can
 * cross-invalidate it, mirroring how `PAGO_KEYS` and `CUENTA_CORRIENTE_KEYS`
 * cross-invalidate in C-13 (design.md D7).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buscarClientes, crearCliente, listClientes } from './clientesApi'
import type { ClienteCreate } from '@shared/api/api'

// ── Query keys ────────────────────────────────────────────────────────────────

export const CLIENTE_KEYS = {
  all: ['clientes'] as const,
  buscar: (nombre: string) => ['clientes', 'buscar', nombre] as const,
}

// Autocomplete searches shorter than this are not sent — mirrors
// `useBuscarProveedores`'s threshold (SupplierSearch's `shouldShowDropdown`).
const MIN_QUERY_LENGTH = 2

// ── useClientes ───────────────────────────────────────────────────────────────

export function useClientes() {
  return useQuery({
    queryKey: CLIENTE_KEYS.all,
    queryFn: () => listClientes(),
  })
}

// ── useBuscarClientes ─────────────────────────────────────────────────────────

export function useBuscarClientes(nombre: string) {
  return useQuery({
    queryKey: CLIENTE_KEYS.buscar(nombre),
    queryFn: () => buscarClientes(nombre),
    enabled: nombre.trim().length >= MIN_QUERY_LENGTH,
    staleTime: 1000 * 30, // 30s — search results are short-lived
  })
}

// ── useCreateCliente ──────────────────────────────────────────────────────────

export function useCreateCliente() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ClienteCreate) => crearCliente(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CLIENTE_KEYS.all })
    },
  })
}
