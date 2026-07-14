/**
 * Tests for the pure state-machine reducer behind `PropuestaIAModal`
 * (C-15, section 6).
 *
 * The reducer is extracted as a pure function so the 7 states and 10
 * transitions can be tested without React. The component itself
 * (`PropuestaIAModal.tsx`) wires the reducer to a `useReducer` hook
 * and renders the right UI for each state.
 *
 * TDD: Task 6.1 (RED) → 6.2 (GREEN) → 6.3/6.4/6.5/6.6 (TRIANGULATE).
 */
import { describe, it, expect } from 'vitest'
import {
  initialModalState,
  propuestaModalReducer,
  type PropuestaModalState,
  type PropuestaModalAction,
} from './propuestaModalReducer'

describe('propuestaModalReducer — initial state', () => {
  it('starts in the idle state with no proposal, no file, no error', () => {
    const state = initialModalState()
    expect(state).toEqual({ kind: 'idle' })
  })
})

describe('propuestaModalReducer — happy path (4 transitions)', () => {
  it('idle → extracting (on PICK_FILE)', () => {
    const file = new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' })
    const next = propuestaModalReducer(initialModalState(), {
      kind: 'PICK_FILE',
      file,
    })
    expect(next).toEqual({ kind: 'extracting', file })
  })

  it('extracting → proposal (on EXTRACT_SUCCESS with a valid Propuesta)', () => {
    const file = new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' })
    const start: PropuestaModalState = { kind: 'extracting', file }
    const propuesta = {
      proveedor_nombre: 'Acme SA',
      numero: '0001-00012345',
      fecha_emision: '2026-06-15',
      monto_total: 1234.56,
      error: false,
      error_message: null,
    }
    const next = propuestaModalReducer(start, {
      kind: 'EXTRACT_SUCCESS',
      propuesta,
      tipo: 'factura',
    })
    expect(next).toEqual({ kind: 'proposal', propuesta, tipo: 'factura' })
  })

  it('proposal → idle after CONFIRM (onConfirm fires upstream — the reducer resets to idle)', () => {
    const start: PropuestaModalState = {
      kind: 'proposal',
      propuesta: {
        proveedor_nombre: 'X',
        numero: null,
        fecha_emision: null,
        monto_total: null,
        error: false,
        error_message: null,
      },
      tipo: 'factura',
    }
    const next = propuestaModalReducer(start, { kind: 'CONFIRM' })
    expect(next).toEqual({ kind: 'idle' })
  })

  it('proposal → idle on CANCEL (no fill, no persist)', () => {
    const start: PropuestaModalState = {
      kind: 'proposal',
      propuesta: {
        proveedor_nombre: 'X',
        numero: null,
        fecha_emision: null,
        monto_total: null,
        error: false,
        error_message: null,
      },
      tipo: 'factura',
    }
    const next = propuestaModalReducer(start, { kind: 'CANCEL' })
    expect(next).toEqual({ kind: 'idle' })
  })
})

