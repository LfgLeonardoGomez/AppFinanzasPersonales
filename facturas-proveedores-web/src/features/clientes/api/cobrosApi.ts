/**
 * cobrosApi.ts — the C-43 idempotency seam (C-36, design.md D7).
 *
 * `crearCobro` is the SINGLE function that owns `POST /api/cobros`. Every
 * call site goes through it; none touches `apiClient` directly (task 5.7's
 * guard test enforces this structurally). It resolves to a result object,
 * never a bare response, so C-43 Fase B can wire idempotency in by editing
 * only this function — no change to the hook, the form, or any existing
 * test's shape.
 *
 * C-43 Fase B landed the idempotency C-36 left room for, exactly as that
 * seam predicted: the namespace, the header, and the identity-aware
 * confirm — no change to the hook, the dialog's submit path, or any
 * existing test's shape.
 *
 * WHY THE BACKEND ORDER MATTERS HERE (design.md D2). Cobros is the one
 * entity that does NOT follow C-42's "validate → insert → catch conflict"
 * order. `CobroClienteService._saldo_disponible` is a STATEFUL validation
 * — it subtracts the collections already persisted — so on a legitimate
 * retry it would evaluate the balance the ORIGINAL collection already
 * consumed and die with a 422 before ever reaching the INSERT that would
 * have recognised the key. Paying off a whole account would fail every
 * time. So the backend looks the key up BEFORE validating the balance.
 * Nothing about that is visible from this layer, but it is the reason
 * the retry of a full payoff resolves as a replay instead of a rejection.
 */
import { isAxiosError } from 'axios'
import { apiClient } from '@shared/api/client'
import { getIdempotencyKey, confirmIdempotencyKey } from '@shared/api/idempotency'
import { classifySuccess } from '@shared/api/submitOutcome'
import type { CobroCliente, CobroClienteCreate } from '@shared/api/api'

const COBRO_IDEMPOTENCY_NAMESPACE = 'cobro-create'

export interface CrearCobroResult {
  cobro: CobroCliente
  /** True for a deduplicated replay (200 + `Idempotent-Replay`) — no new
   *  row was created. False for an ordinary 201 creation. */
  replay: boolean
}

/**
 * Register a collection. ALWAYS sends `Idempotency-Key` (task 12.2) — a
 * POST without it does NOT error, so this function being the only door to
 * `POST /api/cobros` (pinned by the guard test below) is the only thing
 * standing between a lost response and a customer's debt being paid down
 * twice.
 */
export async function crearCobro(data: CobroClienteCreate): Promise<CrearCobroResult> {
  const idempotencyKey = getIdempotencyKey(COBRO_IDEMPOTENCY_NAMESPACE, data)
  try {
    const res = await apiClient.post<CobroCliente>('/cobros', data, {
      headers: { 'Idempotency-Key': idempotencyKey },
    })
    confirmIdempotencyKey(COBRO_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    const outcome = classifySuccess(res)
    return { cobro: res.data, replay: outcome.kind === 'alreadyRecorded' }
  } catch (err) {
    // A 409 means the key already resolved to a DIFFERENT collection —
    // that attempt is over. Everything else (422 for a real
    // insufficient-balance rejection, network error, 5xx) keeps the key so
    // a retry of the same payload reuses it.
    if (isAxiosError(err) && err.response?.status === 409) {
      confirmIdempotencyKey(COBRO_IDEMPOTENCY_NAMESPACE, idempotencyKey)
    }
    throw err
  }
}
