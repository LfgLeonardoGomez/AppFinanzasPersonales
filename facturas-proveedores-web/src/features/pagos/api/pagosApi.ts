/**
 * Raw Axios calls for the pagos (payments) API.
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 *
 * INVARIANTS (RN-PAG-01, hard rule #1):
 *   - PagoCreate / PagoUpdate are imported from @shared/api/api.
 *     Neither declares a `factura_id` key (triple-enforced: SQLModel, schema,
 *     wire). The TS types guarantee the function signatures here cannot be
 *     called with a `factura_id`. The test in `api.pagos.test.ts` locks this.
 *   - `usuario_id` is taken from the session by the backend — never sent.
 *   - `origen` is stamped MANUAL by the service — never sent.
 *   - `proveedor_id` cannot be changed via PATCH (D7) — PagoUpdate has no
 *     such field.
 *
 * C-13 (D6): `deletePago` now takes a `PagoDeleteInput` (carries the
 * `proveedor_id` alongside the `id`) so the cross-feature cache
 * invalidation in `useDeletePago` can target the right
 * `cuenta-corriente.detail(proveedorId)` key without an extra
 * GET /api/pagos/{id} round-trip. NO `factura_id` key (RN-PAG-01).
 */
import { apiClient } from '@shared/api/client'
import type {
  PagoResponse,
  PagoListResponse,
  PagoCreate,
  PagoUpdate,
  PagosFilters,
  PagoDeleteInput,
} from '@shared/api/api'

// ── List (paginated, filtered) ────────────────────────────────────────────────

export async function listPagos(filters: PagosFilters = {}): Promise<PagoListResponse> {
  const params: Record<string, string | number | undefined> = {}
  if (filters.proveedor_id) params.proveedor_id = filters.proveedor_id
  if (filters.page) params.page = filters.page

  const res = await apiClient.get<PagoListResponse>('/pagos', { params })
  return res.data
}

// ── Single ────────────────────────────────────────────────────────────────────

export async function getPago(id: string): Promise<PagoResponse> {
  const res = await apiClient.get<PagoResponse>(`/pagos/${id}`)
  return res.data
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createPago(data: PagoCreate): Promise<PagoResponse> {
  const res = await apiClient.post<PagoResponse>('/pagos', data)
  return res.data
}

// ── Update (partial) ──────────────────────────────────────────────────────────

export async function updatePago(
  id: string,
  data: PagoUpdate,
): Promise<PagoResponse> {
  const res = await apiClient.patch<PagoResponse>(`/pagos/${id}`, data)
  return res.data
}

// ── Delete (soft delete on backend) ───────────────────────────────────────────

export async function deletePago(input: PagoDeleteInput): Promise<void> {
  await apiClient.delete(`/pagos/${input.id}`)
}
