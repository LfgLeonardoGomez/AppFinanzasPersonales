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

describe('parseCuentaCorriente — historial carries archivo_url', () => {
  /**
   * `parseEntradaHistorial` rebuilds each row field by field, so it is an
   * explicit whitelist: a field the backend sends but the parser does not
   * copy is dropped silently, with no type error and no failing test
   * anywhere else. That is exactly how archivo_url went missing — the
   * backend returned it, the component read it, and the boundary in between
   * threw it away, so the "Ver archivo" button never rendered for pagos.
   */
  function rawWithHistorial(historial: unknown[]) {
    return {
      proveedor_id: 'p-1',
      saldo: '0.00',
      facturas_con_estado: [],
      historial,
    }
  }

  it('keeps archivo_url on a PAGO row', () => {
    const out = parseCuentaCorriente(
      rawWithHistorial([
        {
          id: 'pg-1',
          tipo: 'PAGO',
          fecha: '2026-07-18',
          monto: '15000.00',
          saldo_acumulado: '100.00',
          archivo_url: 'https://res.cloudinary.com/demo/comprobantes/x.jpg',
        },
      ]) as never,
    )

    expect(out.historial[0]?.archivo_url).toBe(
      'https://res.cloudinary.com/demo/comprobantes/x.jpg',
    )
  })

  it('keeps archivo_url on a FACTURA row', () => {
    const out = parseCuentaCorriente(
      rawWithHistorial([
        {
          id: 'f-1',
          tipo: 'FACTURA',
          fecha: '2026-07-10',
          monto: '500.00',
          saldo_acumulado: '500.00',
          archivo_url: 'https://res.cloudinary.com/demo/facturas/y.pdf',
        },
      ]) as never,
    )

    expect(out.historial[0]?.archivo_url).toBe(
      'https://res.cloudinary.com/demo/facturas/y.pdf',
    )
  })

  it('normalises a missing or null archivo_url to null, never undefined', () => {
    const out = parseCuentaCorriente(
      rawWithHistorial([
        {
          id: 'pg-2',
          tipo: 'PAGO',
          fecha: '2026-07-09',
          monto: '105000.00',
          saldo_acumulado: '0.00',
          archivo_url: null,
        },
        // Older rows may predate the field entirely.
        {
          id: 'pg-3',
          tipo: 'PAGO',
          fecha: '2026-07-09',
          monto: '1.00',
          saldo_acumulado: '0.00',
        },
      ]) as never,
    )

    expect(out.historial[0]?.archivo_url).toBeNull()
    expect(out.historial[1]?.archivo_url).toBeNull()
  })
})

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
