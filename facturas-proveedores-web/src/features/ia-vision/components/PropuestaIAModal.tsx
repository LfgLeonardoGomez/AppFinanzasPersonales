/**
 * PropuestaIAModal — the blocking modal that wraps the C-14 vision
 * extraction flow (C-15, section 6; made TERMINAL in C-21).
 *
 * C-21 (D1) SUPERSEDES the C-15 decision that "the modal does not
 * POST; the form creates on its own Confirmar" (D-19). The modal is
 * now terminal for the IA path: a single "Confirmar" uploads the
 * picked image to Cloudinary, builds the create payload, and fires
 * the injected `createResource` (backed by `useCreateFactura` /
 * `useCreatePago` in the parent page) directly. On success it reports
 * the created resource via `onCreated` so the page can redirect to
 * `/proveedores/:id`.
 *
 * RN-IA-04 is UNCHANGED: it governs the `/extraer-ia` EXTRACTION
 * endpoint, which still never persists anything. What changed is that
 * the human confirm — inside this modal — now creates the resource
 * instead of routing back to the big manual form. The IA proposes,
 * the human still explicitly confirms (RN-IA-06 intact).
 *
 * STATE MACHINE (see `propuestaModalReducer.ts`):
 *   7 states: idle / extracting / proposal / error_422 / error_429 /
 *             error_extractor / error_generic
 *   10 transitions, all in the reducer. The component owns the
 *   `useReducer` + the per-state UI + the side effects (mutation
 *   fire, ESC handling, focus trap, 429 countdown). The confirm-time
 *   upload + create orchestration (D1/D2/D3) is component-local state
 *   (`pickedFile` / `isConfirming` / `confirmError`) layered ON TOP of
 *   the reducer — it stays in the `proposal` state throughout so the
 *   user can correct fields and re-confirm on a validation error.
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
import type {
  FacturaCreate,
  FacturaResponse,
  PagoCreate,
  PagoResponse,
  PropuestaFactura,
  PropuestaPago,
  ProveedorListItem,
} from '@shared/api/api'
import { useExtraerFacturaIA, useExtraerPagoIA } from '../api/iaVisionHooks'
import { useCloudinaryPreset } from '@features/facturas/api/facturasHooks'
import { uploadToCloudinary } from '@shared/utils/uploadToCloudinary'
import { buildCreatePayload } from '../lib/buildCreatePayload'
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
const UPLOAD_ERROR_FALLBACK = 'Error al subir el archivo.'
const CREATE_ERROR_FALLBACK = 'No se pudo guardar. Revisá los datos e intentá de nuevo.'

export interface PropuestaIAModalProps {
  open: boolean
  tipo: 'factura' | 'pago'
  onClose: () => void
  /** Fired after the resource is successfully created — the parent redirects. */
  onCreated: (created: FacturaResponse | PagoResponse) => void
  /**
   * Injected create mutation (D1): the page owns `useCreateFactura` /
   * `useCreatePago` (so cache invalidation + success handling stay in
   * ONE place) and passes a thin async function the modal calls once
   * the image is uploaded and the payload is built.
   */
  createResource: (payload: FacturaCreate | PagoCreate) => Promise<FacturaResponse | PagoResponse>
  onManualLoad?: () => void
}

function isAxiosError(e: unknown): e is { response?: { status: number; headers?: Record<string, string> } } {
  return typeof e === 'object' && e !== null && 'response' in e
}

