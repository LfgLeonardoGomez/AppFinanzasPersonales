/**
 * PropuestaIAModal — the blocking modal that wraps the C-14 vision
 * extraction flow (C-15, section 6).
 *
 * The modal is a CONTROLLED pre-fill surface. It NEVER persists
 * anything (RN-IA-04). On `Confirmar`, it calls `onConfirm(propuesta,
 * selectedProveedor)` with the proposal and the user-picked supplier;
 * the parent form is responsible for setting its state and firing
 * the manual `POST /api/facturas` / `POST /api/pagos` via the
 * existing C-09 / C-11 mutations. The modal closes after `Confirmar`.
 *
 * STATE MACHINE (see `propuestaModalReducer.ts`):
 *   7 states: idle / extracting / proposal / error_422 / error_429 /
 *             error_extractor / error_generic
 *   10 transitions, all in the reducer. The component owns the
 *   `useReducer` + the per-state UI + the side effects (mutation
 *   fire, ESC handling, focus trap, 429 countdown).
 *
 * ARIA / accessibility (D-2):
 *   - `aria-busy="true"` while extracting
 *   - `aria-live="polite"` on the status panel (so screen readers
 *     announce the state change)
 *   - Focus trap: Tab cycles within the modal (basic implementation
 *     via first/last focusable element query)
 *   - Escape closes the modal in `idle` and `proposal` states but
 *     NOT in `extracting` (RN-IA-01: prevent losing the in-flight
 *     request)
 *   - Modal is mounted via a portal to `document.body` so the
 *     40% black overlay covers the entire viewport
 *
 * Visual direction (D-12, high-end-visual-design):
 *   - Double-bezel: an outer `bg-black/40` overlay + an inner
 *     `bg-white` rounded-2xl card with a subtle `ring-1 ring-black/5`
 *     and a `shadow-[0_8px_28px_-8px_rgba(0,0,0,0.15)]` (diffuse
 *     ambient shadow, NOT a hard drop shadow).
 *   - State transitions use `cubic-bezier(0.23, 1, 0.32, 1)`
 *     ease-out at 200ms (Emil Kowalski: instant feedback on
 *     "feels fast" interactions).
 *   - The button-in-button pattern is applied to the Confirmar
 *     CTA when a checkmark is shown next to the text (kept
 *     minimal for an MVP modal — no nested icon ring).
 */
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import type { PropuestaFactura, PropuestaPago, ProveedorListItem } from '@shared/api/api'
import { useExtraerFacturaIA, useExtraerPagoIA } from '../api/iaVisionHooks'
import { ImagenPicker } from './ImagenPicker'
import { PropuestaFacturaFields } from './PropuestaFacturaFields'
import { PropuestaPagoFields } from './PropuestaPagoFields'
import {
  initialModalState,
  propuestaModalReducer,
  type PropuestaModalState,
} from './propuestaModalReducer'

const SIZE_ERROR_422 =
  'Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB.'
