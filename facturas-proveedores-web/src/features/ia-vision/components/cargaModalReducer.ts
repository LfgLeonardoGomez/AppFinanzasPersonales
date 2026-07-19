/**
 * Pure state-machine reducer for `CargaModal` — the unified carga
 * modal that converges factura/pago and IA/manual into ONE flow
 * (`specs/design/IA_EXPERIENCE.md`, `UX_PRINCIPLES.md` Regla 15).
 *
 * Extracted from the React component so the 4 steps and their
 * transitions can be unit-tested without React. `CargaModal.tsx` wires
 * this reducer to a `useReducer` hook and renders the right UI for each
 * step.
 *
 * STATE MACHINE (per the design handoff's `Carga IA.dc.html`):
 *
 *   ┌────────┐  SET_TIPO / SET_ORIGEN (toggles, stay in origen)
 *   │ origen │◄─────────────────────────────────────────────────┐
 *   └────────┘                                                   │
 *       │  START_EXTRACTION (origen='imagen')                    │
 *       ▼                                                        │
 *   ┌────────────┐  EXTRACT_ERROR                                │
 *   │ processing │───────────────────────────────────────────────┘
 *   └────────────┘
 *       │  EXTRACT_SUCCESS
 *       ▼
 *   ┌────────┐  MANUAL_CONTINUE (origen='manual', skips processing)
 *   │ review │◄──────────────────────────────── origen (BACK from review)
 *   └────────┘
 *       │  CONFIRM_SUCCESS
 *       ▼
 *   ┌─────────┐
 *   │ success │
 *   └─────────┘
 *
 * INVARIANT (RN-IA-04): the reducer has no side effects, no async
 * logic, no API calls. All persistence is the component's
 * responsibility (upload + create fire on confirm, outside this pure
 * function) — the reducer only transitions state.
 *
 * DESIGN NOTE: the picked `File` itself is NOT reducer state — it is
 * ephemeral component state (`CargaModal`'s `pickedFile`), the same way
 * the terminal-confirm upload works in the C-21 predecessor. Keeping it
 * out of the reducer keeps every state trivially comparable in tests
 * (no `File` object identity to juggle) and mirrors that only the
 * origen/processing/review/success shape is the actual state machine.
 */
import type { PropuestaFactura, PropuestaPago } from '@shared/api/api'

export type Tipo = 'factura' | 'pago'
export type Origen = 'imagen' | 'manual'

export type OrigenErrorKind = 'format' | 'rate_limit' | 'extractor' | 'generic'

export interface OrigenError {
  kind: OrigenErrorKind
  message: string
  retryAfterSeconds?: number
}

export type CargaModalState =
  | { step: 'origen'; tipo: Tipo; origen: Origen; error: OrigenError | null }
  | { step: 'processing'; tipo: Tipo }
  | {
      step: 'review'
      tipo: Tipo
      origen: Origen
      propuesta: PropuestaFactura | PropuestaPago
    }
  | { step: 'success'; tipo: Tipo }

export type CargaModalAction =
  | { kind: 'SET_TIPO'; tipo: Tipo }
  | { kind: 'SET_ORIGEN'; origen: Origen }
  | { kind: 'START_EXTRACTION' }
  | { kind: 'EXTRACT_SUCCESS'; propuesta: PropuestaFactura | PropuestaPago }
  | { kind: 'EXTRACT_ERROR'; error: OrigenError }
  | { kind: 'MANUAL_CONTINUE'; propuesta: PropuestaFactura | PropuestaPago }
  | { kind: 'BACK' }
  | { kind: 'CONFIRM_SUCCESS' }
  | { kind: 'RESET'; tipo: Tipo }

/** Builds the empty (all-null) proposal shape for the manual origin. */
export function emptyPropuesta(tipo: Tipo): PropuestaFactura | PropuestaPago {
  if (tipo === 'factura') {
    return {
      proveedor_nombre: null,
      numero: null,
      fecha_emision: null,
      monto_total: null,
      error: false,
      error_message: null,
    }
  }
  return {
    proveedor_nombre: null,
    monto: null,
    fecha: null,
    metodo: null,
    error: false,
    error_message: null,
  }
}

export function initialCargaModalState(tipo: Tipo): CargaModalState {
  return { step: 'origen', tipo, origen: 'imagen', error: null }
}

export function cargaModalReducer(
  state: CargaModalState,
  action: CargaModalAction,
): CargaModalState {
  switch (action.kind) {
    case 'SET_TIPO':
      if (state.step !== 'origen') return state
      return { ...state, tipo: action.tipo, error: null }

    case 'SET_ORIGEN':
      if (state.step !== 'origen') return state
      return { ...state, origen: action.origen, error: null }

    case 'START_EXTRACTION':
      if (state.step !== 'origen' || state.origen !== 'imagen') return state
      return { step: 'processing', tipo: state.tipo }

    case 'EXTRACT_SUCCESS':
      if (state.step !== 'processing') return state
      return {
        step: 'review',
        tipo: state.tipo,
        origen: 'imagen',
        propuesta: action.propuesta,
      }

    case 'EXTRACT_ERROR':
      if (state.step !== 'processing') return state
      return { step: 'origen', tipo: state.tipo, origen: 'imagen', error: action.error }

    case 'MANUAL_CONTINUE':
      if (state.step !== 'origen' || state.origen !== 'manual') return state
      return {
        step: 'review',
        tipo: state.tipo,
        origen: 'manual',
        propuesta: action.propuesta,
      }

    case 'BACK':
      if (state.step !== 'review') return state
      return { step: 'origen', tipo: state.tipo, origen: state.origen, error: null }

    case 'CONFIRM_SUCCESS':
      if (state.step !== 'review') return state
      return { step: 'success', tipo: state.tipo }

    case 'RESET':
      return { step: 'origen', tipo: action.tipo, origen: 'imagen', error: null }

    default: {
      // Exhaustive check — TypeScript narrows `action` to `never` here
      // when all action kinds are handled. Adding a new action without
      // updating this switch fails the compile.
      const _exhaustive: never = action
      void _exhaustive
      return state
    }
  }
}
