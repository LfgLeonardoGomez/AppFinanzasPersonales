/**
 * Tests for the pure `cargaModalReducer` behind `CargaModal` — the
 * unified carga modal (factura+pago, IA+manual in one flow).
 *
 * TDD: written RED (referencing the not-yet-existing reducer shape),
 * then GREEN against `cargaModalReducer.ts`, then triangulated across
 * both tipos and both origins.
 */
import { describe, it, expect } from 'vitest'
import {
  cargaModalReducer,
  initialCargaModalState,
  emptyPropuesta,
  type CargaModalState,
} from './cargaModalReducer'

describe('cargaModalReducer — initial state', () => {
  it('starts in the origen step with the given tipo, origen=imagen, no error', () => {
    expect(initialCargaModalState('factura')).toEqual({
      step: 'origen',
      tipo: 'factura',
      origen: 'imagen',
      error: null,
    })
    expect(initialCargaModalState('pago')).toEqual({
      step: 'origen',
      tipo: 'pago',
      origen: 'imagen',
      error: null,
    })
  })
})

describe('cargaModalReducer — origen toggles', () => {
  it('SET_TIPO switches tipo and clears any error while staying in origen', () => {
    const start: CargaModalState = {
      step: 'origen',
      tipo: 'factura',
      origen: 'manual',
      error: { kind: 'generic', message: 'x' },
    }
    const next = cargaModalReducer(start, { kind: 'SET_TIPO', tipo: 'pago' })
    expect(next).toEqual({ step: 'origen', tipo: 'pago', origen: 'manual', error: null })
  })

  it('SET_ORIGEN switches origen and clears any error while staying in origen', () => {
    const start = initialCargaModalState('factura')
    const next = cargaModalReducer(start, { kind: 'SET_ORIGEN', origen: 'manual' })
    expect(next).toEqual({ step: 'origen', tipo: 'factura', origen: 'manual', error: null })
  })

  it('toggles are no-ops outside the origen step', () => {
    const processing: CargaModalState = { step: 'processing', tipo: 'factura' }
    expect(cargaModalReducer(processing, { kind: 'SET_TIPO', tipo: 'pago' })).toBe(processing)
    expect(cargaModalReducer(processing, { kind: 'SET_ORIGEN', origen: 'manual' })).toBe(processing)
  })
})

describe('cargaModalReducer — imagen path (origen → processing → review)', () => {
  it('START_EXTRACTION moves to processing only when origen is imagen', () => {
    const start = initialCargaModalState('factura')
    const next = cargaModalReducer(start, { kind: 'START_EXTRACTION' })
    expect(next).toEqual({ step: 'processing', tipo: 'factura' })
  })

  it('START_EXTRACTION is a no-op when origen is manual', () => {
    const start: CargaModalState = { step: 'origen', tipo: 'factura', origen: 'manual', error: null }
    expect(cargaModalReducer(start, { kind: 'START_EXTRACTION' })).toBe(start)
  })

  it('EXTRACT_SUCCESS moves processing → review with origen=imagen and the propuesta', () => {
    const start: CargaModalState = { step: 'processing', tipo: 'pago' }
    const propuesta = emptyPropuesta('pago')
    const next = cargaModalReducer(start, { kind: 'EXTRACT_SUCCESS', propuesta })
    expect(next).toEqual({ step: 'review', tipo: 'pago', origen: 'imagen', propuesta })
  })

  it('EXTRACT_ERROR moves processing back to origen with the error set', () => {
    const start: CargaModalState = { step: 'processing', tipo: 'factura' }
    const error = { kind: 'rate_limit' as const, message: 'Too many', retryAfterSeconds: 600 }
    const next = cargaModalReducer(start, { kind: 'EXTRACT_ERROR', error })
    expect(next).toEqual({ step: 'origen', tipo: 'factura', origen: 'imagen', error })
  })
})

