/**
 * idempotency.ts — client-side lifecycle of an Idempotency-Key for a single
 * pending write attempt (C-42, design.md D1/D7, escritura-idempotente spec
 * "El cliente reutiliza la clave al reintentar el mismo intento de
 * guardado").
 *
 * Deliberately generic — no import from `features/ventas` — because
 * design.md's Goal is "que el mecanismo sea repetible sobre pagos,
 * facturas y cobros sin rediseñarlo" (C-43). Every call site picks its own
 * `namespace` string so two independent write endpoints never collide on
 * the same pending-attempt slot, in memory or in sessionStorage.
 *
 * Per namespace this module tracks exactly ONE pending attempt —
 * `{ key, payload }` for the most recent unconfirmed submit — never a
 * history of past payloads (design.md D7: "se guarda `{ key, payload }`
 * del intento pendiente"):
 *   - `getIdempotencyKey(namespace, payload)` reuses the pending key when
 *     `payload` matches what was minted for; otherwise it mints a new key
 *     and replaces the pending attempt.
 *   - `confirmIdempotencyKey(namespace, key)` discards the pending attempt
 *     — but ONLY if the slot still holds THAT key. The caller decides WHEN
 *     a result counts as confirmed — design.md D7: created, already-
 *     recorded, or rejected-with-conflict (409). Never on an unknown
 *     outcome (timeout / network / 5xx): the retry must keep reusing the
 *     same key, or the whole mechanism is a header nobody uses.
 *
 *     Identity-aware by design (review fix, C-42 finding 1, CRITICAL): a
 *     slow request's `.then` can resolve AFTER a second, different submit
 *     already overwrote the shared per-namespace slot with a newer
 *     attempt. An unconditional confirm would wipe that newer attempt's
 *     still-pending bookkeeping — the exact bug this signature prevents.
 *     A stale confirmation (its key no longer matches what's pending) is
 *     simply a no-op; only a confirmation that matches the current slot
 *     clears it. This makes `getIdempotencyKey`'s return value load-
 *     bearing for every caller, not just informational.
 *
 * Storage: mirrored to `sessionStorage` so a killed tab / reload between
 * the failed attempt and the retry does not reopen the duplicate-charge
 * window this change exists to close. If storage throws (private mode,
 * full quota) every access is wrapped in `try/catch` and degrades silently
 * to memory-only — losing persistence must never break the save itself.
 */

const STORAGE_PREFIX = 'idempotency-pending:'

interface PendingAttempt {
  key: string
  payloadJson: string
}

// One pending attempt per namespace, kept in memory for the life of the tab.
const memoryState = new Map<string, PendingAttempt>()

// ── UUID minting (design.md D1) ─────────────────────────────────────────────

/**
 * Mint a random (v4) idempotency key. Prefers `crypto.randomUUID()`;
 * WebViews on cheap Android phones can lack it, so this falls back to
 * building a v4 UUID by hand from `crypto.getRandomValues`. Both paths are
 * exercised at every call site that mints a key — a throw here would break
 * the save entirely.
 */
export function mintIdempotencyKey(): string {
  const cryptoObj = globalThis.crypto

  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return cryptoObj.randomUUID()
  }

  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16))
    // `noUncheckedIndexedAccess` treats these as possibly-undefined even
    // though the array literally has 16 elements — the `?? 0` never fires.
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40 // version 4
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80 // variant 10xx
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error('No secure random source available to mint an idempotency key.')
}

// ── Canonical payload comparison ────────────────────────────────────────────

/**
 * Deterministic JSON with object keys sorted, so field order alone never
 * causes a false "the payload changed" — the actual field VALUES are what
 * design.md D4 cares about.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

// ── sessionStorage mirror (design.md D7 — its own, droppable, task group) ──

function storageKeyFor(namespace: string): string {
  return `${STORAGE_PREFIX}${namespace}`
}

function readFromStorage(namespace: string): PendingAttempt | null {
  try {
    const raw = window.sessionStorage.getItem(storageKeyFor(namespace))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PendingAttempt>
    if (typeof parsed.key === 'string' && typeof parsed.payloadJson === 'string') {
      return { key: parsed.key, payloadJson: parsed.payloadJson }
    }
    return null
  } catch {
    // Storage unavailable or the stored value is corrupt — treat as "no
    // pending attempt" rather than propagate (task 7.6).
    return null
  }
}

function writeToStorage(namespace: string, attempt: PendingAttempt | null): void {
  try {
    if (attempt) {
      window.sessionStorage.setItem(storageKeyFor(namespace), JSON.stringify(attempt))
    } else {
      window.sessionStorage.removeItem(storageKeyFor(namespace))
    }
  } catch {
    // Degrade to memory-only. Losing persistence must never break the
    // save itself (design.md Risk — sessionStorage unavailable).
  }
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Get the idempotency key for this submit attempt. Reuses the pending key
 * for `namespace` when `payload` matches what it was minted for; otherwise
 * mints a fresh key and replaces the pending attempt.
 */
function getPending(namespace: string): PendingAttempt | null {
  return memoryState.get(namespace) ?? readFromStorage(namespace)
}

export function getIdempotencyKey(namespace: string, payload: unknown): string {
  const payloadJson = stableStringify(payload)
  const pending = getPending(namespace)

  if (pending && pending.payloadJson === payloadJson) {
    memoryState.set(namespace, pending)
    return pending.key
  }

  const attempt: PendingAttempt = { key: mintIdempotencyKey(), payloadJson }
  memoryState.set(namespace, attempt)
  writeToStorage(namespace, attempt)
  return attempt.key
}

/**
 * Discard the pending attempt for `namespace` — but only if it still holds
 * `key`. Call this once the outcome is confirmed — created, already
 * recorded, or rejected with a 409 conflict — never on an unknown outcome
 * (design.md D7).
 *
 * `key` MUST be the value `getIdempotencyKey` returned for the request
 * being confirmed (review fix, finding 1). A confirmation whose key no
 * longer matches the current pending attempt is stale — a newer submit
 * for this namespace already superseded it — and is a safe no-op instead
 * of wiping that newer attempt's bookkeeping.
 */
export function confirmIdempotencyKey(namespace: string, key: string): void {
  const pending = getPending(namespace)
  if (!pending || pending.key !== key) {
    return
  }
  memoryState.delete(namespace)
  writeToStorage(namespace, null)
}
