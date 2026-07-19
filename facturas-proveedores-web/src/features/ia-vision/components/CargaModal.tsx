/**
 * CargaModal — the unified carga modal (the keystone of the redesign).
 *
 * ONE modal serves both factura and pago, both IA (image) and manual
 * origin, per `specs/design/IA_EXPERIENCE.md` ("Un solo flujo, dos
 * orígenes") and `UX_PRINCIPLES.md` Regla 15 ("Manual e IA terminan en
 * la misma experiencia"). It replaces the old two-step flow — a
 * full-screen `ModeSelector` that routed to either a separate
 * `PropuestaIAModal` (IA-only) or the big `FacturaForm`/`PagoForm`
 * page (manual-only) — with a single state machine:
 *
 *   origen → processing → review → success
 *
 * See `cargaModalReducer.ts` for the full transition table. The four
 * steps:
 *   1. origen: toggle Factura/Pago + toggle Con-imagen/Manual, then
 *      either a dropzone (imagen) or an explanatory note (manual).
 *   2. processing: shown only for the imagen path while the C-14/C-15
 *      vision endpoint reads the document.
 *   3. review: the (possibly prefilled) proposal in the SAME editable
 *      fields regardless of origin — `PropuestaFacturaFields` /
 *      `PropuestaPagoFields`, which already render null fields as
 *      empty inputs (RN-IA-03) and wrap `SupplierMatchControl` for the
 *      proveedor auto-match / inline-create (RN-IA-06: the IA
 *      suggests, the human confirms). A banner appears ONLY when the
 *      data came from an image.
 *   4. success: a confirmation + a CTA to the supplier's cuenta
 *      corriente (`onCreated` fires when the user clicks it — the
 *      parent page performs the actual navigation).
 *
 * TERMINAL CONFIRM (kept from the C-21 predecessor, `PropuestaIAModal`):
 * a single "Confirmar" uploads the picked image to Cloudinary (imagen
 * origin only — manual origin never uploads anything), builds the
 * create payload via `buildCreatePayload`, and fires the injected
 * `createFactura` / `createPago` directly. `origen` is stamped 'IA' for
 * the imagen path and 'MANUAL' for the manual path. The pago payload
 * NEVER carries `factura_id` (RN-PAG-01 — enforced by `buildCreatePayload`
 * itself, not by this component).
 *
 * PUBLIC API: the modal is entry-point agnostic — it owns BOTH
 * `createFactura` and `createPago` so a caller can open it from
 * anywhere (a factura page, a pago page, or a single generic "Cargar"
 * entry point) and the user can freely toggle tipo inside. See the
 * `CargaModalProps` below.
 */
