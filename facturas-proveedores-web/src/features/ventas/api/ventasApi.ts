/**
 * Raw Axios calls for the ventas (sales) API.
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 *
 * INVARIANTS (RN-VTA-03, design.md D1/D4):
 *   - `cliente_id IS NOT NULL ⟺ forma_pago = CUENTA_CORRIENTE`. `createVenta`
 *     forwards `cliente_id` exactly as given on `VentaCreate` — the caller
 *     (`VentaForm`, design.md D1) is responsible for never constructing a
 *     `VentaCreate` with a `cliente_id` on a non-`CUENTA_CORRIENTE` sale.
 *   - `updateVenta` NEVER sends `cliente_id: null` (design.md D4/D5, spec
 *     "A sale edit never asks the backend to clear the customer").
 *     `PATCH /api/ventas/{id}` reads an absent `cliente_id` key as "leave it
 *     alone"; clearing it happens implicitly as a consequence of sending a
 *     `forma_pago` other than `CUENTA_CORRIENTE`. `VentaUpdate.cliente_id` is
 *     typed `string` (never `null`) precisely so this cannot be expressed.
 *   - `negocio_id` / `creado_por_usuario_id` are never sent — both come from
 *     the session server-side.
 *
 * `deleteVenta` takes a `VentaDeleteInput` (carries `cliente_id` and
 * `forma_pago` alongside the `id`), following the `PagoDeleteInput`
 * precedent from C-13: cross-feature cache invalidation in `useDeleteVenta`
 * needs to know which customer's cached account to invalidate, and whether
 * the sale was on account at all, without an extra `GET`.
 */
import { apiClient } from '@shared/api/client'
import type {
  Venta,
  VentaListItem,
  VentaCreate,
  VentaUpdate,
  VentasFilters,
  VentaDeleteInput,
} from '@shared/api/api'

// ── List (unpaginated — design.md D2, GET /api/ventas returns a bare list) ────

export async function listVentas(filters: VentasFilters = {}): Promise<VentaListItem[]> {
  const params: Record<string, string | undefined> = {}
  if (filters.desde) params.desde = filters.desde
  if (filters.hasta) params.hasta = filters.hasta
  if (filters.forma_pago) params.forma_pago = filters.forma_pago
  if (filters.cliente_id) params.cliente_id = filters.cliente_id

  const res = await apiClient.get<VentaListItem[]>('/ventas', { params })
  return res.data
}

// ── Single ────────────────────────────────────────────────────────────────────

export async function getVenta(id: string): Promise<Venta> {
  const res = await apiClient.get<Venta>(`/ventas/${id}`)
  return res.data
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createVenta(data: VentaCreate): Promise<Venta> {
  const res = await apiClient.post<Venta>('/ventas', data)
  return res.data
}

// ── Update (partial) ──────────────────────────────────────────────────────────

export async function updateVenta(id: string, data: VentaUpdate): Promise<Venta> {
  const res = await apiClient.patch<Venta>(`/ventas/${id}`, data)
  return res.data
}

// ── Delete (soft delete on backend) ───────────────────────────────────────────

export async function deleteVenta(input: VentaDeleteInput): Promise<void> {
  await apiClient.delete(`/ventas/${input.id}`)
}