describe('cargaModalReducer — manual path (origen → review, skips processing)', () => {
  it('MANUAL_CONTINUE moves origen(manual) → review with origen=manual and the empty propuesta', () => {
    const start: CargaModalState = { step: 'origen', tipo: 'factura', origen: 'manual', error: null }
    const propuesta = emptyPropuesta('factura')
    const next = cargaModalReducer(start, { kind: 'MANUAL_CONTINUE', propuesta })
    expect(next).toEqual({ step: 'review', tipo: 'factura', origen: 'manual', propuesta })
  })

  it('MANUAL_CONTINUE is a no-op when origen is imagen', () => {
    const start = initialCargaModalState('pago')
    expect(cargaModalReducer(start, { kind: 'MANUAL_CONTINUE', propuesta: emptyPropuesta('pago') })).toBe(start)
  })
})

describe('cargaModalReducer — BACK and CONFIRM_SUCCESS', () => {
  it('BACK returns review → origen, preserving tipo and origen, clearing error', () => {
    const start: CargaModalState = {
      step: 'review',
      tipo: 'pago',
      origen: 'manual',
      propuesta: emptyPropuesta('pago'),
    }
    const next = cargaModalReducer(start, { kind: 'BACK' })
    expect(next).toEqual({ step: 'origen', tipo: 'pago', origen: 'manual', error: null })
  })

  it('CONFIRM_SUCCESS moves review → success', () => {
    const start: CargaModalState = {
      step: 'review',
      tipo: 'factura',
      origen: 'imagen',
      propuesta: emptyPropuesta('factura'),
    }
    const next = cargaModalReducer(start, { kind: 'CONFIRM_SUCCESS' })
    expect(next).toEqual({ step: 'success', tipo: 'factura' })
  })

  it('BACK and CONFIRM_SUCCESS are no-ops outside review', () => {
    const origen = initialCargaModalState('factura')
    expect(cargaModalReducer(origen, { kind: 'BACK' })).toBe(origen)
    expect(cargaModalReducer(origen, { kind: 'CONFIRM_SUCCESS' })).toBe(origen)
  })
})

describe('cargaModalReducer — RESET', () => {
  it('RESET always returns to origen/imagen for the given tipo, from any step', () => {
    const success: CargaModalState = { step: 'success', tipo: 'pago' }
    expect(cargaModalReducer(success, { kind: 'RESET', tipo: 'factura' })).toEqual({
      step: 'origen',
      tipo: 'factura',
      origen: 'imagen',
      error: null,
    })
  })
})

describe('emptyPropuesta', () => {
  it('builds an all-null PropuestaFactura for tipo factura', () => {
    expect(emptyPropuesta('factura')).toEqual({
      proveedor_nombre: null,
      numero: null,
      fecha_emision: null,
      monto_total: null,
      error: false,
      error_message: null,
    })
  })

  it('builds an all-null PropuestaPago for tipo pago', () => {
    expect(emptyPropuesta('pago')).toEqual({
      proveedor_nombre: null,
      monto: null,
      fecha: null,
      metodo: null,
      error: false,
      error_message: null,
    })
  })
})

describe('cargaModalReducer — exhaustive `never` check', () => {
  it('every action is handled from a representative state', () => {
    const start: CargaModalState = { step: 'origen', tipo: 'factura', origen: 'imagen', error: null }
    const allActions = [
      { kind: 'SET_TIPO', tipo: 'pago' },
      { kind: 'SET_ORIGEN', origen: 'manual' },
      { kind: 'START_EXTRACTION' },
      { kind: 'EXTRACT_SUCCESS', propuesta: emptyPropuesta('factura') },
      { kind: 'EXTRACT_ERROR', error: { kind: 'generic', message: 'x' } },
      { kind: 'MANUAL_CONTINUE', propuesta: emptyPropuesta('factura') },
      { kind: 'BACK' },
      { kind: 'CONFIRM_SUCCESS' },
      { kind: 'RESET', tipo: 'factura' },
    ] as const
    for (const action of allActions) {
      const next = cargaModalReducer(start, action)
      expect(next).toBeDefined()
      expect(typeof next.step).toBe('string')
    }
  })
})
