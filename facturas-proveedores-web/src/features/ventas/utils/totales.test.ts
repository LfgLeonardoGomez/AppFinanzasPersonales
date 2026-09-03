/**
 * Tests for calcularTotalesDelDia — pure aggregation helper (C-34, task 7.6/7.8).
 *
 * Spec scenario ("the total is the sum of the day's sales" / "the breakdown
 * separates the fiado from the money that came in"): a day holding $1.000 in
 * cash, $2.500 by card and $500 on account totals $4.000, broken down per
 * `forma_pago`.
 *
 * C-41 (design.md D3): `VentaListItem.monto` is now `number`, converted by
 * `parseVentaListItem` (`ventasApi.ts`) at the API client's boundary — this
 * function receives already-validated numbers, never Decimal strings. The
 * float-drift triangulation below still applies: `calcularTotalesDelDia`
 * sums in integer cents regardless of the input's origin.
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
    monto: 100,
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
      venta({ id: 'v-1', monto: 1000, forma_pago: 'EFECTIVO' }),
      venta({ id: 'v-2', monto: 2500, forma_pago: 'TARJETA' }),
      venta({ id: 'v-3', monto: 500, forma_pago: 'CUENTA_CORRIENTE' }),
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
      venta({ id: 'v-1', monto: 300, forma_pago: 'TRANSFERENCIA' }),
      venta({ id: 'v-2', monto: 150.5, forma_pago: 'TRANSFERENCIA' }),
    ]
    const result = calcularTotalesDelDia(ventas)
    expect(result.total).toBe(450.5)
    expect(result.porFormaPago).toEqual({ TRANSFERENCIA: 450.5 })
  })

  it('never drifts on sums that break naive float addition (triangulation)', () => {
    // 0.10 + 0.20 === 0.30000000000000004 as raw floats — this must not leak.
    const ventas = [
      venta({ id: 'v-1', monto: 0.1, forma_pago: 'OTRO' }),
      venta({ id: 'v-2', monto: 0.2, forma_pago: 'OTRO' }),
    ]
    const result = calcularTotalesDelDia(ventas)
    expect(result.total).toBe(0.3)
    expect(result.porFormaPago.OTRO).toBe(0.3)
  })

  // ── toCentavos fallback coverage (review finding G, revisited by C-41) ────
  //
  // `toCentavos` used to be the entire implementation of RN-VTA-05's
  // decimal-validity guard. C-41 moved the primary guard to the API
  // boundary (`parseVentaListItem` THROWS on a malformed Decimal — see
  // `ventasApi.test.ts`'s "malformed decimal throws" suite): a non-numeric
  // or empty `monto` can no longer reach this function through the real
  // API, because the type is `number`, not `string`. What remains here is
  // defense in depth against a `NaN` that reaches this function some other
  // way (`number` does not exclude `NaN` at the type level) — pinned below,
  // not removed.

  describe('a NaN monto contributes 0, silently (defense in depth — the primary guard is now parseVentaListItem)', () => {
    it('treats NaN as 0 without throwing', () => {
      const ventas = [
        venta({ id: 'v-1', monto: 100, forma_pago: 'EFECTIVO' }),
        venta({ id: 'v-2', monto: NaN, forma_pago: 'EFECTIVO' }),
      ]
      const result = calcularTotalesDelDia(ventas)
      expect(result.total).toBe(100)
      expect(result.porFormaPago.EFECTIVO).toBe(100)
    })
  })

  describe('a monto with more than 2 decimal places rounds to the nearest cent', () => {
    it('rounds 10.005 up to $10.01 (float representation puts it just above the half-cent)', () => {
      const result = calcularTotalesDelDia([venta({ monto: 10.005, forma_pago: 'EFECTIVO' })])
      expect(result.total).toBe(10.01)
    })

    it('rounds 10.126 up to $10.13 (triangulation, three decimals)', () => {
      const result = calcularTotalesDelDia([venta({ monto: 10.126, forma_pago: 'EFECTIVO' })])
      expect(result.total).toBe(10.13)
    })
  })

  describe('a negative monto is rejected, never subtracted (review finding G — decided)', () => {
    // The backend rejects `monto <= 0` (`Field(gt=0)`, venta.py) — a
    // negative amount cannot reach this function through the real API.
    // The decision: treat a negative `monto` exactly like the NaN fallback
    // above — contribute 0 cents, never reduce a total. Silently
    // subtracting would misstate the day's cash for what is, by contract,
    // corrupted data.
    it('a negative monto contributes 0 and does not reduce the total', () => {
      const result = calcularTotalesDelDia([venta({ monto: -15.5, forma_pago: 'OTRO' })])
      expect(result.total).toBe(0)
      expect(result.porFormaPago.OTRO).toBe(0)
    })

    it('a negative monto mixed with valid sales leaves their sum intact (triangulation)', () => {
      const ventas = [
        venta({ id: 'v-1', monto: 100, forma_pago: 'EFECTIVO' }),
        venta({ id: 'v-2', monto: -30, forma_pago: 'EFECTIVO' }),
      ]
      const result = calcularTotalesDelDia(ventas)
      expect(result.total).toBe(100)
      expect(result.porFormaPago.EFECTIVO).toBe(100)
    })
  })
})
