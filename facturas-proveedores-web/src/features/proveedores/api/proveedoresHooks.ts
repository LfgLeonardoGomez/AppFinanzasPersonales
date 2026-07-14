/**
 * TanStack Query hooks for proveedores (suppliers).
 *
 * Server state (list, single, search) → TanStack Query.
 * UI state (modals, selected item) → local useState in components.
 *
 * saldo is NEVER computed on the frontend — it always comes from the API response (RN-SALDO).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  listProveedores,
  getProveedor,
  createProveedor,
  updateProveedor,
  deleteProveedor,
  buscarProveedores,
  type ListProveedoresParams,
} from './proveedoresApi'
import type { ProveedorCreate, ProveedorUpdate } from '@shared/api/api'

// ── Query keys ────────────────────────────────────────────────────────────────

export const PROVEEDOR_KEYS = {
  all: ['proveedores'] as const,
  list: (params: ListProveedoresParams) => ['proveedores', 'list', params] as const,
  detail: (id: string) => ['proveedores', 'detail', id] as const,
  buscar: (nombre: string) => ['proveedores', 'buscar', nombre] as const,
}

// ── useProveedores ────────────────────────────────────────────────────────────

export function useProveedores(params: ListProveedoresParams = {}) {
  return useQuery({
    queryKey: PROVEEDOR_KEYS.list(params),
    queryFn: () => listProveedores(params),
  })
}

// ── useProveedor (single) ─────────────────────────────────────────────────────

export function useProveedor(id: string) {
  return useQuery({
    queryKey: PROVEEDOR_KEYS.detail(id),
    queryFn: () => getProveedor(id),
    enabled: Boolean(id),
    retry: false,
  })
}

// ── useCreateProveedor ────────────────────────────────────────────────────────

export function useCreateProveedor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: ProveedorCreate) => createProveedor(data),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROVEEDOR_KEYS.all })
    },
  })
}

// ── useUpdateProveedor ────────────────────────────────────────────────────────

export function useUpdateProveedor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: ProveedorUpdate }) =>
      updateProveedor(id, data),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: PROVEEDOR_KEYS.all })
      queryClient.setQueryData(PROVEEDOR_KEYS.detail(updated.id), updated)
    },
  })
}

// ── useDeleteProveedor ────────────────────────────────────────────────────────

export function useDeleteProveedor() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteProveedor(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROVEEDOR_KEYS.all })
    },
  })
}

// ── useBuscarProveedores ──────────────────────────────────────────────────────

/**
 * Autocomplete search for supplier linkage (RN-VINC).
 * Query is disabled when nombre is empty or shorter than 2 chars.
 * Debounce is handled by the consuming component (SupplierSearch).
 */
export function useBuscarProveedores(nombre: string) {
  return useQuery({
    queryKey: PROVEEDOR_KEYS.buscar(nombre),
    queryFn: () => buscarProveedores(nombre),
    enabled: nombre.length >= 2,
    staleTime: 1000 * 30, // 30s — search results are short-lived
  })
}
