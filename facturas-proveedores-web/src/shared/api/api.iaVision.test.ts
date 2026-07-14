/**
 * Runtime type-guard tests for the IA vision proposal types in `api.d.ts`.
 *
 * Mirrors the C-11 `api.pagos.test.ts` pattern: instantiate a value typed
 * as `PropuestaFactura` / `PropuestaPago` and assert via `Object.keys` /
 * `hasOwnProperty` that the structural absence of the forbidden keys is
 * preserved at runtime. Defense in depth for RN-IA-06 and RN-PAG-01 on
 * the IA vision surface.
 *
 * TDD: Task 1.3 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import type { PropuestaFactura, PropuestaPago } from './api'

describe('PropuestaFactura — runtime shape (C-15, RN-IA-06)', () => {
  it('has exactly the 6 fields declared by the C-14 Pydantic schema', () => {
    const value: PropuestaFactura = {
      proveedor_nombre: 'Acme SA',
      numero: '0001-00012345',
      fecha_emision: '2026-06-15',
      monto_total: 12345.67,
      error: false,
      error_message: null,
    }
    expect(Object.keys(value).sort()).toEqual([
      'error',
      'error_message',
      'fecha_emision',
      'monto_total',
      'numero',
      'proveedor_nombre',
    ])
  })

  it('accepts a partial proposal with null fields (RN-IA-03)', () => {
    const value: PropuestaFactura = {
      proveedor_nombre: 'Acme SA',
      numero: null,
      fecha_emision: '2026-06-15',
      monto_total: null,
      error: false,
      error_message: null,
    }
    expect(value.numero).toBeNull()
    expect(value.monto_total).toBeNull()
  })

  it('accepts an error envelope (RN-IA-05, C-14 graceful failure)', () => {
    const value: PropuestaFactura = {
      proveedor_nombre: null,
      numero: null,
      fecha_emision: null,
      monto_total: null,
      error: true,
      error_message: 'Image too blurry',
    }
    expect(value.error).toBe(true)
    expect(value.error_message).toBe('Image too blurry')
  })

  it('has no key whose name contains "id" or "origen" (defense in depth)', () => {
    const value: PropuestaFactura = {
      proveedor_nombre: null,
      numero: null,
      fecha_emision: null,
      monto_total: null,
      error: false,
      error_message: null,
    }
    const offending = Object.keys(value).filter(
      (k) => k === 'id' || k === 'origen' || k.toLowerCase().includes('usuario'),
    )
    expect(offending).toEqual([])
  })

  it('has no key whose name contains "factura" or "created_at"/"updated_at"', () => {
    const value: PropuestaFactura = {
      proveedor_nombre: null,
      numero: null,
      fecha_emision: null,
      monto_total: null,
      error: false,
      error_message: null,
    }
    const offending = Object.keys(value).filter(
      (k) =>
        k.toLowerCase().includes('factura') ||
        k === 'created_at' ||
        k === 'updated_at' ||
        k === 'proveedor_id',
    )
    expect(offending).toEqual([])
  })
})

describe('PropuestaPago — runtime shape (C-15, RN-PAG-01 surface defense)', () => {
  it('has exactly the 6 fields declared by the C-14 Pydantic schema', () => {
    const value: PropuestaPago = {
      proveedor_nombre: 'Acme SA',
      monto: 5000,
      fecha: '2026-06-20',
      metodo: 'TRANSFERENCIA',
      error: false,
      error_message: null,
    }
    expect(Object.keys(value).sort()).toEqual([
      'error',
      'error_message',
      'fecha',
      'metodo',
      'monto',
      'proveedor_nombre',
    ])
  })

  it('accepts a metodo of null when the vision model could not read it', () => {
    const value: PropuestaPago = {
      proveedor_nombre: 'Acme SA',
      monto: 1000,
      fecha: '2026-06-20',
      metodo: null,
      error: false,
      error_message: null,
    }
    expect(value.metodo).toBeNull()
  })

  it('has no key whose name contains "factura" (RN-PAG-01 surface defense)', () => {
    const value: PropuestaPago = {
      proveedor_nombre: null,
      monto: null,
      fecha: null,
      metodo: null,
      error: false,
      error_message: null,
    }
    const offending = Object.keys(value).filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
  })

  it('has no key whose name is "id" / "origen" / "created_at" / "updated_at" / "proveedor_id"', () => {
    const value: PropuestaPago = {
      proveedor_nombre: null,
      monto: null,
      fecha: null,
      metodo: null,
      error: false,
      error_message: null,
    }
    const offending = Object.keys(value).filter(
      (k) =>
        k === 'id' ||
        k === 'origen' ||
        k === 'created_at' ||
        k === 'updated_at' ||
        k === 'proveedor_id' ||
        k === 'usuario_id',
    )
    expect(offending).toEqual([])
  })
})
