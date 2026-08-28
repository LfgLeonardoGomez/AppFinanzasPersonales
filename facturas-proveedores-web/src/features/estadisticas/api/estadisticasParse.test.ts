/**
 * Boundary-parse tests for the estadísticas wire shape (C-38 task 4.0).
 *
 * The backend sends every amount as a Pydantic-v2 Decimal STRING. These
 * functions are the single place where that becomes a `number`, mirroring
 * `parseCuentaCorriente` (C-13 D13).
 *
 * The `throw` on a malformed decimal is the point of these tests, not an
 * edge case: on a statistics screen a fabricated `0` is indistinguishable
 * from a legitimate period with no movement, which is a value these views
 * show constantly. A parse that degrades to `0` would render a broken
 * number as a true one, and nobody would ever notice.
 */
import { describe, it, expect } from 'vitest'
import { parseCompras, parseVentas, parseResumen } from './estadisticasParse'

describe('parseCompras', () => {
  it('turns the wire Decimal-strings into numbers', () => {
    const parsed = parseCompras({
      desde: '2026-01-01',
      hasta: '2026-03-31',
      granularidad: 'mes',
      proveedor_id: null,
      periodos: [
        { periodo: '2026-01-01', desde: '2026-01-01', hasta: '2026-01-31', total: '1234.50' },
        { periodo: '2026-02-01', desde: '2026-02-01', hasta: '2026-02-28', total: '0.00' },
      ],
    })

    expect(parsed.periodos[0]!.total).toBe(1234.5)
    expect(parsed.periodos[1]!.total).toBe(0)
  })

  it('keeps every period the backend sent, zeros included', () => {
    const parsed = parseCompras({
      desde: '2026-01-01',
      hasta: '2026-03-31',
      granularidad: 'mes',
      proveedor_id: null,
      periodos: [
        { periodo: '2026-01-01', desde: '2026-01-01', hasta: '2026-01-31', total: '900.00' },
        { periodo: '2026-02-01', desde: '2026-02-01', hasta: '2026-02-28', total: '0.00' },
        { periodo: '2026-03-01', desde: '2026-03-01', hasta: '2026-03-31', total: '150.00' },
      ],
    })

    expect(parsed.periodos).toHaveLength(3)
    expect(parsed.periodos.map((p) => p.periodo)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ])
  })

  it('echoes the proveedor_id back when the call was scoped to one supplier', () => {
    const parsed = parseCompras({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      granularidad: 'dia',
      proveedor_id: 'ac1b0f2e-0000-4000-8000-000000000001',
      periodos: [],
    })

    expect(parsed.proveedor_id).toBe('ac1b0f2e-0000-4000-8000-000000000001')
  })

  it('THROWS on a malformed decimal instead of degrading it to zero', () => {
    expect(() =>
      parseCompras({
        desde: '2026-01-01',
        hasta: '2026-01-31',
        granularidad: 'mes',
        proveedor_id: null,
        periodos: [
          { periodo: '2026-01-01', desde: '2026-01-01', hasta: '2026-01-31', total: 'no-way' },
        ],
      }),
    ).toThrow(/malformed Decimal/i)
  })
})

describe('parseVentas', () => {
  it('parses the total and every amount in the desglose', () => {
    const parsed = parseVentas({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      granularidad: 'mes',
      periodos: [
        {
          periodo: '2026-01-01',
          desde: '2026-01-01',
          hasta: '2026-01-31',
          total: '1000.00',
          desglose: {
            EFECTIVO: '600.00',
            TRANSFERENCIA: '400.00',
            TARJETA: '0.00',
            CUENTA_CORRIENTE: '0.00',
            OTRO: '0.00',
          },
        },
      ],
    })

    const periodo = parsed.periodos[0]!
    expect(periodo.total).toBe(1000)
    expect(periodo.desglose.EFECTIVO).toBe(600)
    expect(periodo.desglose.TRANSFERENCIA).toBe(400)
    expect(periodo.desglose.TARJETA).toBe(0)
  })

  it('preserves every FormaPago key, including the ones at zero', () => {
    const parsed = parseVentas({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      granularidad: 'mes',
      periodos: [
        {
          periodo: '2026-01-01',
          desde: '2026-01-01',
          hasta: '2026-01-31',
          total: '50.00',
          desglose: {
            EFECTIVO: '50.00',
            TRANSFERENCIA: '0.00',
            TARJETA: '0.00',
            CUENTA_CORRIENTE: '0.00',
            OTRO: '0.00',
          },
        },
      ],
    })

    expect(Object.keys(parsed.periodos[0]!.desglose).sort()).toEqual([
      'CUENTA_CORRIENTE',
      'EFECTIVO',
      'OTRO',
      'TARJETA',
      'TRANSFERENCIA',
    ])
  })

  it('does NOT recompute the total from the desglose — it uses what the backend sent', () => {
    // A deliberately inconsistent payload: if the parser summed the desglose
    // to produce the total, this would come back as 999 instead of 1000.
    // The backend guarantees sum(desglose) === total by construction; the
    // frontend's job is to display, never to re-derive.
    const parsed = parseVentas({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      granularidad: 'mes',
      periodos: [
        {
          periodo: '2026-01-01',
          desde: '2026-01-01',
          hasta: '2026-01-31',
          total: '1000.00',
          desglose: {
            EFECTIVO: '999.00',
            TRANSFERENCIA: '0.00',
            TARJETA: '0.00',
            CUENTA_CORRIENTE: '0.00',
            OTRO: '0.00',
          },
        },
      ],
    })

    expect(parsed.periodos[0]!.total).toBe(1000)
  })

  it('THROWS on a malformed decimal inside the desglose', () => {
    expect(() =>
      parseVentas({
        desde: '2026-01-01',
        hasta: '2026-01-31',
        granularidad: 'mes',
        periodos: [
          {
            periodo: '2026-01-01',
            desde: '2026-01-01',
            hasta: '2026-01-31',
            total: '10.00',
            desglose: {
              EFECTIVO: '',
              TRANSFERENCIA: '0.00',
              TARJETA: '0.00',
              CUENTA_CORRIENTE: '0.00',
              OTRO: '0.00',
            },
          },
        ],
      }),
    ).toThrow(/malformed Decimal/i)
  })
})

describe('parseResumen', () => {
  it('parses compras, ventas and diferencia', () => {
    const parsed = parseResumen({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      compras: '800.00',
      ventas: '1250.75',
      diferencia: '450.75',
    })

    expect(parsed).toEqual({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      compras: 800,
      ventas: 1250.75,
      diferencia: 450.75,
    })
  })

  it('keeps a negative diferencia negative', () => {
    const parsed = parseResumen({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      compras: '2000.00',
      ventas: '1200.00',
      diferencia: '-800.00',
    })

    expect(parsed.diferencia).toBe(-800)
  })

  it('THROWS on a malformed decimal', () => {
    expect(() =>
      parseResumen({
        desde: '2026-01-01',
        hasta: '2026-01-31',
        compras: '800.00',
        ventas: 'thirteen',
        diferencia: '0.00',
      }),
    ).toThrow(/malformed Decimal/i)
  })
})
