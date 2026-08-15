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
    confirmIdempotencyKey('ns-7.4')
    const second = getIdempotencyKey('ns-7.4', { ...payload })
    expect(second).not.toBe(first)
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