import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type {
  FacturaCreate,
  FacturaResponse,
  OrigenDocumento,
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
import { Button } from '@shared/components/Button/Button'
import { ImagenPicker } from './ImagenPicker'
import { PropuestaFacturaFields } from './PropuestaFacturaFields'
import { PropuestaPagoFields } from './PropuestaPagoFields'
import {
  cargaModalReducer,
  emptyPropuesta,
  initialCargaModalState,
  type CargaModalState,
  type Origen,
  type OrigenError,
  type Tipo,
} from './cargaModalReducer'

const SIZE_ERROR_422 =
  'Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB.'
const RATE_LIMIT_ERROR = (minutes: number): string =>
  `Demasiadas solicitudes. Has alcanzado el límite de extracciones con IA (10 por hora). Intentá en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
const EXTRACTOR_ERROR_FALLBACK = 'No se pudo leer la imagen. La IA no pudo extraer los datos.'
const GENERIC_ERROR = 'Algo salió mal. Reintentá o cargá manualmente.'
const UPLOAD_ERROR_FALLBACK = 'Error al subir el archivo.'
const CREATE_ERROR_FALLBACK = 'No se pudo guardar. Revisá los datos e intentá de nuevo.'
const MISSING_IMAGE_ERROR = 'No se encontró la imagen. Volvé a intentar la carga.'
const MISSING_PRESET_ERROR = 'No se pudo preparar la subida de la imagen. Reintentá.'

export interface CargaModalProps {
  open: boolean
  /** The tipo the modal opens on — the user can still toggle it (origen step). */
  initialTipo: Tipo
  onClose: () => void
  /** Fired when the user clicks the success screen's CTA — the parent redirects. */
  onCreated: (created: FacturaResponse | PagoResponse) => void
  createFactura: (payload: FacturaCreate) => Promise<FacturaResponse>
  createPago: (payload: PagoCreate) => Promise<PagoResponse>
  /** Optional supplier prefill (e.g. `?proveedor_id=` on the page route). */
  initialSelectedProveedor?: ProveedorListItem | null
}

interface CreatedResult {
  resource: FacturaResponse | PagoResponse
  proveedorNombre: string
}

function isAxiosError(e: unknown): e is { response?: { status: number; headers?: Record<string, string> } } {
  return typeof e === 'object' && e !== null && 'response' in e
}

export function CargaModal({
  open,
  initialTipo,
  onClose,
  onCreated,
  createFactura,
  createPago,
  initialSelectedProveedor = null,
}: CargaModalProps) {
  const [state, dispatch] = useReducer(cargaModalReducer, initialTipo, initialCargaModalState)
  const [pickedFile, setPickedFile] = useState<File | null>(null)
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorListItem | null>(null)
  const [editablePropuesta, setEditablePropuesta] = useState<PropuestaFactura | PropuestaPago | null>(null)
  const [isConfirming, setIsConfirming] = useState(false)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState(0)
  const [createdResult, setCreatedResult] = useState<CreatedResult | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const facturaMutation = useExtraerFacturaIA()
  const pagoMutation = useExtraerPagoIA()

  // The Cloudinary preset is only needed while reviewing data that came
  // from an image — the manual origin never uploads anything.
  const cloudinaryPresetTipo =
    state.step === 'review' && state.origen === 'imagen' ? (state.tipo === 'factura' ? 'factura' : 'comprobante') : ''
  const { data: cloudinaryPreset } = useCloudinaryPreset(cloudinaryPresetTipo)

  // Reset state on open/close.
  useEffect(() => {
    if (open) {
      dispatch({ kind: 'RESET', tipo: initialTipo })
      setPickedFile(null)
      setSelectedProveedor(initialSelectedProveedor ?? null)
      setEditablePropuesta(null)
      setConfirmError(null)
      setIsConfirming(false)
      setCountdown(0)
      setCreatedResult(null)
      previouslyFocusedRef.current = document.activeElement as HTMLElement | null
      // eslint-disable-next-line react-hooks/exhaustive-deps
    } else {
      previouslyFocusedRef.current?.focus()
    }
    // initialSelectedProveedor is intentionally read only at open-time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTipo])

  // Sync the supplier prefill once it resolves (e.g. `?proveedor_id=`
  // fetched asynchronously via `useProveedor` in the parent page) —
  // covers entering review before the query settles. Never overrides an
  // explicit user pick (only applies while nothing is selected yet).
  useEffect(() => {
    if (state.step === 'review' && selectedProveedor === null && initialSelectedProveedor) {
      setSelectedProveedor(initialSelectedProveedor)
    }
  }, [state.step, initialSelectedProveedor, selectedProveedor])

  // 429 countdown — fires once when a rate_limit error enters state.
  useEffect(() => {
    if (state.step !== 'origen' || state.error?.kind !== 'rate_limit') return
    setCountdown(state.error.retryAfterSeconds ?? 60)
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
    (tipo: Tipo, file: File) => {
      const mutation = tipo === 'factura' ? facturaMutation : pagoMutation
      mutation.mutate(file, {
        onSuccess: (propuesta) => {
          if (propuesta.error) {
            // RN-IA-05: a 200 with `error: true` is a real answer, not a
            // network failure — surfaced as an origen-step error so the
            // user can retry with another photo or switch to manual.
            const error: OrigenError = {
              kind: 'extractor',
              message: propuesta.error_message ?? EXTRACTOR_ERROR_FALLBACK,
            }
            dispatch({ kind: 'EXTRACT_ERROR', error })
            setPickedFile(null)
            return
          }
          setEditablePropuesta(propuesta)
          setSelectedProveedor(initialSelectedProveedor ?? null)
          dispatch({ kind: 'EXTRACT_SUCCESS', propuesta })
        },
        onError: (err: unknown) => {
          if (isAxiosError(err) && err.response) {
            const status = err.response.status
            if (status === 422) {
              dispatch({ kind: 'EXTRACT_ERROR', error: { kind: 'format', message: SIZE_ERROR_422 } })
              setPickedFile(null)
              return
            }
            if (status === 429) {
              const retryAfterHeader = err.response.headers?.['retry-after']
              const retryAfterSeconds = retryAfterHeader ? Number(retryAfterHeader) : 60
              const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60))
              dispatch({
                kind: 'EXTRACT_ERROR',
                error: { kind: 'rate_limit', message: RATE_LIMIT_ERROR(minutes), retryAfterSeconds },
              })
              setPickedFile(null)
              return
            }
          }
          dispatch({ kind: 'EXTRACT_ERROR', error: { kind: 'generic', message: GENERIC_ERROR } })
          setPickedFile(null)
        },
      })
    },
    [facturaMutation, pagoMutation, initialSelectedProveedor],
  )

  function handleSetTipo(tipo: Tipo): void {
    dispatch({ kind: 'SET_TIPO', tipo })
  }

  function handleSetOrigen(origen: Origen): void {
    dispatch({ kind: 'SET_ORIGEN', origen })
    setPickedFile(null)
  }

  function handlePickFile(file: File): void {
    setPickedFile(file)
  }

  function handleClearFile(): void {
    setPickedFile(null)
  }

  function handleContinuar(): void {
    if (state.step !== 'origen') return
    if (state.origen === 'imagen') {
      if (!pickedFile) return
      dispatch({ kind: 'START_EXTRACTION' })
      fireExtraction(state.tipo, pickedFile)
    } else {
      const propuesta = emptyPropuesta(state.tipo)
      setEditablePropuesta(propuesta)
      setSelectedProveedor(initialSelectedProveedor ?? null)
      dispatch({ kind: 'MANUAL_CONTINUE', propuesta })
    }
  }

  // "Reintentar" inside the origen-step error banner: just clears the
  // error so the ImagenPicker reappears — the user must pick a new file.
  function handleRetryError(): void {
    dispatch({ kind: 'SET_ORIGEN', origen: 'imagen' })
  }

  // "Cargar manualmente" inside the origen-step error banner: switches
  // origin to manual, staying on the origen step (RN-IA per
  // IA_EXPERIENCE.md — "el usuario completa a mano en el mismo lugar").
  function handleManualLoadFromError(): void {
    dispatch({ kind: 'SET_ORIGEN', origen: 'manual' })
  }

  function handleBack(): void {
    dispatch({ kind: 'BACK' })
    setConfirmError(null)
  }

  async function handleConfirm(): Promise<void> {
    if (state.step !== 'review' || !editablePropuesta || !selectedProveedor || isConfirming) return

    setConfirmError(null)
    setIsConfirming(true)

    let url = ''
    if (state.origen === 'imagen') {
      if (!pickedFile) {
        setConfirmError(MISSING_IMAGE_ERROR)
        setIsConfirming(false)
        return
      }
      if (!cloudinaryPreset) {
        setConfirmError(MISSING_PRESET_ERROR)
        setIsConfirming(false)
        return
      }
      try {
        url = await uploadToCloudinary(pickedFile, cloudinaryPreset)
      } catch (err) {
        setConfirmError(err instanceof Error ? err.message : UPLOAD_ERROR_FALLBACK)
        setIsConfirming(false)
        return
      }
    }

    const origenTag: OrigenDocumento = state.origen === 'imagen' ? 'IA' : 'MANUAL'
    try {
      const created =
        state.tipo === 'factura'
          ? await createFactura(
              buildCreatePayload('factura', editablePropuesta as PropuestaFactura, selectedProveedor.id, url, origenTag),
            )
          : await createPago(
              buildCreatePayload('pago', editablePropuesta as PropuestaPago, selectedProveedor.id, url, origenTag),
            )
      setCreatedResult({ resource: created, proveedorNombre: selectedProveedor.nombre })
      dispatch({ kind: 'CONFIRM_SUCCESS' })
    } catch {
      setConfirmError(CREATE_ERROR_FALLBACK)
    } finally {
      setIsConfirming(false)
    }
  }

  function handleClose(): void {
    onClose()
  }

  function handleViewCuentaCorriente(): void {
    if (!createdResult) return
    onCreated(createdResult.resource)
  }

  // Escape key handling: close in every step EXCEPT processing (RN-IA-01:
  // prevent losing the in-flight extraction request).
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
    if (e.key !== 'Escape') return
    if (state.step === 'processing') return
    handleClose()
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

  const canClose = state.step !== 'processing'
  const canConfirm = state.step === 'review' && selectedProveedor !== null && !isConfirming

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget && canClose) {
          handleClose()
        }
      }}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-busy={state.step === 'processing'}
        aria-labelledby="carga-modal-title"
        onKeyDown={handleKeyDown}
        className="flex w-full max-w-lg flex-col gap-6 rounded-card bg-surface p-6 font-inter shadow-ia ring-1 ring-border-subtle transition-all duration-200 ease-[cubic-bezier(0.23,1,0.32,1)]"
      >
        <ModalHeader tipo={state.tipo} {...(canClose ? { onClose: handleClose } : {})} />

        <div role="status" aria-live="polite" className="flex min-h-[180px] flex-col gap-4">
          {state.step === 'origen' ? (
            <OrigenStep
              state={state}
              pickedFile={pickedFile}
              countdown={countdown}
              onSetTipo={handleSetTipo}
              onSetOrigen={handleSetOrigen}
              onPickFile={handlePickFile}
              onClearFile={handleClearFile}
              onRetryError={handleRetryError}
              onManualLoadFromError={handleManualLoadFromError}
            />
          ) : null}

          {state.step === 'processing' ? <ProcessingStep /> : null}

          {state.step === 'review' ? (
            <ReviewStep
              tipo={state.tipo}
              origen={state.origen}
              propuesta={editablePropuesta}
              onChange={setEditablePropuesta}
              selectedProveedor={selectedProveedor}
              onProveedorChange={setSelectedProveedor}
            />
          ) : null}

          {state.step === 'success' && createdResult ? (
            <SuccessStep tipo={state.tipo} proveedorNombre={createdResult.proveedorNombre} />
          ) : null}
        </div>

        {state.step === 'origen' ? (
          <Button
            variant="primary"
            fullWidth
            disabled={state.origen === 'imagen' && !pickedFile}
            onClick={handleContinuar}
          >
            Continuar
          </Button>
        ) : null}

        {state.step === 'review' ? (
          <ReviewFooter
            canConfirm={canConfirm}
            isConfirming={isConfirming}
            confirmError={confirmError}
            onVolver={handleBack}
            onConfirmar={() => void handleConfirm()}
          />
        ) : null}

        {state.step === 'success' ? (
          <Button variant="primary" fullWidth onClick={handleViewCuentaCorriente}>
            Ver cuenta corriente
          </Button>
        ) : null}
      </div>
    </div>
  )

  return createPortal(modal, document.body)
}

export default CargaModal

// ── Sub-components ────────────────────────────────────────────────────────────

function IaGlyph() {
  return (
    <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
      <rect x="0.8" y="0.8" width="12.4" height="8.4" rx="1.6" stroke="white" strokeWidth="1.4" />
      <circle cx="5" cy="4.5" r="1.4" stroke="white" strokeWidth="1.2" />
    </svg>
  )
}

function ModalHeader({ tipo, onClose }: { tipo: Tipo; onClose?: () => void }) {
  const title = tipo === 'factura' ? 'Cargar factura' : 'Registrar pago'
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <div className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] bg-gradient-to-br from-violet-500 to-magenta-600">
          <IaGlyph />
        </div>
        <h2 id="carga-modal-title" className="text-base font-bold text-ink">
          {title}
        </h2>
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar modal"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-ink-soft transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-page"
        >
          ✕
        </button>
      ) : null}
    </div>
  )
}

function TogglePill({
  children,
  active,
  onClick,
}: {
  children: ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex-1 rounded-pill px-0 py-2 text-sm font-semibold transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] ${
        active ? 'bg-surface text-violet-900 shadow-card' : 'bg-transparent text-ink-soft'
      }`}
    >
      {children}
    </button>
  )
}

