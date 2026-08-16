/**
 * submitOutcome.ts — classifies the outcome of a protected write into the
 * four states a person actually needs to see (C-42, design.md D6,
 * escritura-idempotente spec "El resultado de un guardado se clasifica en
 * cuatro estados distinguibles").
 *
 * Today all four collapse into the same generic error with the button
 * re-enabled — that indistinction is what produces the duplicate charge.
 * This is a pure function: no React, no Axios import — only the duck-typed
 * shape of what Axios hands a `then`/`catch` (task 8.6), so it is trivial
 * to unit test and to reuse for pagos/facturas/cobros (C-43) without
 * dragging this module's dependents along.
 *
 * ANY 5xx (`status >= 500`) classifies as `unknown`, deliberately NOT
 * `rejected`: a 502/504 from a proxy can arrive AFTER the app already
 * committed, and treating that as "nothing was saved" invites the exact
 * duplicate this change exists to prevent. This is a range check, not an
 * enumeration of the codes we happened to think of first — a WAF or
 * reverse proxy can legitimately emit 501, 505, 507, 511, etc., and every
 * one of them carries the exact same "we don't know what happened
 * server-side" uncertainty as 500/502/503/504. Only 4xx (a real answer
 * from the application) counts as `rejected`.
 */

export type SubmitOutcome =
  | { kind: 'created' }
  | { kind: 'alreadyRecorded' }
  | { kind: 'rejected'; detail: unknown }
  | { kind: 'unknown' }

interface ResponseLike {
  status: number
  headers?: Record<string, unknown>
}

interface ErrorLike {
  response?: {
    status: number
    data?: { detail?: unknown }
  }
}

const UNKNOWN_STATUS_FLOOR = 500

/** Case-insensitive header lookup — Axios normalizes to lowercase, but this
 * module takes only a duck-typed shape, so it does not assume that. */
function headerEquals(headers: ResponseLike['headers'], name: string, value: string): boolean {
  if (!headers) return false
  const wantedName = name.toLowerCase()
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wantedName) {
      return String(headers[key]).toLowerCase() === value.toLowerCase()
    }
  }
  return false
}

/**
 * Classify a successful (2xx) response. `200` + `Idempotent-Replay: true`
 * is the ONLY shape that means "already recorded" — the body alone cannot
 * tell a replay from a fresh creation (design.md D4).
 */
export function classifySuccess(response: ResponseLike): SubmitOutcome {
  if (response.status === 200 && headerEquals(response.headers, 'idempotent-replay', 'true')) {
    return { kind: 'alreadyRecorded' }
  }
  return { kind: 'created' }
}

/**
 * Classify a failed request. No `response` at all (timeout, network error)
 * and a 5xx both mean "we don't know" — never `rejected`.
 */
export function classifyError(error: ErrorLike): SubmitOutcome {
  const status = error.response?.status
  if (status === undefined || status >= UNKNOWN_STATUS_FLOOR) {
    return { kind: 'unknown' }
  }
  return { kind: 'rejected', detail: error.response?.data?.detail }
}
