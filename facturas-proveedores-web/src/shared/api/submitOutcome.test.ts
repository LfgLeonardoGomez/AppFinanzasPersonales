/**
 * Tests for `submitOutcome.ts` — the pure classifier for the result of a
 * protected write (C-42, design.md D6, escritura-idempotente spec "El
 * resultado de un guardado se clasifica en cuatro estados distinguibles",
 * tasks 8.1-8.6).
 *
 * Deliberately fixture-based, not MSW-based: this module takes only the
 * duck-typed shape of a response/error, never Axios or React themselves
 * (task 8.6). The REAL wiring against a live 200+header MSW response lives
 * in `ventasApi.test.ts` (createVenta), which exercises this classifier
 * through the real network path.
 */
import { describe, it, expect } from 'vitest'
import { classifySuccess, classifyError } from './submitOutcome'

// ── 8.1 — 201 → created ─────────────────────────────────────────────────────

describe('classifySuccess — created (task 8.1)', () => {
  it('a 201 with no replay header classifies as created', () => {
    const outcome = classifySuccess({ status: 201, headers: {} })
    expect(outcome).toEqual({ kind: 'created' })
  })
})

// ── 8.2 — 200 + Idempotent-Replay: true → alreadyRecorded ──────────────────

describe('classifySuccess — alreadyRecorded (task 8.2)', () => {
  it('a 200 with Idempotent-Replay: true classifies as alreadyRecorded', () => {
    const outcome = classifySuccess({ status: 200, headers: { 'idempotent-replay': 'true' } })
    expect(outcome).toEqual({ kind: 'alreadyRecorded' })
  })

  it('a 200 WITHOUT the replay header classifies as created (triangulation — header is what distinguishes them)', () => {
    const outcome = classifySuccess({ status: 200, headers: {} })
    expect(outcome).toEqual({ kind: 'created' })
  })

  it('header lookup is case-insensitive, matching how Axios normalizes response headers (triangulation)', () => {
    const outcome = classifySuccess({ status: 200, headers: { 'Idempotent-Replay': 'true' } })
    expect(outcome).toEqual({ kind: 'alreadyRecorded' })
  })
})

// ── 8.3 — 422 and 409 → rejected, with detail ───────────────────────────────

describe('classifyError — rejected (task 8.3)', () => {
  it('a 422 classifies as rejected, carrying the backend detail', () => {
    const outcome = classifyError({ response: { status: 422, data: { detail: 'Monto inválido.' } } })
    expect(outcome).toEqual({ kind: 'rejected', detail: 'Monto inválido.' })
  })

  it('a 409 also classifies as rejected, carrying its detail (triangulation)', () => {
    const detail = { mensaje: 'Esta operación ya fue registrada con otros datos.' }
    const outcome = classifyError({ response: { status: 409, data: { detail } } })
    expect(outcome).toEqual({ kind: 'rejected', detail })
  })
})

// ── 8.4 — no response (timeout, network) → unknown ──────────────────────────

describe('classifyError — unknown, no response (task 8.4)', () => {
  it('an error with no response classifies as unknown', () => {
    const outcome = classifyError({})
    expect(outcome).toEqual({ kind: 'unknown' })
  })
})

// ── 8.5 — 5xx → unknown, NOT rejected ───────────────────────────────────────

describe('classifyError — 5xx is unknown, not rejected (task 8.5)', () => {
  it.each([500, 502, 503, 504])('a %i classifies as unknown', (status) => {
    const outcome = classifyError({ response: { status, data: { detail: 'Bad gateway' } } })
    expect(outcome).toEqual({ kind: 'unknown' })
  })

  it('a 500 does NOT carry a detail (triangulation — it is not treated as a rejection at all)', () => {
    const outcome = classifyError({ response: { status: 500, data: { detail: 'nope' } } })
    expect(outcome.kind).toBe('unknown')
    expect('detail' in outcome).toBe(false)
  })
})
