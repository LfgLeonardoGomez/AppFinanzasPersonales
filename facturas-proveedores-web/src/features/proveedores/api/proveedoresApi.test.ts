/**
 * Boundary-value tests for the proveedores API's wire → public parsing
 * (C-41, D3, D9).
 *
 * `proveedoresApi` used to declare `saldo: number` on `Proveedor` and
 * `ProveedorListItem` without converting anything — the wire sends a
 * Pydantic-v2 Decimal-as-string and the client handed it straight through.
 * The type promised a number; the value on the wire was a string.
 *
 * `parseProveedor` / `parseProveedorListItem` are the boundary that makes
 * the promise true, mirroring `parseCuentaCorriente` (C-13) and
 * `estadisticasParse.ts` (C-38): `Raw*` shapes mirror the wire exactly and
 * stay internal to `proveedoresApi.ts`; a malformed Decimal throws rather
 * than degrading to `0` (D4, D-88) — a fabricated zero on a supplier's
 * balance is indistinguishable from a real one.
 */
import { describe, it, expect } from 'vitest'
import { parseProveedor, parseProveedorListItem } from './proveedoresApi'

function rawProveedor(saldo: string) {
  return {
    id: 'prov-1',
    nombre: 'Proveedor Uno',
    cuit: '20-12345678-9',
    telefono: null,
    categoria: 'OTRO' as const,
    notas: null,
    saldo,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
  }
}

function rawProveedorListItem(saldo: string) {
  return {
    id: 'prov-1',
    nombre: 'Proveedor Uno',
    cuit: '20-12345678-9',
    categoria: 'OTRO' as const,
    saldo,
    ultima_factura_fecha: null,
  }
}

describe('parseProveedor — boundary values', () => {
  it('round-trip 0', () => {
    const out = parseProveedor(rawProveedor('0.00'))
    expect(out.saldo).toBe(0)
  })

  it('round-trip 0.01 (smallest positive magnitude)', () => {
    const out = parseProveedor(rawProveedor('0.01'))
    expect(out.saldo).toBe(0.01)
  })

  it('round-trip -0.01 (smallest negative magnitude)', () => {
    const out = parseProveedor(rawProveedor('-0.01'))
    expect(out.saldo).toBe(-0.01)
  })

  it('round-trip 99999999.99 (max magnitude per numeric(12,2))', () => {
    const out = parseProveedor(rawProveedor('99999999.99'))
    expect(out.saldo).toBe(99999999.99)
  })

  it('the CUIT is never touched by the money conversion (D3)', () => {
    // A CUIT is a digit string that must stay a string — this is the exact
    // case D3 exists to prevent an interceptor from silently corrupting.
    const out = parseProveedor(rawProveedor('0.00'))
    expect(out.cuit).toBe('20-12345678-9')
    expect(typeof out.cuit).toBe('string')
  })
})

describe('parseProveedor — malformed decimal throws (D4, D-88)', () => {
  it('throws a typed Error on a malformed saldo, never returns 0', () => {
    expect(() => parseProveedor(rawProveedor('not-a-number'))).toThrow(
      /parseProveedor.*saldo/,
    )
  })

  it('throws on an empty-string saldo — Number(\'\') is 0, not NaN', () => {
    expect(() => parseProveedor(rawProveedor(''))).toThrow(/parseProveedor.*saldo/)
  })
})

describe('parseProveedorListItem — boundary values', () => {
  it('round-trip 0', () => {
    const out = parseProveedorListItem(rawProveedorListItem('0.00'))
    expect(out.saldo).toBe(0)
  })

  it('round-trip 2500 (integer-valued Decimal)', () => {
    const out = parseProveedorListItem(rawProveedorListItem('2500.00'))
    expect(out.saldo).toBe(2500)
  })
})

describe('parseProveedorListItem — malformed decimal throws (D4, D-88)', () => {
  it('throws a typed Error on a malformed saldo, never returns 0', () => {
    expect(() => parseProveedorListItem(rawProveedorListItem('garbage'))).toThrow(
      /parseProveedorListItem.*saldo/,
    )
  })
})
