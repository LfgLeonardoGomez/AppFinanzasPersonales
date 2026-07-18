/**
 * Tests for the pure `buildCreatePayload` helper (C-21, task 2.3).
 *
 * Builds the `FacturaCreate` / `PagoCreate` payload sent by the modal's
 * terminal confirm, from an edited proposal + the selected supplier's id
 * + the uploaded comprobante URL. Pure — no API calls, no React.
 */
import { describe, it, expect } from 'vitest'
import type { PropuestaFactura, PropuestaPago } from '@shared/api/api'
import { buildCreatePayload } from './buildCreatePayload'

const propuestaFactura: PropuestaFactura = {
  proveedor_nombre: 'Acme SA',
  numero: '0001-1234',
  fecha_emision: '2026-06-15',
  monto_total: 1234.56,
  error: false,
  error_message: null,
}

const propuestaPago: PropuestaPago = {
  proveedor_nombre: 'Acme SA',
  monto: 5000,
  fecha: '2026-06-20',
  metodo: 'TRANSFERENCIA',
  error: false,
  error_message: null,
}

describe('buildCreatePayload — factura', () => {
  it('builds a FacturaCreate payload with origen IA and the uploaded url', () => {
    const payload = buildCreatePayload('factura', propuestaFactura, 'prov-1', 'https://cdn/f.jpg')
    expect(payload).toEqual({
      proveedor_id: 'prov-1',
      fecha_emision: '2026-06-15',
      monto_total: 1234.56,
      numero: '0001-1234',
      archivo_url: 'https://cdn/f.jpg',
      origen: 'IA',
    })
  })

  it('omits numero when it is null (only non-null fields are sent)', () => {
    const payload = buildCreatePayload(
      'factura',
      { ...propuestaFactura, numero: null },
      'prov-1',
      'https://cdn/f.jpg',
    )
    expect(payload).not.toHaveProperty('numero')
    expect(payload).toEqual({
      proveedor_id: 'prov-1',
      fecha_emision: '2026-06-15',
      monto_total: 1234.56,
      archivo_url: 'https://cdn/f.jpg',
      origen: 'IA',
    })
  })
})

describe('buildCreatePayload — pago', () => {
  it('builds a PagoCreate payload with origen IA, comprobante_url, and NO factura_id key (RN-PAG-01)', () => {
    const payload = buildCreatePayload('pago', propuestaPago, 'prov-1', 'https://cdn/p.jpg')
    expect(payload).toEqual({
      proveedor_id: 'prov-1',
      monto: 5000,
      fecha: '2026-06-20',
      metodo: 'TRANSFERENCIA',
      comprobante_url: 'https://cdn/p.jpg',
      origen: 'IA',
    })
    expect(payload).not.toHaveProperty('factura_id')
  })
})
