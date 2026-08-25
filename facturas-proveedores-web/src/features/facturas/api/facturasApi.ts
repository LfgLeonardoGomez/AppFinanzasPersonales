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
 *
 * C-43 Fase B — `createFactura` and idempotency (design.md D1/D3/D7).
 * Same recipe as `createPago` / `createVenta`, deliberately repeated per
 * entity rather than abstracted (design.md D1) so the ONE real difference
 * stays visible: an invoice's identity INCLUDES its items (design.md D3).
 * `getIdempotencyKey` hashes the whole payload, items and all, so
 * correcting a line's description or price mints a NEW key — which is what
 * makes a correction reach the backend as a correction instead of
 * colliding with the original attempt's 409.
 *
 * `estado` is still never computed here (RN-FAC-09). On a replay the
 * backend rebuilds it at answer time over the supplier's current FIFO
 * pool, so it can legitimately differ from what the first attempt would
 * have returned (design.md D4) — this layer forwards it verbatim.
 *
 * `updateFactura` / `deleteFactura` deliberately send NO key: the backend
 * does not dedupe them.
 */
import { isAxiosError } from 'axios'
import { apiClient } from '@shared/api/client'
import { getIdempotencyKey, confirmIdempotencyKey } from '@shared/api/idempotency'
import { classifySuccess } from '@shared/api/submitOutcome'
import type {
  FacturaListItem,
  FacturaResponse,
  FacturaCreate,
  FacturaUpdate,
  FacturasFilters,
  FacturaDeleteInput,
} from '@shared/api/api'

// ── CloudinaryPreset response shape ──────────────────────────────────────────
//
// C-21: the canonical shape now lives alongside the shared
// `uploadToCloudinary` helper (`@shared/utils/uploadToCloudinary`), reused
// by both `FileUploadField` and `PropuestaIAModal`. Re-exported here so
// existing importers (`facturasHooks.ts`, tests) don't need to change.

import type { CloudinaryPreset } from '@shared/utils/uploadToCloudinary'

export type { CloudinaryPreset } from '@shared/utils/uploadToCloudinary'

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

// ── Create (C-43 Fase B — idempotent) ────────────────────────────────────────

const FACTURA_IDEMPOTENCY_NAMESPACE = 'factura-create'

export interface CreateFacturaResult {
  factura: FacturaResponse
  /** True for a deduplicated replay (200 + `Idempotent-Replay`) — no new
   * row was created. False for an ordinary 201 creation. */
  replay: boolean
}

/**
 * Create an invoice. ALWAYS sends `Idempotency-Key` — that invariant is
 * the guard (task 11.1): a POST without the header does NOT error, so
 * this function being the only door to `POST /api/facturas` is the only
 * thing standing between a lost response and a duplicated invoice.
 */
export async function createFactura(data: FacturaCreate): Promise<CreateFacturaResult> {
  const idempotencyKey = getIdempotencyKey(FACTURA_IDEMPOTENCY_NAMESPACE, data)
  try {
    const res = await apiClient.post<FacturaResponse>('/facturas', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    confirmIdempotencyKey(FACTURA_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    const outcome = classifySuccess(res)
    return { factura: res.data, replay: outcome.kind === 'alreadyRecorded' }
  } catch (err) {
    // A 409 means the key already resolved to a DIFFERENT invoice — that
    // attempt is over, so the pending key goes with it. Everything else
    // (422, network error, 5xx) keeps the key so a retry of the same
    // payload reuses it.
    if (isAxiosError(err) && err.response?.status === 409) {
      confirmIdempotencyKey(FACTURA_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    }
    throw err
  }
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
