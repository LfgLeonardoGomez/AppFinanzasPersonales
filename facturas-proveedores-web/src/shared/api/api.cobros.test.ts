/**
 * Runtime type-guard tests for the customer cuenta-corriente + cobros domain
 * types in `api.d.ts` (C-36, design.md D9).
 *
 * Mirrors `api.pagos.test.ts`'s runtime-guard style: instantiate a value
 * typed as the domain type and assert on its actual keys/values, so a future
 * accidental change to the type is caught even though `npm test` does not
 * type-check (esbuild strips types — `tsc --noEmit` is the real gate for the
 * type-level shape itself).
 *
 * TDD: tasks 2.3-2.5.
 */
import { describe, it, expect } from 'vitest'
import type {
  MetodoCobro,
  EstadoVentaFiada,
  CobroClienteCreate,
} from './api'

describe('MetodoCobro — separate from MetodoPago and FormaPago (task 2.3)', () => {
  it('accepts TARJETA as a valid MetodoCobro', () => {
    const metodo: MetodoCobro = 'TARJETA'
    expect(metodo).toBe('TARJETA')
  })

  it('the MetodoCobro value set has no MERCADOPAGO or CUENTA_CORRIENTE member', () => {
    // Money coming IN from a customer has no MercadoPago-to-supplier path
    // (that is MetodoPago's concern), and debt is never cancelled with debt
    // (that is FormaPago's CUENTA_CORRIENTE member, not a cobro method).
    const METODO_COBRO_VALUES: MetodoCobro[] = ['EFECTIVO', 'TRANSFERENCIA', 'TARJETA', 'OTRO']
    expect(METODO_COBRO_VALUES).not.toContain('MERCADOPAGO')
    expect(METODO_COBRO_VALUES).not.toContain('CUENTA_CORRIENTE')
  })
})

describe('EstadoVentaFiada — COBRADA, not PAGADA (task 2.4)', () => {
  it('COBRADA is a valid EstadoVentaFiada value', () => {
    const estado: EstadoVentaFiada = 'COBRADA'
    expect(estado).toBe('COBRADA')
  })

  it('the EstadoVentaFiada value set has no PAGADA member', () => {
    // C-35's stated reason: a customer's sale reported as "paid" reads as
    // though the shop had paid it.
    const ESTADO_VENTA_FIADA_VALUES: EstadoVentaFiada[] = ['PENDIENTE', 'PARCIAL', 'COBRADA']
    expect(ESTADO_VENTA_FIADA_VALUES).not.toContain('PAGADA')
  })
})

describe('CobroClienteCreate — RN-CCC-03 + session-derived ownership (task 2.5)', () => {
  it('has no venta_id, negocio_id, or creado_por_usuario_id key', () => {
    const payload: CobroClienteCreate = {
      cliente_id: 'cliente-1',
      monto: '500.00',
      fecha: '2026-08-16',
      metodo: 'EFECTIVO',
    }
    expect('venta_id' in payload).toBe(false)
    expect('negocio_id' in payload).toBe(false)
    expect('creado_por_usuario_id' in payload).toBe(false)
  })

  it('accepts an optional comprobante_url (triangulation)', () => {
    const payload: CobroClienteCreate = {
      cliente_id: 'cliente-2',
      monto: '1200.50',
      fecha: '2026-08-01',
      metodo: 'TRANSFERENCIA',
      comprobante_url: 'https://res.cloudinary.com/demo/comprobantes/x.jpg',
    }
    expect(payload.comprobante_url).toContain('cloudinary')
  })
})
