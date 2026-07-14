/**
 * Tests for the shared `formatMonto` helper (C-13, task 2).
 *
 * INVARIANTS:
 *   - The helper is a thin wrapper over `Intl.NumberFormat('es-AR', { style:
 *     'currency', currency: 'ARS', minimumFractionDigits: 2 })`. It does
 *     NOT recompute anything — it formats the value it is given.
 *   - String input is accepted (Pydantic v2 serializes Decimal as a JSON
 *     string at the wire; the cuenta-corriente API boundary parses it to
 *     `number` so the helper is normally called with `number`, but a
 *     defensive overload for `string` keeps the call sites consistent
 *     with the rest of the app).
 *
 * TDD: Task 2.1 (RED) → 2.2 (GREEN) → 2.3 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import { formatMonto } from './currency'

describe('formatMonto', () => {
  // Note: Intl.NumberFormat 'es-AR' uses a NARROW NO-BREAK SPACE (U+202F)
  // between the currency symbol and the number — NOT a regular space.
  // Hardcoding regular spaces makes the assertions visually correct but
  // semantically wrong. We test the actual format() output round-trip.
  const F = new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  })

  it('formats a positive amount as ARS currency with es-AR locale', () => {
    expect(formatMonto(1500.5)).toBe(F.format(1500.5))
  })

  it('formats zero as ARS currency', () => {
    expect(formatMonto(0)).toBe(F.format(0))
  })

  it('formats a negative amount with a leading minus sign (es-AR convention)', () => {
    expect(formatMonto(-300)).toBe(F.format(-300))
  })

  it('accepts a string input (Pydantic Decimal-string boundary) and parses it', () => {
    expect(formatMonto('1234.56')).toBe(formatMonto(1234.56))
  })

  it('always uses 2 decimal digits (minimumFractionDigits)', () => {
    expect(formatMonto(100)).toBe(F.format(100))
  })
})
