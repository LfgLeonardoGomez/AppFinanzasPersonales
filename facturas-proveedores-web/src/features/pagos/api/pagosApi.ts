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
 *
 * INVARIANT (C-41, D3, D9): the backend serializes `monto` as a Pydantic-v2
 * Decimal STRING. `parsePago` / `parsePagoListItem` convert it to the
 * `number` the public `PagoResponse` / `PagoListItem` types promise —
 * mirroring `parseFactura` (`facturasApi.ts`, task group 4). A malformed
 * Decimal throws rather than degrading to `0` (D4, D-88). `proveedor_id` —
 * a UUID, never a money field — is never touched by this conversion. The
 * `Raw*` interfaces mirror the wire exactly and stay internal to this
 * module.
 */
import { isAxiosError } from 'axios'
import { apiClient } from '@shared/api/client'
import { getIdempotencyKey, confirmIdempotencyKey } from '@shared/api/idempotency'
import { classifySuccess } from '@shared/api/submitOutcome'
import type {
  PagoResponse,
  PagoListItem,
  PagoListResponse,
  PagoCreate,
  PagoUpdate,
  PagosFilters,
  PagoDeleteInput,
  MetodoPago,
  OrigenDocumento,
} from '@shared/api/api'

// ── Wire (raw) shape — strings for decimals ───────────────────────────────────

interface RawPagoResponse {
  id: string
  negocio_id: string
  proveedor_id: string
  monto: string
  fecha: string
  metodo: MetodoPago
  comprobante_url: string | null
  origen: OrigenDocumento
  created_at: string
  updated_at: string
  proveedor_nombre?: string | null
}

interface RawPagoListItem {
  id: string
  proveedor_id: string
  monto: string
  fecha: string
  metodo: MetodoPago
  origen: OrigenDocumento
  created_at: string
}

interface RawPagoListResponse {
  items: RawPagoListItem[]
  total: number
  page: number
  page_size: number
}

// ── Wire → public boundary ────────────────────────────────────────────────────

function parsePago(raw: RawPagoResponse): PagoResponse {
  return {
    id: raw.id,
    negocio_id: raw.negocio_id,
    proveedor_id: raw.proveedor_id,
    monto: toFiniteNumber(raw.monto, 'monto', 'parsePago'),
    fecha: raw.fecha,
    metodo: raw.metodo,
    comprobante_url: raw.comprobante_url,
    origen: raw.origen,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    proveedor_nombre: raw.proveedor_nombre ?? null,
  }
}

function parsePagoListItem(raw: RawPagoListItem): PagoListItem {
  return {
    id: raw.id,
    proveedor_id: raw.proveedor_id,
    monto: toFiniteNumber(raw.monto, 'monto', 'parsePagoListItem'),
    fecha: raw.fecha,
    metodo: raw.metodo,
    origen: raw.origen,
    created_at: raw.created_at,
  }
}

function parsePagoListResponse(raw: RawPagoListResponse): PagoListResponse {
  return {
    items: raw.items.map(parsePagoListItem),
    total: raw.total,
    page: raw.page,
    page_size: raw.page_size,
  }
}

function toFiniteNumber(value: string, field: string, fn: string): number {
  // `Number('')` is 0, not NaN — an empty string would sail through a plain
  // `Number.isNaN` check and land on the screen as a real amount.
  if (value.trim() === '') {
    throw new Error(`${fn}: malformed Decimal at field "${field}" — got an empty string`)
  }

  const n = Number(value)
  if (!Number.isFinite(n)) {
    throw new Error(`${fn}: malformed Decimal at field "${field}" — got ${JSON.stringify(value)}`)
  }
  return n
}

// ── List (paginated, filtered) ────────────────────────────────────────────────

export async function listPagos(filters: PagosFilters = {}): Promise<PagoListResponse> {
  const params: Record<string, string | number | undefined> = {}
  if (filters.proveedor_id) params.proveedor_id = filters.proveedor_id
  if (filters.page) params.page = filters.page

  const res = await apiClient.get<RawPagoListResponse>('/pagos', { params })
  return parsePagoListResponse(res.data)
}

// ── Single ────────────────────────────────────────────────────────────────────

export async function getPago(id: string): Promise<PagoResponse> {
  const res = await apiClient.get<RawPagoResponse>(`/pagos/${id}`)
  return parsePago(res.data)
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
    const res = await apiClient.post<RawPagoResponse>('/pagos', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    confirmIdempotencyKey(PAGO_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    const outcome = classifySuccess(res)
    return { pago: parsePago(res.data), replay: outcome.kind === 'alreadyRecorded' }
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
  const res = await apiClient.patch<RawPagoResponse>(`/pagos/${id}`, data)
  return parsePago(res.data)
}

// ── Delete (soft delete on backend) ───────────────────────────────────────────

export async function deletePago(input: PagoDeleteInput): Promise<void> {
  await apiClient.delete(`/pagos/${input.id}`)
}
