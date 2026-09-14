/**
 * Tests for the shared `toFiniteNumber` helper (C-45 housekeeping,
 * 2026-09-14 — consolidates 8 duplicated copies, see decimal.ts header).
 *
 * TDD: RED (this file) → GREEN (decimal.ts) → TRIANGULATE (edge cases
 * below) → REFACTOR. Cases are derived from the 8 original
 * implementations, not invented: the empty-string rejection and the
 * "field name in the message" behavior come from the 5-file majority
 * shape; the 3-arg `context` parameter generalizes the `fn`
 * (ventasApi/facturasApi/pagosApi/proveedoresApi/actividadRecienteApi)
 * vs. fixed-prefix (cuentaCorrienteApi/cuentaCorrienteClienteApi/
 * estadisticasParse) split so both call-site shapes produce identical
 * error text to before.
 */
import { describe, it, expect } from 'vitest'
import { toFiniteNumber } from './decimal'

describe('toFiniteNumber', () => {
  it('parses a valid Decimal-string to a number', () => {
    expect(toFiniteNumber('123.45', 'monto', 'parseTest')).toBe(123.45)
  })

  it('parses "0" to 0 (a legitimate zero, not the empty-string fallback)', () => {
    expect(toFiniteNumber('0', 'monto', 'parseTest')).toBe(0)
  })

  it('parses a negative Decimal-string', () => {
    expect(toFiniteNumber('-5.5', 'saldo', 'parseTest')).toBe(-5.5)
  })

  it('throws — never returns 0 — on an empty string, naming the context and field', () => {
    expect(() => toFiniteNumber('', 'monto', 'parseTest')).toThrow(
      /parseTest: malformed Decimal at field "monto" — got an empty string/,
    )
  })

  it('throws on a whitespace-only string (trim() === "")', () => {
    expect(() => toFiniteNumber('   ', 'monto', 'parseTest')).toThrow(/empty string/)
  })

  it('throws on a non-numeric string, naming the context, field, and raw value', () => {
    expect(() => toFiniteNumber('abc', 'monto', 'parseTest')).toThrow(
      /parseTest: malformed Decimal at field "monto" — got "abc"/,
    )
  })

  it('throws on the literal string "NaN"', () => {
    expect(() => toFiniteNumber('NaN', 'monto', 'parseTest')).toThrow(/malformed Decimal/)
  })

  it('throws on the literal string "Infinity"', () => {
    expect(() => toFiniteNumber('Infinity', 'monto', 'parseTest')).toThrow(/malformed Decimal/)
  })

  it('includes the caller-supplied context (triangulation: a different context/field pair)', () => {
    expect(() => toFiniteNumber('nope', 'saldo_acumulado', 'parseCuentaCorriente')).toThrow(
      /parseCuentaCorriente: malformed Decimal at field "saldo_acumulado" — got "nope"/,
    )
  })
})
