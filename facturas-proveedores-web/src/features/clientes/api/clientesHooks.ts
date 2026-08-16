/**
 * TanStack Query hooks for clientes (customers) — C-32 backend, C-34
 * frontend, C-36 (customer ledger + account) design.md D4.
 *
 * Server state (list, search, single, cuenta-corriente) → TanStack Query.
 * UI state (dropdown open, active index) → local useState in the consuming
 * component (`ClienteAutocomplete`).
 *
 * `CLIENTE_KEYS` is exported so C-34's ventas feature and C-36's cobros can
 * cross-invalidate it, mirroring how `PAGO_KEYS` and `CUENTA_CORRIENTE_KEYS`
 * cross-invalidate in C-13 (design.md D7).
 *
 * C-36 (design.md D4) — `cuentaCorriente` is nested UNDER `CLIENTE_KEYS`
 * rather than in a sibling namespace: `['clientes']` (CLIENTE_KEYS.all) is a
 * PREFIX of `['clientes', 'cuenta-corriente', id]`, so TanStack Query's
 * prefix-matching invalidation means every existing
 * `invalidateQueries({ queryKey: CLIENTE_KEYS.all })` call in
 * `ventasHooks.ts` (C-34, unmodified by this change) ALREADY invalidates a
 * customer's account view. That is the entire mechanism — no edit to the
 * ventas feature was needed to wire this up.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { buscarClientes, crearCliente, listClientes, getCliente } from './clientesApi'
import { getCuentaCorrienteCliente } from './cuentaCorrienteClienteApi'
import type { ClienteCreate } from '@shared/api/api'

// ── Query keys ────────────────────────────────────────────────────────────────

export const CLIENTE_KEYS = {
  all: ['clientes'] as const,
  buscar: (nombre: string) => ['clientes', 'buscar', nombre] as const,
  detail: (id: string) => ['clientes', 'detail', id] as const,
  cuentaCorriente: (clienteId: string) => ['clientes', 'cuenta-corriente', clienteId] as const,
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

// ── useCliente (single) ──────────────────────────────────────────────────────
//
// C-36, design.md D5 — the name-only read. `retry: false` mirrors
// `useProveedor`/`useCuentaCorriente`: a 404 is a real answer, not a
// transient error. Never read `.saldo` off this query's data — it is
// structurally `null` on this endpoint.

export function useCliente(id: string) {
  return useQuery({
    queryKey: CLIENTE_KEYS.detail(id),
    queryFn: () => getCliente(id),
    enabled: Boolean(id),
    retry: false,
  })
}

// ── useCuentaCorrienteCliente ─────────────────────────────────────────────────
//
// C-36, design.md D4 — mirrors `useCuentaCorriente` (C-13): `retry: false`
// (a 404 is a real answer — foreign negocio, soft-deleted, or missing —
// rendered as an empty state, not a retry spinner) and `staleTime: 0` so a
// revisit refetches.

export function useCuentaCorrienteCliente(clienteId: string) {
  return useQuery({
    queryKey: CLIENTE_KEYS.cuentaCorriente(clienteId),
    queryFn: () => getCuentaCorrienteCliente(clienteId),
    enabled: Boolean(clienteId),
    retry: false,
    staleTime: 0,
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
