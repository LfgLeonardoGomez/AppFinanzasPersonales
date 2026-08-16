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
 * This change implements NO idempotency. When C-43 Fase B lands, it adds,
 * and ONLY adds:
 *   1. two imports from `@shared/api/idempotency`
 *      (`getIdempotencyKey`, `confirmIdempotencyKey`);
 *   2. a `const COBRO_IDEMPOTENCY_NAMESPACE = 'cobro-create'`;
 *   3. `const key = getIdempotencyKey(COBRO_IDEMPOTENCY_NAMESPACE, data)`
 *      and the `Idempotency-Key` header on the POST;
 *   4. a `try/catch` around it: `confirmIdempotencyKey(…, key)` on success
 *      and on a `409`, rethrowing everything else;
 *   5. swapping the ambiguous-outcome copy in `CobroFormDialog` (design.md
 *      D8).
 *
 * C-36 deliberately does NOT pre-add the empty `try/catch` in step 4: a
 * catch that only rethrows is dead code a reviewer has to reason about, and
 * adding it later is smaller than reading it now.
 */
import { apiClient } from '@shared/api/client'
import { classifySuccess } from '@shared/api/submitOutcome'
import type { CobroCliente, CobroClienteCreate } from '@shared/api/api'

export interface CrearCobroResult {
  cobro: CobroCliente
  /** True for a deduplicated replay. Always false until C-43 wires the
   *  Idempotency-Key: `classifySuccess` only reports `alreadyRecorded` for
   *  a 200 carrying `Idempotent-Replay: true`, which this endpoint does not
   *  send yet. The SHAPE is what matters — see design.md D7. */
  replay: boolean
}

export async function crearCobro(data: CobroClienteCreate): Promise<CrearCobroResult> {
  const res = await apiClient.post<CobroCliente>('/cobros', data)
  const outcome = classifySuccess(res)
  return { cobro: res.data, replay: outcome.kind === 'alreadyRecorded' }
}