const RATE_LIMIT_ERROR = (minutes: number): string =>
  `Demasiadas solicitudes. Has alcanzado el límite de extracciones con IA (10 por hora). Intentá en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
const EXTRACTOR_ERROR_FALLBACK = 'No se pudo leer la imagen. La IA no pudo extraer los datos.'
const GENERIC_ERROR = 'Algo salió mal. Reintentá o cargá manualmente.'

export interface PropuestaIAModalProps {
  open: boolean
  tipo: 'factura' | 'pago'
  onClose: () => void
  onConfirm: (propuesta: PropuestaFactura | PropuestaPago, selectedProveedor: ProveedorListItem) => void
  onManualLoad?: () => void
}

function isAxiosError(e: unknown): e is { response?: { status: number; headers?: Record<string, string> } } {
  return typeof e === 'object' && e !== null && 'response' in e
}

export function PropuestaIAModal({ open, tipo, onClose, onConfirm, onManualLoad }: PropuestaIAModalProps) {
  const [state, dispatch] = useReducer(propuestaModalReducer, undefined, initialModalState)
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorListItem | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [editablePropuesta, setEditablePropuesta] = useState<PropuestaFactura | PropuestaPago | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const facturaMutation = useExtraerFacturaIA()
  const pagoMutation = useExtraerPagoIA()

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      dispatch({ kind: 'RETRY' }) // resets to idle
      setSelectedProveedor(null)
      setEditablePropuesta(null)
      setCountdown(0)
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    } else {
      previouslyFocusedRef.current?.focus()
    }
  }, [open])

  // 429 countdown
  useEffect(() => {
    if (state.kind !== 'error_429') return
    setCountdown(state.retryAfterSeconds)
    const interval = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          window.clearInterval(interval)
          return 0
        }
        return c - 1
      })
    }, 1000)
    return () => window.clearInterval(interval)
  }, [state])

  const fireExtraction = useCallback(
    (file: File) => {
      const mutation = tipo === 'factura' ? facturaMutation : pagoMutation
      mutation.mutate(file, {
        onSuccess: (propuesta) => {
          dispatch({ kind: 'EXTRACT_SUCCESS', propuesta, tipo })
          if (!propuesta.error) {
            setEditablePropuesta(propuesta)
          }
        },
        onError: (err: unknown) => {
          if (isAxiosError(err) && err.response) {
            const status = err.response.status
            if (status === 422) {
              dispatch({ kind: 'EXTRACT_ERROR', status, message: SIZE_ERROR_422 })
              return
            }
            if (status === 429) {
              const retryAfterHeader = err.response.headers?.['retry-after']
              const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : 60
              const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
              dispatch({
                kind: 'EXTRACT_ERROR',
                status,
                message: RATE_LIMIT_ERROR(minutes),
                retryAfterSeconds,
              })
              return
            }
          }
          dispatch({ kind: 'EXTRACT_ERROR', status: 500, message: GENERIC_ERROR })
        },
      })
    },
    [tipo, facturaMutation, pagoMutation],
  )

  // When the user picks a file, the ImagenPicker fires onPick; we move
  // the reducer to extracting and fire the mutation.
  function handlePick(file: File): void {
    dispatch({ kind: 'PICK_FILE', file })
    fireExtraction(file)
  }

  // When the user clicks "Reintentar" inside an error state, we go
  // back to idle. The mutation is NOT auto-fired (the user MUST
  // pick a new file).
  function handleRetry(): void {
    dispatch({ kind: 'RETRY' })
  }

  function handleConfirm(): void {
    if (!editablePropuesta || !selectedProveedor) return
    onConfirm(editablePropuesta, selectedProveedor)
    dispatch({ kind: 'CONFIRM' })
    // Do NOT call onClose() here. The parent closes the modal by
    // transitioning its own state (the modal's `open` is derived from that
    // state). Calling onClose() would additionally fire the parent's cancel
    // handler and clobber the confirm transition — e.g. bouncing back to the
    // mode selector instead of showing the prefilled form, so the invoice
    // never gets created.
  }

  function handleCancel(): void {
    dispatch({ kind: 'CANCEL' })
    onClose()
  }

  function handleManualLoad(): void {
    dispatch({ kind: 'MANUAL_LOAD' })
    onManualLoad?.()
    onClose()
  }

  // Escape key handling: close in idle/proposal/error states, NOT in extracting.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape') return
    if (state.kind === 'extracting') return
    handleCancel()
  }

  // Focus trap: cycle Tab within the modal.
  useEffect(() => {
    if (!open) return
    function onTab(e: globalThis.KeyboardEvent): void {
      if (e.key !== 'Tab' || !cardRef.current) return
      const focusables = cardRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onTab)
    return () => document.removeEventListener('keydown', onTab)
  }, [open])

  if (!open) return null

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={(e) => {
        // Click on overlay (not on the card) closes the modal —
        // matches the standard modal UX. Disabled while extracting
        // (the in-flight request must not be cancelled).
        if (e.target === e.currentTarget && state.kind !== 'extracting') {
          handleCancel()
        }
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-busy={state.kind === 'extracting'}
        aria-labelledby="ia-modal-title"
        onKeyDown={handleKeyDown}
        className="bg-white rounded-2xl ring-1 ring-black/5 shadow-[0_8px_28px_-8px_rgba(0,0,0,0.15)] w-full max-w-lg p-6 flex flex-col gap-5"
      >
        <ModalHeader
          state={state}
          {...(state.kind === 'extracting' ? {} : { onClose: handleCancel })}
        />

        <div
          role="status"
          aria-live="polite"
          className="flex flex-col gap-4 min-h-[180px]"
        >
          {state.kind === 'idle' ? <ImagenPicker onPick={handlePick} /> : null}

          {state.kind === 'extracting' ? <ExtractingState /> : null}

          {state.kind === 'proposal' && editablePropuesta ? (
            <ProposalState
              tipo={tipo}
              propuesta={editablePropuesta}
              onChange={setEditablePropuesta}
              selectedProveedor={selectedProveedor}
              onProveedorChange={setSelectedProveedor}
            />
          ) : null}

          {state.kind === 'error_422' ? <ErrorState message={state.message} onRetry={handleRetry} /> : null}

          {state.kind === 'error_429' ? (
            <Error429State
              message={state.message}
              countdown={countdown}
              onCancel={handleCancel}
            />
          ) : null}

          {state.kind === 'error_extractor' ? (
            <ErrorState
              message={state.message || EXTRACTOR_ERROR_FALLBACK}
              variant="extractor"
              onRetry={handleRetry}
              onManualLoad={handleManualLoad}
            />
          ) : null}

          {state.kind === 'error_generic' ? (
            <ErrorState
              message={state.message}
              variant="generic"
              onRetry={handleRetry}
              onManualLoad={handleManualLoad}
            />
          ) : null}
        </div>

        {state.kind === 'proposal' ? (
          <ProposalFooter
            selectedProveedor={selectedProveedor}
            onConfirm={handleConfirm}
            onCancel={handleCancel}
            onRetry={handleRetry}
          />
        ) : null}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ModalHeader({ state, onClose }: { state: PropuestaModalState; onClose?: () => void }) {
  const title = (() => {
    switch (state.kind) {
      case 'idle':
        return 'Cargar con imagen (IA)'
      case 'extracting':
        return 'Leyendo la imagen…'
      case 'proposal':
        return 'Revisá la propuesta'
      case 'error_422':
        return 'Formato no soportado'
      case 'error_429':
        return 'Demasiadas solicitudes'
      case 'error_extractor':
        return 'No se pudo leer la imagen'
      case 'error_generic':
        return 'Algo salió mal'
    }
  })()

  return (
    <div className="flex items-start justify-between gap-3">
      <h2 id="ia-modal-title" className="text-lg font-semibold text-slate-900">
        {title}
      </h2>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar modal"
          className="rounded-full w-8 h-8 inline-flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}

function ExtractingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8">
      <Spinner />
      <p className="text-sm text-slate-600">Leyendo la imagen…</p>
    </div>
  )
}

function Spinner() {
  return (
    <div
      role="status"
      aria-label="Cargando"
      className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin"
      style={{ animationDuration: '1.2s' }}
    />
  )
}

function ProposalState({
  tipo,
  propuesta,
  onChange,
  selectedProveedor,
  onProveedorChange,
}: {
  tipo: 'factura' | 'pago'
  propuesta: PropuestaFactura | PropuestaPago
  onChange: (next: PropuestaFactura | PropuestaPago) => void
  selectedProveedor: ProveedorListItem | null
  onProveedorChange: (proveedor: ProveedorListItem | null) => void
}) {
  if (tipo === 'factura') {
    return (
      <PropuestaFacturaFields
        propuesta={propuesta as PropuestaFactura}
        onChange={(next) => onChange(next)}
        selectedProveedor={selectedProveedor}
        onProveedorChange={onProveedorChange}
      />
    )
  }
  return <PropuestaPagoFields propuesta={propuesta as PropuestaPago} onChange={(next) => onChange(next)} />
}

function ErrorState({
  message,
  variant = 'format',
  onRetry,
  onManualLoad,
}: {
  message: string
  variant?: 'format' | 'extractor' | 'generic'
  onRetry?: () => void
  onManualLoad?: () => void
}) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">{message}</p>
      <div className="flex items-center gap-2">
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            {variant === 'extractor' ? 'Reintentar con otra foto' : 'Reintentar'}
          </button>
        ) : null}
        {onManualLoad ? (
          <button
            type="button"
            onClick={onManualLoad}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
          >
            Cargar manualmente
          </button>
        ) : null}
      </div>
    </div>
  )
}

function Error429State({
  message,
  countdown,
  onCancel,
}: {
  message: string
  countdown: number
  onCancel: () => void
}) {
  const minutes = Math.ceil(countdown / 60)
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-slate-700">{message}</p>
      <p className="text-xs text-slate-500" aria-live="off">
        {countdown > 0
          ? `Podés reintentar en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
          : 'Ya podés reintentar.'}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}

function ProposalFooter({
  selectedProveedor,
  onConfirm,
  onCancel,
  onRetry,
}: {
  selectedProveedor: ProveedorListItem | null
  onConfirm: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const canConfirm = selectedProveedor !== null
  return (
    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        Reintentar
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        Cancelar
      </button>
      <button
        type="button"
        onClick={onConfirm}
        disabled={!canConfirm}
        className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        Confirmar
      </button>
    </div>
  )
}
