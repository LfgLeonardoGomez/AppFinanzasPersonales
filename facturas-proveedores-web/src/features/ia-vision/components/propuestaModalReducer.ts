/**
 * Pure state-machine reducer for the `PropuestaIAModal` (C-15, section 6).
 *
 * Extracted from the React component so the 7 states and 10 transitions
 * can be unit-tested without React. The component (`PropuestaIAModal.tsx`)
 * wires this reducer to a `useReducer` hook and renders the right UI
 * for each state. The reducer is a `switch (action.kind)` with an
 * exhaustive `never` check at the end — adding a new state or action
 * without handling it fails the TypeScript compile.
 *
 * STATE MACHINE (per design.md D-9 / tasks.md 6.1):
 *
 *   ┌────────┐  PICK_FILE
 *   │  idle  │ ──────────► ┌────────────┐
 *   └────────┘             │ extracting │
 *       ▲                  └────────────┘
 *       │ CONFIRM/CANCEL/RETRY/MANUAL_LOAD  ▲│
 *       │                                   ││
 *       │            EXTRACT_SUCCESS        ││ EXTRACT_ERROR
 *       │            (error:false)          ││ (status 422/429/500)
 *       │                                   ││
 *       │                                   ▼│
 *       │                          ┌────────────────────────┐
 *       ├──────────────────────────┤  proposal (error:false) │
 *       │                          └────────────────────────┘
 *       │                                       │
 *       │            EXTRACT_SUCCESS           │
 *       │            (error:true → RN-IA-05)   │
 *       │                                       │
 *       │                                       ▼
 *       │                          ┌────────────────────────────────────┐
 *       │                          │ error_422 / error_429 /            │
 *       │                          │ error_extractor / error_generic    │
 *       │                          └────────────────────────────────────┘
 *       │                                       │
 *       │   CANCEL / RETRY / MANUAL_LOAD        │
 *       └───────────────────────────────────────┘
 *
 * INVARIANT (RN-IA-04): the reducer has no side effects, no async logic,
 * no API calls. All persistence is the parent's responsibility; the
 * modal is a controlled pre-fill surface. The reducer only transitions
 * state — the parent observes the new state and fires the appropriate
 * callback (onConfirm / onCancel / onManualLoad / onRetry).
 */
import type { PropuestaFactura, PropuestaPago } from '@shared/api/api'

export type PropuestaModalState =
  | { kind: 'idle' }
  | { kind: 'extracting'; file: File }
  | {
      kind: 'proposal'
      propuesta: PropuestaFactura | PropuestaPago
      tipo: 'factura' | 'pago'
    }
  | { kind: 'error_422'; message: string }
  | { kind: 'error_429'; message: string; retryAfterSeconds: number }
  | { kind: 'error_extractor'; message: string }
  | { kind: 'error_generic'; message: string }

export type PropuestaModalAction =
  | { kind: 'PICK_FILE'; file: File }
  | {
      kind: 'EXTRACT_SUCCESS'
      propuesta: PropuestaFactura | PropuestaPago
      tipo: 'factura' | 'pago'
    }
  | {
      kind: 'EXTRACT_ERROR'
      status: number
      message: string
      retryAfterSeconds?: number
    }
  | { kind: 'CONFIRM' }
  | { kind: 'CANCEL' }
  | { kind: 'RETRY' }
  | { kind: 'MANUAL_LOAD' }

export function initialModalState(): PropuestaModalState {
  return { kind: 'idle' }
}

export function propuestaModalReducer(
  state: PropuestaModalState,
  action: PropuestaModalAction,
): PropuestaModalState {
  switch (action.kind) {
    case 'PICK_FILE':
      return { kind: 'extracting', file: action.file }

    case 'EXTRACT_SUCCESS':
      // RN-IA-05: the C-14 endpoint may return 200 with `error: true`
      // when the extractor fails — this is a "real answer", not a
      // network failure, so the reducer routes it to error_extractor.
      if (action.propuesta.error) {
        return {
          kind: 'error_extractor',
          message: action.propuesta.error_message ?? 'No se pudo leer la imagen.',
        }
      }
      return {
        kind: 'proposal',
        propuesta: action.propuesta,
        tipo: action.tipo,
      }

    case 'EXTRACT_ERROR':
      if (action.status === 422) {
        return { kind: 'error_422', message: action.message }
      }
      if (action.status === 429) {
        return {
          kind: 'error_429',
          message: action.message,
          retryAfterSeconds: action.retryAfterSeconds ?? 60,
        }
      }
      // 5xx / network / unknown — generic retry
      return { kind: 'error_generic', message: action.message }

    case 'CONFIRM':
    case 'CANCEL':
    case 'RETRY':
    case 'MANUAL_LOAD':
      // All four reset to idle. The parent observes this and fires
      // the matching callback (onConfirm / onCancel / etc.).
      return { kind: 'idle' }

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