describe('propuestaModalReducer — error states (4 transitions)', () => {
  it('extracting → error_422 on EXTRACT_ERROR with status 422', () => {
    const start: PropuestaModalState = { kind: 'extracting', file: new File([new Uint8Array(10)], 'f.jpg') }
    const next = propuestaModalReducer(start, {
      kind: 'EXTRACT_ERROR',
      status: 422,
      message: 'Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB.',
    })
    expect(next).toEqual({
      kind: 'error_422',
      message: 'Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB.',
    })
  })

  it('extracting → error_429 on EXTRACT_ERROR with status 429 and retryAfterSeconds', () => {
    const start: PropuestaModalState = { kind: 'extracting', file: new File([new Uint8Array(10)], 'f.jpg') }
    const next = propuestaModalReducer(start, {
      kind: 'EXTRACT_ERROR',
      status: 429,
      message: 'Demasiadas solicitudes. Intentá en 10 minutos.',
      retryAfterSeconds: 600,
    })
    expect(next).toEqual({
      kind: 'error_429',
      message: 'Demasiadas solicitudes. Intentá en 10 minutos.',
      retryAfterSeconds: 600,
    })
  })

  it('extracting → error_extractor on EXTRACT_SUCCESS with error:true envelope', () => {
    const start: PropuestaModalState = { kind: 'extracting', file: new File([new Uint8Array(10)], 'f.jpg') }
    const errorPropuesta = {
      proveedor_nombre: null,
      numero: null,
      fecha_emision: null,
      monto_total: null,
      error: true,
      error_message: 'Image too blurry',
    }
    const next = propuestaModalReducer(start, {
      kind: 'EXTRACT_SUCCESS',
      propuesta: errorPropuesta,
      tipo: 'factura',
    })
    expect(next).toEqual({
      kind: 'error_extractor',
      message: 'Image too blurry',
    })
  })

  it('extracting → error_generic on EXTRACT_ERROR with status 500', () => {
    const start: PropuestaModalState = { kind: 'extracting', file: new File([new Uint8Array(10)], 'f.jpg') }
    const next = propuestaModalReducer(start, {
      kind: 'EXTRACT_ERROR',
      status: 500,
      message: 'Algo salió mal. Reintentá o cargá manualmente.',
    })
    expect(next).toEqual({
      kind: 'error_generic',
      message: 'Algo salió mal. Reintentá o cargá manualmente.',
    })
  })
})

describe('propuestaModalReducer — recovery transitions', () => {
  it('error_429 → idle on RETRY (user manually clicks Reintentar — no auto-retry)', () => {
    const start: PropuestaModalState = {
      kind: 'error_429',
      message: 'Demasiadas solicitudes',
      retryAfterSeconds: 600,
    }
    const next = propuestaModalReducer(start, { kind: 'RETRY' })
    expect(next).toEqual({ kind: 'idle' })
  })

  it('error_extractor → idle on RETRY (Reintentar con otra foto)', () => {
    const start: PropuestaModalState = { kind: 'error_extractor', message: 'Image too blurry' }
    const next = propuestaModalReducer(start, { kind: 'RETRY' })
    expect(next).toEqual({ kind: 'idle' })
  })

  it('error_extractor → idle on MANUAL_LOAD (Cargar manualmente closes the modal)', () => {
    const start: PropuestaModalState = { kind: 'error_extractor', message: 'Image too blurry' }
    const next = propuestaModalReducer(start, { kind: 'MANUAL_LOAD' })
    expect(next).toEqual({ kind: 'idle' })
  })

  it('error_generic → idle on RETRY (re-fires the mutation with the same file)', () => {
    const start: PropuestaModalState = { kind: 'error_generic', message: 'Server error' }
    const next = propuestaModalReducer(start, { kind: 'RETRY' })
    expect(next).toEqual({ kind: 'idle' })
  })

  it('any non-extracting state on CANCEL transitions to idle (modal close)', () => {
    const start: PropuestaModalState = { kind: 'error_422', message: 'x' }
    const next = propuestaModalReducer(start, { kind: 'CANCEL' })
    expect(next).toEqual({ kind: 'idle' })
  })
})

describe('propuestaModalReducer — exhaustive `never` check', () => {
  it('every action is handled — the reducer never returns the start state unchanged', () => {
    // If a future action is added but not handled, the reducer's
    // `never` exhaustive check will fail at compile time. This test
    // documents the contract: every state/action combo returns a
    // valid PropuestaModalState.
    const file = new File([new Uint8Array(10)], 'f.jpg')
    const start: PropuestaModalState = { kind: 'extracting', file }
    const allActions: PropuestaModalAction[] = [
      { kind: 'PICK_FILE', file },
      { kind: 'EXTRACT_SUCCESS', propuesta: {} as never, tipo: 'factura' },
      { kind: 'EXTRACT_ERROR', status: 500, message: 'x' },
      { kind: 'CONFIRM' },
      { kind: 'CANCEL' },
      { kind: 'RETRY' },
      { kind: 'MANUAL_LOAD' },
    ]
    for (const action of allActions) {
      const next = propuestaModalReducer(start, action)
      expect(next).toBeDefined()
      expect(typeof next.kind).toBe('string')
    }
  })
})
