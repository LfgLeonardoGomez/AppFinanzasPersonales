/**
 * Boundary-value tests for the `parseCuentaCorriente` helper (C-13, task 3.4).
 *
 * The helper sits at the wire → public boundary: Pydantic-v2 serializes
 * Decimal as a JSON string. We verify round-trip for the boundary values
 * the project's `numeric(12,2)` column can produce (well within
 * `Number.MAX_SAFE_INTEGER`):
 *   - 0
 *   - 0.01, -0.01  (smallest magnitude)
 *   - 99999999.99, -99999999.99  (max magnitude per `numeric(12,2)`)
 *
 * And we assert the helper throws a typed `Error` on a malformed string
 * (defense in depth: a future contributor who breaks the parser sees a
 * loud test failure, not a silent `NaN` propagating into the UI).
 */
import { describe, it, expect } from 'vitest'
import { parseCuentaCorriente } from './cuentaCorrienteApi'
import type { CuentaCorrienteResponse } from '@shared/api/api'

function rawResponse(saldo: string, monto = '0.00', saldoAcumulado = '0.00') {
  return {
    proveedor_id: 'p-1',
    saldo,
    facturas_con_estado: [
      {
        id: 'f-1',
        usuario_id: 'u-1',
        proveedor_id: 'p-1',
        numero: null,
        fecha_emision: '2026-06-01',
        fecha_vencimiento: null,
        monto_total: monto,
        archivo_url: null,
        origen: 'MANUAL' as const,
        estado: 'PENDIENTE' as const,
        created_at: '2026-06-01T10:00:00',
        updated_at: '2026-06-01T10:00:00',
      },
    ],
    historial: [
      {
        id: 'f-1',
        tipo: 'FACTURA' as const,
        fecha: '2026-06-01',
        monto,
        saldo_acumulado: saldoAcumulado,
      },
    ],
  }
}

describe('parseCuentaCorriente — boundary values', () => {
  it('round-trip 0', () => {
    const out: CuentaCorrienteResponse = parseCuentaCorriente(rawResponse('0.00'))
    expect(out.saldo).toBe(0)
  })

  it('round-trip 0.01 (smallest positive magnitude)', () => {
    const out = parseCuentaCorriente(rawResponse('0.01', '0.01', '0.01'))
    expect(out.saldo).toBe(0.01)
    expect(out.facturas_con_estado[0]?.monto_total).toBe(0.01)
    expect(out.historial[0]?.saldo_acumulado).toBe(0.01)
  })

  it('round-trip -0.01 (smallest negative magnitude)', () => {
    const out = parseCuentaCorriente(rawResponse('-0.01', '-0.01', '-0.01'))
    expect(out.saldo).toBe(-0.01)
    expect(out.facturas_con_estado[0]?.monto_total).toBe(-0.01)
    expect(out.historial[0]?.saldo_acumulado).toBe(-0.01)
  })

  it('round-trip 99999999.99 (max magnitude per numeric(12,2))', () => {
    const out = parseCuentaCorriente(
      rawResponse('99999999.99', '99999999.99', '99999999.99'),
    )
    expect(out.saldo).toBe(99999999.99)
    expect(out.facturas_con_estado[0]?.monto_total).toBe(99999999.99)
    expect(out.historial[0]?.saldo_acumulado).toBe(99999999.99)
  })

  it('round-trip -99999999.99 (min magnitude per numeric(12,2))', () => {
    const out = parseCuentaCorriente(
      rawResponse('-99999999.99', '-99999999.99', '-99999999.99'),
    )
    expect(out.saldo).toBe(-99999999.99)
    expect(out.facturas_con_estado[0]?.monto_total).toBe(-99999999.99)
    expect(out.historial[0]?.saldo_acumulado).toBe(-99999999.99)
  })

  it('throws a typed Error on a malformed saldo (defense in depth)', () => {
    expect(() => parseCuentaCorriente(rawResponse('not-a-number'))).toThrow(
      /parseCuentaCorriente.*saldo/,
    )
  })

  it('throws a typed Error on a malformed monto_total', () => {
    expect(() =>
      parseCuentaCorriente(rawResponse('0.00', 'garbage')),
    ).toThrow(/parseCuentaCorriente.*monto_total/)
  })

  it('throws a typed Error on a malformed saldo_acumulado', () => {
    expect(() =>
      parseCuentaCorriente(rawResponse('0.00', '0.00', 'NaN-ish')),
    ).toThrow(/parseCuentaCorriente.*saldo_acumulado/)
  })
})
