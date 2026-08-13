/**
 * Tests for calcularTotalesDelDia — pure aggregation helper (C-34, task 7.6/7.8).
 *
 * Spec scenario ("the total is the sum of the day's sales" / "the breakdown
 * separates the fiado from the money that came in"): a day holding $1.000 in
 * cash, $2.500 by card and $500 on account totals $4.000, broken down per
 * `forma_pago`.
 *
 * design.md D2: `monto` is a Decimal string on the wire and MUST be parsed at
 * the aggregation boundary, never accumulated as a float — triangulated below
 * with a classic float-drift case (0.10 + 0.20 in decimal-string form).
 */
import { describe, it, expect } from 'vitest'
import { calcularTotalesDelDia } from './totales'
import type { VentaListItem } from '@shared/api/api'

function venta(overrides: Partial<VentaListItem>): VentaListItem {
  return {
    id: 'v-1',
    negocio_id: 'negocio-1',
    cliente_id: null,
    fecha: '2026-08-13',
    monto: '100.00',
    forma_pago: 'EFECTIVO',
    notas: null,
    created_at: '2026-08-13T10:00:00',
    updated_at: '2026-08-13T10:00:00',
    ...overrides,
  }
}

describe('calcularTotalesDelDia', () => {
  it('returns a zero total and an empty breakdown for no sales', () => {
    const result = calcularTotalesDelDia([])
    expect(result.total).toBe(0)
    expect(result.porFormaPago).toEqual({})
  })

  it('sums $1.000 EFECTIVO + $2.500 TARJETA + $500 CUENTA_CORRIENTE to $4.000, broken down per method', () => {
    const ventas = [
      venta({ id: 'v-1', monto: '1000.00', forma_pago: 'EFECTIVO' }),
      venta({ id: 'v-2', monto: '2500.00', forma_pago: 'TARJETA' }),
      venta({ id: 'v-3', monto: '500.00', forma_pago: 'CUENTA_CORRIENTE' }),
    ]
    const result = calcularTotalesDelDia(ventas)
    expect(result.total).toBe(4000)
    expect(result.porFormaPago).toEqual({
      EFECTIVO: 1000,
      TARJETA: 2500,
      CUENTA_CORRIENTE: 500,
    })
  })

  it('accumulates two sales of the same forma_pago into one subtotal (triangulation)', () => {
    const ventas = [
      venta({ id: 'v-1', monto: '300.00', forma_pago: 'TRANSFERENCIA' }),
      venta({ id: 'v-2', monto: '150.50', forma_pago: 'TRANSFERENCIA' }),
    ]
    const result = calcularTotalesDelDia(ventas)
    expect(result.total).toBe(450.5)
    expect(result.porFormaPago).toEqual({ TRANSFERENCIA: 450.5 })
  })

  it('never drifts on decimal-string sums that break naive float addition (triangulation)', () => {
    // 0.10 + 0.20 === 0.30000000000000004 as raw floats — this must not leak.
    const ventas = [
      venta({ id: 'v-1', monto: '0.10', forma_pago: 'OTRO' }),
      venta({ id: 'v-2', monto: '0.20', forma_pago: 'OTRO' }),
    ]
    const result = calcularTotalesDelDia(ventas)
    expect(result.total).toBe(0.3)
    expect(result.porFormaPago.OTRO).toBe(0.3)
  })

  // ── toCentavos fallback coverage (review finding G) ──────────────────────
  //
  // `toCentavos` is the entire implementation of RN-VTA-05 and its fallback
  // path ("a non-numeric monto silently becomes 0 cents") had NO test
  // before this. These cases pin the current, real behaviour of that
  // boundary — they do not change it. See the negative-amount case below
  // for one where pinning surfaced an actual defect, reported rather than
  // silently fixed (out of this review's scope).

  describe('a malformed monto contributes 0, silently (documented fallback)', () => {
    it('treats a non-numeric monto as 0 without throwing', () => {
      const ventas = [
        venta({ id: 'v-1', monto: '100.00', forma_pago: 'EFECTIVO' }),
        venta({ id: 'v-2', monto: 'abc', forma_pago: 'EFECTIVO' }),
      ]
      const result = calcularTotalesDelDia(ventas)
      expect(result.total).toBe(100)
      expect(result.porFormaPago.EFECTIVO).toBe(100)
    })

    it('treats "NaN" and an empty string the same way (triangulation)', () => {
      const ventas = [
        venta({ id: 'v-1', monto: '50.00', forma_pago: 'TARJETA' }),
        venta({ id: 'v-2', monto: 'NaN', forma_pago: 'TARJETA' }),
      ]
      const result = calcularTotalesDelDia(ventas)
      expect(result.total).toBe(50)
      expect(result.porFormaPago.TARJETA).toBe(50)
    })
  })

  describe('a monto with more than 2 decimal places rounds to the nearest cent', () => {
    it('rounds 10.005 up to $10.01 (float representation puts it just above the half-cent)', () => {
      const result = calcularTotalesDelDia([venta({ monto: '10.005', forma_pago: 'EFECTIVO' })])
      expect(result.total).toBe(10.01)
    })

    it('rounds 10.126 up to $10.13 (triangulation, three decimals)', () => {
      const result = calcularTotalesDelDia([venta({ monto: '10.126', forma_pago: 'EFECTIVO' })])
      expect(result.total).toBe(10.13)
    })
  })

  describe('a negative monto (review finding G — DEFECT, reported not fixed)', () => {
    // The backend rejects `monto <= 0` (`Field(gt=0)`, venta.py) — a
    // negative amount cannot reach this function through the real API.
    // But `toCentavos` performs NO sign check, purely as defense in depth
    // this is a real gap: a negative monto is `Number.isFinite`, so it
    // sails through the fallback's guard and gets SUBTRACTED from the
    // day's total instead of being rejected or excluded. That is a
    // discovered defect in this "load-bearing" boundary, not just a
    // coverage gap — pinned here as CURRENT behaviour per the review's
    // explicit instruction not to silently change RN-VTA-05's semantics.
    // Flagged in the review-fixes report; a real fix (clamp/reject
    // negative amounts) needs an explicit decision, not a silent patch.
    it('currently SUBTRACTS a negative monto from the total instead of rejecting it', () => {
      const ventas = [
        venta({ id: 'v-1', monto: '100.00', forma_pago: 'EFECTIVO' }),
        venta({ id: 'v-2', monto: '-30.00', forma_pago: 'EFECTIVO' }),
      ]
      const result = calcularTotalesDelDia(ventas)
      expect(result.total).toBe(70)
      expect(result.porFormaPago.EFECTIVO).toBe(70)
    })

    it('a wholly negative day yields a negative total (triangulation)', () => {
      const result = calcularTotalesDelDia([venta({ monto: '-15.50', forma_pago: 'OTRO' })])
      expect(result.total).toBe(-15.5)
      expect(result.porFormaPago.OTRO).toBe(-15.5)
    })
  })
})