export function PropuestaIAModal({
  open,
  tipo,
  onClose,
  onCreated,
  createResource,
  onManualLoad,
}: PropuestaIAModalProps) {
  const [state, dispatch] = useReducer(propuestaModalReducer, undefined, initialModalState)
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorListItem | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [editablePropuesta, setEditablePropuesta] = useState<PropuestaFactura | PropuestaPago | null>(null)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const facturaMutation = useExtraerFacturaIA()
  const pagoMutation = useExtraerPagoIA()

  // The Cloudinary preset for the confirmed upload (D3). Fetched only
  // once a proposal is on screen — mirrors FileUploadField's pattern
  // of not fetching a signed preset before it's needed.
  const presetTipo = tipo === 'factura' ? 'factura' : 'comprobante'
  const { data: cloudinaryPreset } = useCloudinaryPreset(state.kind === 'proposal' ? presetTipo : '')

  // Reset state on open/close
  useEffect(() => {
    if (open) {
      dispatch({ kind: 'RETRY' }) // resets to idle
      setSelectedProveedor(null)
      setEditablePropuesta(null)
      setPickedFile(null)
      setConfirmError(null)
      setIsConfirming(false)
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
  // the reducer to extracting, remember the file (it's uploaded on
  // confirm — D3), and fire the extraction mutation.
  function handlePick(file: File): void {
    dispatch({ kind: 'PICK_FILE', file })
    setPickedFile(file)
    fireExtraction(file)
  }

  // When the user clicks "Reintentar" inside an error state, we go
  // back to idle. The mutation is NOT auto-fired (the user MUST
  // pick a new file).
  function handleRetry(): void {
    dispatch({ kind: 'RETRY' })
    setPickedFile(null)
    setConfirmError(null)
  }

  // Terminal confirm (D1/D2/D3): upload the picked image, build the
  // create payload, and fire the injected `createResource`. Stays in
  // the `proposal` state throughout (via local `isConfirming` /
  // `confirmError`) so a failure lets the user correct fields and
  // re-confirm without losing the edited proposal.
  async function handleConfirm(): Promise<void> {
    if (!editablePropuesta || !selectedProveedor || !pickedFile || isConfirming) return

    setConfirmError(null)
    setIsConfirming(true)

    let url: string
    try {
      if (!cloudinaryPreset) {
        throw new Error('No se pudo preparar la subida de la imagen. Reintentá.')
      }
      url = await uploadToCloudinary(pickedFile, cloudinaryPreset)
    } catch (err) {
      setConfirmError(err instanceof Error ? err.message : UPLOAD_ERROR_FALLBACK)
      setIsConfirming(false)
      return
    }

    try {
      const payload =
        tipo === 'factura'
          ? buildCreatePayload('factura', editablePropuesta as PropuestaFactura, selectedProveedor.id, url)
          : buildCreatePayload('pago', editablePropuesta as PropuestaPago, selectedProveedor.id, url)
      const created = await createResource(payload)
      dispatch({ kind: 'CONFIRM' })
      onCreated(created)
    } catch {
      setConfirmError(CREATE_ERROR_FALLBACK)
    } finally {
      setIsConfirming(false)
    }
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
            isConfirming={isConfirming}
            confirmError={confirmError}
            onConfirm={() => void handleConfirm()}
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
  return (
    <PropuestaPagoFields
      propuesta={propuesta as PropuestaPago}
      onChange={(next) => onChange(next)}
      selectedProveedor={selectedProveedor}
      onProveedorChange={onProveedorChange}
    />
  )
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
  isConfirming,
  confirmError,
  onConfirm,
  onCancel,
  onRetry,
}: {
  selectedProveedor: ProveedorListItem | null
  isConfirming: boolean
  confirmError: string | null
  onConfirm: () => void
  onCancel: () => void
  onRetry: () => void
}) {
  const canConfirm = selectedProveedor !== null && !isConfirming
  return (
    <div className="flex flex-col gap-2 pt-3 border-t border-slate-100">
      {confirmError ? (
        <p role="alert" className="text-sm text-rose-600">
          {confirmError}
        </p>
      ) : null}
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onRetry}
          disabled={isConfirming}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Reintentar
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={isConfirming}
          className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
        >
          {isConfirming ? 'Guardando…' : 'Confirmar'}
        </button>
      </div>
    </div>
  )
}
