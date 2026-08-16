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
 *
 * C-42 — `createVenta` and idempotency (design.md D1/D3/D4/D7):
 *   - Every call mints or reuses an `Idempotency-Key` via
 *     `idempotency.ts`, scoped to the `'venta-create'` namespace. Reuse
 *     (same key on a retry of the same payload) is the entire mechanism —
 *     see `idempotency.ts` for why.
 *   - The key is discarded (confirmed) on success — created OR a
 *     deduplicated replay — and on a `409` conflict. It is deliberately
 *     KEPT on every other failure (422, network error, 5xx) so a retry of
 *     the same payload reuses it (design.md D7). A 409 still throws (the
 *     caller must see it) — only the local pending-key bookkeeping is
 *     cleared.
 *   - Confirmation always passes `idempotencyKey` back to
 *     `confirmIdempotencyKey` (review fix, finding 1): confirmation is
 *     identity-aware, so a slow request's confirm can never wipe a
 *     DIFFERENT, newer attempt that already overwrote the shared
 *     'venta-create' slot while this one was still in flight.
 *   - The resolved `replay` flag comes from `classifySuccess` (real
 *     status + real `Idempotent-Replay` header), not from guessing at the
 *     body — the body is identical between a creation and a replay.
 */
import { isAxiosError } from 'axios'
import { apiClient } from '@shared/api/client'
import { getIdempotencyKey, confirmIdempotencyKey } from '@shared/api/idempotency'
import { classifySuccess } from '@shared/api/submitOutcome'
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

// ── Create (C-42 — idempotent) ─────────────────────────────────────────────

const VENTA_IDEMPOTENCY_NAMESPACE = 'venta-create'

export interface CreateVentaResult {
  venta: Venta
  /** True for a deduplicated replay (200 + Idempotent-Replay) — no new row
   * was created (design.md D4). False for an ordinary 201 creation. */
  replay: boolean
}

/**
 * Create a sale. Always sends `Idempotency-Key` (task 9.1) — this is the
 * guard against a call site forgetting it: a POST without the header does
 * NOT error, so this header's presence is the only signal that a new call
 * site remembered to go through this function instead of a raw `apiClient`
 * call.
 */
export async function createVenta(data: VentaCreate): Promise<CreateVentaResult> {
  const idempotencyKey = getIdempotencyKey(VENTA_IDEMPOTENCY_NAMESPACE, data)
  try {
    const res = await apiClient.post<Venta>('/ventas', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    // Identity-aware (review fix, finding 1): confirms ONLY if the slot
    // still holds `idempotencyKey` — a slow response landing after a
    // different, newer sale already overwrote the shared slot must NOT
    // wipe that newer attempt's bookkeeping.
    confirmIdempotencyKey(VENTA_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    const outcome = classifySuccess(res)
    return { venta: res.data, replay: outcome.kind === 'alreadyRecorded' }
  } catch (err) {
    // A 409 means the key already resolved to a DIFFERENT sale — that
    // attempt is over, so the pending key is discarded too (design.md D7).
    // Everything else (422, network error, 5xx) keeps the key so a retry
    // of the same payload reuses it.
    if (isAxiosError(err) && err.response?.status === 409) {
      confirmIdempotencyKey(VENTA_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    }
    throw err
  }
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
