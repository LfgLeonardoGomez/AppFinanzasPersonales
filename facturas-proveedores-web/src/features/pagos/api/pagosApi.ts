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
 *
 * C-43 Fase B — `createPago` and idempotency (design.md D1/D3/D7). Same
 * recipe as `createVenta` (C-42), deliberately repeated rather than
 * abstracted (design.md D1): the shared pieces are `idempotency.ts` and
 * `submitOutcome.ts`, which are NOT modified here — they were written
 * generic in C-42 precisely so this wiring is additive.
 *   - Every call mints or reuses an `Idempotency-Key`, scoped to the
 *     `'pago-create'` namespace so a pending pago attempt never collides
 *     with a pending venta, factura or cobro one.
 *   - The key is discarded (confirmed) on success — created OR replay —
 *     and on a `409`. It is KEPT on every other failure (422, network
 *     error, 5xx) so a retry of the same payload reuses it, which is the
 *     whole mechanism.
 *   - Confirmation passes `idempotencyKey` back so it is identity-aware:
 *     a slow request resolving after a newer attempt already took the
 *     namespace slot cannot wipe that newer attempt's bookkeeping.
 *   - `updatePago` / `deletePago` deliberately send NO key: the backend
 *     does not dedupe them, and sending one would suggest a guarantee
 *     that does not exist.
 */
import { isAxiosError } from 'axios'
import { apiClient } from '@shared/api/client'
import { getIdempotencyKey, confirmIdempotencyKey } from '@shared/api/idempotency'
import { classifySuccess } from '@shared/api/submitOutcome'
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

// ── Create (C-43 Fase B — idempotent) ────────────────────────────────────────

const PAGO_IDEMPOTENCY_NAMESPACE = 'pago-create'

export interface CreatePagoResult {
  pago: PagoResponse
  /** True for a deduplicated replay (200 + `Idempotent-Replay`) — no new
   * row was created. False for an ordinary 201 creation. */
  replay: boolean
}

/**
 * Create a payment. ALWAYS sends `Idempotency-Key` — that invariant is
 * the guard (task 10.2): a POST without the header does NOT error, the
 * backend just falls back to the un-deduplicated path, so this function
 * being the only door to `POST /api/pagos` is the only thing standing
 * between a lost response and a duplicated payment.
 */
export async function createPago(data: PagoCreate): Promise<CreatePagoResult> {
  const idempotencyKey = getIdempotencyKey(PAGO_IDEMPOTENCY_NAMESPACE, data)
  try {
    const res = await apiClient.post<PagoResponse>('/pagos', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    confirmIdempotencyKey(PAGO_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    const outcome = classifySuccess(res)
    return { pago: res.data, replay: outcome.kind === 'alreadyRecorded' }
  } catch (err) {
    // A 409 means the key already resolved to a DIFFERENT payment — that
    // attempt is over, so the pending key goes with it. Everything else
    // (422, network error, 5xx) keeps the key so a retry of the same
    // payload reuses it.
    if (isAxiosError(err) && err.response?.status === 409) {
      confirmIdempotencyKey(PAGO_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    }
    throw err
  }
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
