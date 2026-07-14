/**
 * Raw Axios calls for the facturas (invoices) API.
 *
 * All calls go through the shared client (withCredentials + 401 interceptor).
 * estado is NEVER computed here — it arrives from the backend (RN-FAC-09).
 * items_sum_mismatch from the response is the authoritative signal (RN-FAC-04).
 *
 * C-13 (D6): `deleteFactura` now takes a `FacturaDeleteInput` (carries the
 * `proveedor_id` alongside the `id`) so the cross-feature cache
 * invalidation in `useDeleteFactura` can target the right
 * `cuenta-corriente.detail(proveedorId)` key without an extra
 * GET /api/facturas/{id} round-trip.
 */
import { apiClient } from '@shared/api/client'
import type {
  FacturaListItem,
  FacturaResponse,
  FacturaCreate,
  FacturaUpdate,
  FacturasFilters,
  FacturaDeleteInput,
} from '@shared/api/api'

// ── CloudinaryPreset response shape ──────────────────────────────────────────

export interface CloudinaryPreset {
  upload_preset: string
  cloud_name: string
  signature: string
  api_key: string
  timestamp: number
}

// ── List (paginated, filtered) ────────────────────────────────────────────────

export async function listFacturas(filters: FacturasFilters = {}): Promise<FacturaListItem[]> {
  const params: Record<string, string | number | undefined> = {}
  if (filters.proveedor_id) params.proveedor_id = filters.proveedor_id
  if (filters.estado) params.estado = filters.estado
  if (filters.fecha_desde) params.fecha_desde = filters.fecha_desde
  if (filters.fecha_hasta) params.fecha_hasta = filters.fecha_hasta
  if (filters.page) params.page = filters.page

  const res = await apiClient.get<FacturaListItem[]>('/facturas', { params })
  return res.data
}

// ── Single ────────────────────────────────────────────────────────────────────

export async function getFactura(id: string): Promise<FacturaResponse> {
  const res = await apiClient.get<FacturaResponse>(`/facturas/${id}`)
  return res.data
}

// ── Create ────────────────────────────────────────────────────────────────────

export async function createFactura(data: FacturaCreate): Promise<FacturaResponse> {
  const res = await apiClient.post<FacturaResponse>('/facturas', data)
  return res.data
}

// ── Update (partial) ──────────────────────────────────────────────────────────

export async function updateFactura(
  id: string,
  data: FacturaUpdate,
): Promise<FacturaResponse> {
  const res = await apiClient.patch<FacturaResponse>(`/facturas/${id}`, data)
  return res.data
}

// ── Delete (soft delete on backend) ──────────────────────────────────────────

export async function deleteFactura(input: FacturaDeleteInput): Promise<void> {
  await apiClient.delete(`/facturas/${input.id}`)
}

// ── Cloudinary signed preset ──────────────────────────────────────────────────

export async function getCloudinaryPreset(tipo: string): Promise<CloudinaryPreset> {
  const res = await apiClient.get<CloudinaryPreset>('/cloudinary/preset-firmado', {
    params: { tipo },
  })
  return res.data
}
