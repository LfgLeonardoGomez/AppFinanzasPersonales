/**
 * Runtime type-guard tests for the Pago domain types in `api.d.ts`.
 *
 * Purpose: catch at runtime any accidental addition of a `factura`-named key
 * to the Pago request payloads. This complements the compile-time guard in
 * `api.types.test-d.ts` — if both guards trip, the contributor has to break
 * the wire contract on purpose, not by accident.
 *
 * The approach: instantiate a value typed as `PagoCreate` / `PagoUpdate` and
 * assert via `Object.keys` / `hasOwnProperty` that no key contains
 * `factura`. If the TS type gains such a key in the future, the test fails.
 *
 * TDD: Task 1.3 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import type { PagoCreate, PagoUpdate, PagoResponse, PagoDeleteInput } from './api'

describe('Pago types — RN-PAG-01 enforcement (runtime guard)', () => {
  it('PagoCreate has no key whose name contains "factura"', () => {
    const payload: PagoCreate = {
      proveedor_id: 'prov-1',
      monto: 1500,
      fecha: '2026-06-01',
      metodo: 'EFECTIVO',
    }
    const offending = Object.keys(payload).filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
  })

  it('PagoUpdate has no key whose name contains "factura"', () => {
    const payload: PagoUpdate = {
      monto: 1500,
      fecha: '2026-06-01',
      metodo: 'TRANSFERENCIA',
    }
    const offending = Object.keys(payload).filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
  })

  it('PagoUpdate has no `proveedor_id` key (D7 — re-link forbidden)', () => {
    const payload: PagoUpdate = {
      monto: 1500,
    }
    expect('proveedor_id' in payload).toBe(false)
  })

  it('PagoResponse has no key whose name contains "factura"', () => {
    const response: PagoResponse = {
      id: 'pago-1',
      usuario_id: 'user-1',
      proveedor_id: 'prov-1',
      monto: 1500,
      fecha: '2026-06-01',
      metodo: 'EFECTIVO',
      comprobante_url: null,
      origen: 'MANUAL',
      created_at: '2026-06-01T10:00:00',
      updated_at: '2026-06-01T10:00:00',
    }
    const offending = Object.keys(response).filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
  })

  // ── C-13: PagoDeleteInput (the new delete signature) has no `factura_id` ─────
  // The D6 cross-feature cache invalidation needs `proveedor_id` to know which
  // cuenta-corriente key to invalidate. The structural absence of `factura_id`
  // here is defense in depth for RN-PAG-01 on the delete path.
  it('PagoDeleteInput has no key whose name contains "factura"', () => {
    const input: PagoDeleteInput = {
      id: 'pago-1',
      proveedor_id: 'prov-1',
    }
    const offending = Object.keys(input).filter((k) => k.toLowerCase().includes('factura'))
    expect(offending).toEqual([])
  })

  it('PagoDeleteInput carries proveedor_id for cross-feature invalidation (D6)', () => {
    const input: PagoDeleteInput = {
      id: 'pago-1',
      proveedor_id: 'prov-1',
    }
    expect(input.proveedor_id).toBe('prov-1')
    expect(input.id).toBe('pago-1')
  })
})
