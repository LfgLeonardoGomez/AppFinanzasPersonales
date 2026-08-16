/**
 * Tests for `idempotency.ts` — the client-side lifecycle of an
 * Idempotency-Key for a single pending write attempt (C-42, design.md
 * D1/D7, tasks 7.1-7.6).
 *
 * Each test uses its own `namespace` string so tests never interfere with
 * each other through the module's shared pending-attempt state or through
 * sessionStorage (both are keyed by namespace).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  mintIdempotencyKey,
  getIdempotencyKey,
  confirmIdempotencyKey,
} from './idempotency'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

beforeEach(() => {
  sessionStorage.clear()
})

// ── 7.1 — minting produces valid, distinct UUIDs ────────────────────────────

describe('mintIdempotencyKey — minting (task 7.1)', () => {
  it('returns a valid UUID', () => {
    const key = mintIdempotencyKey()
    expect(key).toMatch(UUID_V4)
  })

  it('returns a different key on a second call (triangulation)', () => {
    const a = mintIdempotencyKey()
    const b = mintIdempotencyKey()
    expect(a).not.toBe(b)
  })
})

// ── 7.2 — fallback when crypto.randomUUID is absent ─────────────────────────

describe('mintIdempotencyKey — fallback without crypto.randomUUID (task 7.2)', () => {
  it('still returns a valid UUID via crypto.getRandomValues when randomUUID is missing', () => {
    const original = globalThis.crypto.randomUUID
    // @ts-expect-error — simulating an old WebView without randomUUID
    delete globalThis.crypto.randomUUID
    try {
      const key = mintIdempotencyKey()
      expect(key).toMatch(UUID_V4)
    } finally {
      globalThis.crypto.randomUUID = original
    }
  })

  it('the fallback also produces distinct keys across calls (triangulation)', () => {
    const original = globalThis.crypto.randomUUID
    // @ts-expect-error — simulating an old WebView without randomUUID
    delete globalThis.crypto.randomUUID
    try {
      const a = mintIdempotencyKey()
      const b = mintIdempotencyKey()
      expect(a).not.toBe(b)
    } finally {
      globalThis.crypto.randomUUID = original
    }
  })
})

// ── 7.3 — reuse for the same payload, mint for a different one ─────────────

describe('getIdempotencyKey — reuse vs. mint (task 7.3)', () => {
  it('returns the same key for a payload already seen', () => {
    const payload = { monto: '100.00', fecha: '2026-08-10', forma_pago: 'EFECTIVO' }
    const first = getIdempotencyKey('ns-7.3-a', payload)
    const second = getIdempotencyKey('ns-7.3-a', { ...payload })
    expect(second).toBe(first)
  })

  it('returns a new key for a different payload (triangulation)', () => {
    const first = getIdempotencyKey('ns-7.3-b', { monto: '100.00', fecha: '2026-08-10' })
    const second = getIdempotencyKey('ns-7.3-b', { monto: '999.00', fecha: '2026-08-10' })
    expect(second).not.toBe(first)
  })
})

// ── 7.4 — confirming discards the key ───────────────────────────────────────

describe('confirmIdempotencyKey — discard on confirmation (task 7.4)', () => {
  it('a payload requested again after confirmation gets a different key', () => {
    const payload = { monto: '250.00', fecha: '2026-08-11' }
    const first = getIdempotencyKey('ns-7.4', payload)
    confirmIdempotencyKey('ns-7.4', first)
    const second = getIdempotencyKey('ns-7.4', { ...payload })
    expect(second).not.toBe(first)
  })
})

// ── Review fix (finding 1, CRITICAL) — identity-aware confirmation ─────────
//
// `confirmIdempotencyKey` used to take only a `namespace` and clear
// whatever attempt was currently in the slot, unconditionally. Per
// namespace there is exactly ONE pending-attempt slot (module doc,
// lines 13-19) — so a cross-submission race wipes a still-pending key:
//
//   1. Sale A submitted -> keyA minted, slot = {keyA, payloadA}. Hangs.
//   2. A DIFFERENT sale B is submitted before A resolves -> payload
//      mismatch -> keyB minted, slot overwritten to {keyB, payloadB}.
//   3. A's slow request finally resolves and confirms with keyA -> the
//      old code deleted the slot unconditionally, wiping B's still-
//      pending bookkeeping even though B has nothing to do with keyA.
//   4. B's own attempt comes back ambiguous (timeout/5xx) -> the retry
//      can no longer find a pending entry for payloadB -> it mints a
//      NEW key instead of reusing keyB -> the "safe to retry" banner is
//      now a lie: if B's first attempt actually committed server-side,
//      the retry creates a duplicate sale (a double charge for a fiado).
//
// Fix: `confirmIdempotencyKey(namespace, key)` only clears the slot when
// it still holds THAT key — a stale confirmation from a superseded
// attempt becomes a safe no-op instead of clobbering a newer attempt.

describe('confirmIdempotencyKey — identity-aware confirmation (review fix, finding 1)', () => {
  it('does NOT clear a newer pending attempt when a stale (superseded) key confirms — reproduces the cross-submission race', () => {
    // 1. Sale A is submitted; its key is minted and becomes the pending slot.
    const payloadA = { monto: '100.00', fecha: '2026-08-10', forma_pago: 'EFECTIVO' }
    const keyA = getIdempotencyKey('ns-race', payloadA)

    // 2. Before A resolves, a DIFFERENT sale B is submitted — the payload
    // mismatch mints a new key and overwrites the shared slot.
    const payloadB = { monto: '200.00', fecha: '2026-08-10', forma_pago: 'EFECTIVO' }
    const keyB = getIdempotencyKey('ns-race', payloadB)
    expect(keyB).not.toBe(keyA)

    // 3. A's slow request finally resolves and confirms with ITS OWN
    // (now stale/superseded) key. This must be a no-op for B's slot.
    confirmIdempotencyKey('ns-race', keyA)

    // 4/5. B's bookkeeping must have survived: requesting B's payload
    // again (the retry) must reuse keyB, NOT mint a fresh key.
    const keyBRetry = getIdempotencyKey('ns-race', payloadB)
    expect(keyBRetry).toBe(keyB)
  })

  it('DOES clear the slot when confirming with the key that is actually pending (triangulation — confirmation still works for the honest case)', () => {
    const payload = { monto: '300.00', fecha: '2026-08-10', forma_pago: 'TRANSFERENCIA' }
    const key = getIdempotencyKey('ns-race-2', payload)
    confirmIdempotencyKey('ns-race-2', key)
    const next = getIdempotencyKey('ns-race-2', { ...payload })
    expect(next).not.toBe(key)
  })
})

// ── 7.5 — survives a tab reload (module reconstruction) ────────────────────

describe('getIdempotencyKey — survives a simulated tab reload (task 7.5)', () => {
  it('a fresh module import still reuses the key mirrored in sessionStorage', async () => {
    const payload = { monto: '333.00', fecha: '2026-08-12' }
    const before = getIdempotencyKey('ns-7.5', payload)

    // Simulate a tab reload: wipe the module registry so a fresh import
    // starts with an empty in-memory Map, and can only recover the pending
    // attempt from sessionStorage.
    vi.resetModules()
    const reloaded = await import('./idempotency')
    const after = reloaded.getIdempotencyKey('ns-7.5', { ...payload })

    expect(after).toBe(before)
  })
})

// ── 7.6 — degrades to memory-only when storage throws ───────────────────────

describe('getIdempotencyKey — sessionStorage unavailable (task 7.6)', () => {
  it('degrades to memory-only and does not throw when both getItem and setItem throw', () => {
    const getSpy = vi.spyOn(window.sessionStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError: storage disabled')
    })
    const setSpy = vi.spyOn(window.sessionStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    try {
      let key = ''
      expect(() => {
        key = getIdempotencyKey('ns-7.6', { monto: '1.00' })
      }).not.toThrow()
      expect(key).toMatch(UUID_V4)

      // Still reusable from the in-memory fallback within the same session.
      const reused = getIdempotencyKey('ns-7.6', { monto: '1.00' })
      expect(reused).toBe(key)
    } finally {
      getSpy.mockRestore()
      setSpy.mockRestore()
    }
  })
})
