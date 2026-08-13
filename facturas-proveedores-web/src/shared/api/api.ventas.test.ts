/**
 * Runtime + compile-time type-guard tests for the Venta domain types in
 * `api.d.ts` (C-34, tasks 2.2/2.3).
 *
 * Purpose: `FormaPago` (money coming IN — sales, C-33) must stay structurally
 * distinct from `MetodoPago` (money going OUT — supplier payments, C-10).
 * `MetodoPago` has no notion of credit (no `CUENTA_CORRIENTE`); `FormaPago`
 * has no `MERCADOPAGO`. Mixing them would make a supplier payment expressible
 * as "on account", which does not exist on that side of the ledger (design.md D4).
 *
 * Mirrors `api.pagos.test.ts`'s structural-guard style.
 */
import { describe, it, expect } from 'vitest'
import type { FormaPago, MetodoPago, VentaCreate } from './api'

describe('FormaPago — distinct from MetodoPago (C-34 D4)', () => {
  it('CUENTA_CORRIENTE is a valid FormaPago', () => {
    const forma: FormaPago = 'CUENTA_CORRIENTE'
    expect(forma).toBe('CUENTA_CORRIENTE')
  })

  it('CUENTA_CORRIENTE is NOT a valid MetodoPago (compile-time)', () => {
    type IsMetodoPago = 'CUENTA_CORRIENTE' extends MetodoPago ? true : false
    const isMetodoPago: IsMetodoPago = false
    expect(isMetodoPago).toBe(false)
  })

  it('MERCADOPAGO is NOT a valid FormaPago (compile-time)', () => {
    type IsFormaPago = 'MERCADOPAGO' extends FormaPago ? true : false
    const isFormaPago: IsFormaPago = false
    expect(isFormaPago).toBe(false)
  })
})

describe('VentaCreate — no negocio_id, no creado_por_usuario_id (session-derived)', () => {
  it('has no negocio_id key at runtime', () => {
    const payload: VentaCreate = {
      monto: '1500.00',
      fecha: '2026-08-13',
      forma_pago: 'EFECTIVO',
    }
    expect('negocio_id' in payload).toBe(false)
  })

  it('has no creado_por_usuario_id key at runtime (fiado variant)', () => {
    const payload: VentaCreate = {
      monto: '4500.00',
      fecha: '2026-08-13',
      forma_pago: 'CUENTA_CORRIENTE',
      cliente_id: 'cliente-1',
    }
    expect('creado_por_usuario_id' in payload).toBe(false)
  })

  it('the VentaCreate type does not allow a negocio_id key (compile-time)', () => {
    type HasNegocioId = 'negocio_id' extends keyof VentaCreate ? true : false
    const hasNegocioId: HasNegocioId = false
    expect(hasNegocioId).toBe(false)
  })

  it('the VentaCreate type does not allow a creado_por_usuario_id key (compile-time)', () => {
    type HasCreador = 'creado_por_usuario_id' extends keyof VentaCreate ? true : false
    const hasCreador: HasCreador = false
    expect(hasCreador).toBe(false)
  })
})