function OrigenErrorBanner({
  error,
  countdown,
  onRetry,
  onManualLoad,
}: {
  error: OrigenError
  countdown: number
  onRetry: () => void
  onManualLoad: () => void
}) {
  if (error.kind === 'rate_limit') {
    const minutes = Math.ceil(countdown / 60)
    return (
      <div className="flex flex-col gap-2 rounded-card-sm bg-surface-alt p-4 ring-1 ring-border-subtle">
        <p className="text-sm text-ink">{error.message}</p>
        <p className="text-xs text-ink-soft" aria-live="off">
          {countdown > 0
            ? `Podés reintentar en ${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}.`
            : 'Ya podés reintentar.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3 rounded-card-sm bg-surface-alt p-4 ring-1 ring-border-subtle">
      <p role="alert" className="text-sm text-ink">
        {error.message}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {error.kind === 'extractor' ? 'Reintentar con otra foto' : 'Reintentar'}
        </Button>
        {error.kind === 'extractor' || error.kind === 'generic' ? (
          <Button variant="ghost" size="sm" onClick={onManualLoad}>
            Cargar manualmente
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function PickedFileCard({ file, onChange }: { file: File; onChange: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-card-sm bg-surface-soft p-8 text-center ring-1.5 ring-violet-500">
      <p className="text-sm font-semibold text-ink">{file.name}</p>
      <p className="text-xs text-ink-soft">Lista para procesar</p>
      <button
        type="button"
        onClick={onChange}
        className="text-xs font-semibold text-violet-500 hover:text-violet-600"
      >
        Cambiar imagen
      </button>
    </div>
  )
}

function OrigenStep({
  state,
  pickedFile,
  countdown,
  onSetTipo,
  onSetOrigen,
  onPickFile,
  onClearFile,
  onRetryError,
  onManualLoadFromError,
}: {
  state: Extract<CargaModalState, { step: 'origen' }>
  pickedFile: File | null
  countdown: number
  onSetTipo: (tipo: Tipo) => void
  onSetOrigen: (origen: Origen) => void
  onPickFile: (file: File) => void
  onClearFile: () => void
  onRetryError: () => void
  onManualLoadFromError: () => void
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 rounded-pill bg-page p-1">
        <TogglePill active={state.tipo === 'factura'} onClick={() => onSetTipo('factura')}>
          Factura
        </TogglePill>
        <TogglePill active={state.tipo === 'pago'} onClick={() => onSetTipo('pago')}>
          Pago
        </TogglePill>
      </div>

      <div className="flex gap-1 rounded-card-sm bg-page p-1">
        <TogglePill active={state.origen === 'imagen'} onClick={() => onSetOrigen('imagen')}>
          Con imagen (recomendado)
        </TogglePill>
        <TogglePill active={state.origen === 'manual'} onClick={() => onSetOrigen('manual')}>
          Manual
        </TogglePill>
      </div>

      <div className="flex min-h-[148px] flex-col justify-center">
        {state.error ? (
          <OrigenErrorBanner
            error={state.error}
            countdown={countdown}
            onRetry={onRetryError}
            onManualLoad={onManualLoadFromError}
          />
        ) : state.origen === 'imagen' ? (
          pickedFile ? (
            <PickedFileCard file={pickedFile} onChange={onClearFile} />
          ) : (
            <ImagenPicker onPick={onPickFile} />
          )
        ) : (
          <div className="rounded-card-sm bg-surface-alt p-6 text-center ring-1 ring-border-subtle">
            <p className="text-sm leading-relaxed text-ink-soft">
              Vas a completar los campos vos mismo en el siguiente paso. Podés cambiar a carga con imagen cuando
              quieras.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ProcessingStep() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-9">
      <div className="flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-magenta-600">
        <IaGlyph />
      </div>
      <div className="text-center">
        <p className="text-sm font-bold text-ink">La IA está leyendo el documento…</p>
        <p className="text-xs text-ink-soft">Esto toma unos segundos</p>
      </div>
    </div>
  )
}

function ReviewStep({
  tipo,
  origen,
  propuesta,
  onChange,
  selectedProveedor,
  onProveedorChange,
}: {
  tipo: Tipo
  origen: Origen
  propuesta: PropuestaFactura | PropuestaPago | null
  onChange: (next: PropuestaFactura | PropuestaPago) => void
  selectedProveedor: ProveedorListItem | null
  onProveedorChange: (proveedor: ProveedorListItem | null) => void
}) {
  if (!propuesta) return null
  return (
    <div className="flex flex-col gap-4">
      {origen === 'imagen' ? (
        <div className="flex items-center gap-2 rounded-chip bg-violet-50 px-3 py-2.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
          <p className="text-xs font-semibold text-violet-900">
            Listo — revisá y corregí lo que necesites antes de confirmar
          </p>
        </div>
      ) : null}

      {tipo === 'factura' ? (
        <PropuestaFacturaFields
          propuesta={propuesta as PropuestaFactura}
          onChange={onChange}
          selectedProveedor={selectedProveedor}
          onProveedorChange={onProveedorChange}
        />
      ) : (
        <PropuestaPagoFields
          propuesta={propuesta as PropuestaPago}
          onChange={onChange}
          selectedProveedor={selectedProveedor}
          onProveedorChange={onProveedorChange}
        />
      )}
    </div>
  )
}

function ReviewFooter({
  canConfirm,
  isConfirming,
  confirmError,
  onVolver,
  onConfirmar,
}: {
  canConfirm: boolean
  isConfirming: boolean
  confirmError: string | null
  onVolver: () => void
  onConfirmar: () => void
}) {
  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle pt-4">
      {confirmError ? (
        <p role="alert" className="text-sm text-danger">
          {confirmError}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <Button variant="secondary" onClick={onVolver} disabled={isConfirming}>
          Volver
        </Button>
        <Button variant="primary" fullWidth onClick={onConfirmar} disabled={!canConfirm} loading={isConfirming}>
          Confirmar
        </Button>
      </div>
    </div>
  )
}

function CheckIcon() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" fill="none" aria-hidden="true">
      <path d="M1 6L6 11L15 1" stroke="#059669" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SuccessStep({ tipo, proveedorNombre }: { tipo: Tipo; proveedorNombre: string }) {
  const title = tipo === 'factura' ? 'Factura confirmada' : 'Pago confirmado'
  return (
    <div className="flex flex-col items-center gap-4 py-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success-bg">
        <CheckIcon />
      </div>
      <div>
        <p className="text-sm font-bold text-ink">{title}</p>
        <p className="text-xs text-ink-soft">Te llevamos a la cuenta corriente de {proveedorNombre}</p>
      </div>
    </div>
  )
}
