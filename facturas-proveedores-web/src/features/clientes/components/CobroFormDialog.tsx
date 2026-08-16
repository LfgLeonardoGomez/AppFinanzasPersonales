/**
 * CobroFormDialog — "Registrar cobro" dialog (C-36, design.md D6, D8, D11).
 *
 * D6 — the ceiling shown here (max="{saldo}") is a COURTESY, not the rule:
 * `cobro_cliente_service` recomputes the available balance server-side on
 * every create, and its `422 detail` — which states the actual remaining
 * balance — is surfaced verbatim, because it was written to be corrected
 * against, not guessed at. On any rejection the form keeps every field as
 * typed and calls `onAccountInvalidate` so the ceiling corrects itself for
 * the next attempt (the balance may have moved between this dialog opening
 * and this submit).
 *
 * D7/D8 — `crearCobro`/`useCrearCobro` resolve `{ cobro, replay }`; a
 * `replay: true` is passed up via `onSuccess`'s second argument, mirroring
 * `VentaForm`. An UNCONFIRMED outcome (`classifyError` → `unknown`: no
 * response, or any 5xx) gets its own `role="status"` banner, distinct from
 * the `role="alert"` backend-error path — this endpoint does NOT dedupe
 * (no idempotency until C-43 Fase B), so the copy points at the customer's
 * movements and never claims a retry is safe.
 *
 * D11 — client validation (amount > 0, amount <= saldo, date not future in
 * Argentina, method required) exists for usability only; the backend's
 * `422 detail` is always what is actually shown on a real rejection.
 *
 * NO idempotency here: no `@shared/api/idempotency` import, no
 * `Idempotency-Key` header — that is C-43 Fase B (design.md D7).
 */
import { useState, type FormEvent, type ChangeEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useCrearCobro } from '../api/cobrosHooks'
import type { CrearCobroResult } from '../api/cobrosApi'
import { classifyError } from '@shared/api/submitOutcome'
import type { UseMutationResult } from '@tanstack/react-query'
import { getTodayInArgentina } from '@shared/utils/date'
import { InputField } from '@shared/components/InputField/InputField'
import { FileUploadField } from '@features/facturas/components/FileUploadField'
import { formatMonto } from '@shared/utils/currency'
import type { CobroClienteCreate, MetodoCobro } from '@shared/api/api'

type CrearCobroMutation = UseMutationResult<CrearCobroResult, Error, CobroClienteCreate>

interface FormErrors {
  monto?: string
  fecha?: string
  metodo?: string
  backend?: string
}

interface CobroFormDialogProps {
  open: boolean
  clienteId: string
  /** Current pending balance — the ceiling shown, never enforced client-side alone (design.md D6). */
  saldo: number
  onSuccess: (cobro: CrearCobroResult['cobro'], meta?: { replay?: boolean }) => void
  onCancel: () => void
  /** Called after a real rejection, so the caller can invalidate the cached account (design.md D6). */
  onAccountInvalidate?: () => void
  externalCreateMutation?: CrearCobroMutation
}

interface FormState {
  fecha: string
  monto: string
  metodo: string
  comprobante_url: string | null
}

const METODO_OPTIONS: { value: MetodoCobro; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'OTRO', label: 'Otro' },
]

function initialState(): FormState {
  return { fecha: getTodayInArgentina(), monto: '', metodo: '', comprobante_url: null }
}

function extractBackendError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { response?: { data?: { detail?: unknown } } }
    const detail = e.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      return first?.msg ?? 'Error de validación.'
    }
  }
  return 'Error al registrar el cobro.'
}

export function CobroFormDialog({
  open,
  clienteId,
  saldo,
  onSuccess,
  onCancel,
  onAccountInvalidate,
  externalCreateMutation,
}: CobroFormDialogProps) {
  const [form, setForm] = useState<FormState>(() => initialState())
  const [errors, setErrors] = useState<FormErrors>({})
  // design.md D8 — an unconfirmed ("no pudimos confirmar") outcome is its
  // own state, never folded into `errors.backend`.
  const [ambiguousOutcome, setAmbiguousOutcome] = useState(false)

  const createMutationInternal = useCrearCobro()
  const createMutation = externalCreateMutation ?? createMutationInternal
  const isPending = createMutation.isPending

  if (!open) return null

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[name as keyof FormErrors]
      delete next.backend
      return next
    })
  }

  function validate(): FormErrors {
    const errs: FormErrors = {}
    const montoNum = parseFloat(form.monto)
    if (!form.monto || isNaN(montoNum) || montoNum <= 0) {
      errs.monto = 'El monto debe ser mayor a cero.'
    } else if (montoNum > saldo) {
      errs.monto = `El monto no puede superar el saldo pendiente (${formatMonto(saldo)}).`
    }
    if (!form.fecha) {
      errs.fecha = 'La fecha es requerida.'
    } else {
      const today = getTodayInArgentina()
      if (form.fecha > today) {
        errs.fecha = 'La fecha no puede ser futura.'
      }
    }
    if (!form.metodo) {
      errs.metodo = 'El método de cobro es obligatorio.'
    }
    return errs
  }

  function handleSubmitError(err: unknown) {
    const outcome = classifyError(
      isAxiosError(err) && err.response
        ? { response: { status: err.response.status, data: err.response.data as { detail?: unknown } } }
        : {},
    )
    if (outcome.kind === 'unknown') {
      setAmbiguousOutcome(true)
      setErrors((prev) => {
        const next = { ...prev }
        delete next.backend
        return next
      })
    } else {
      setAmbiguousOutcome(false)
      setErrors({ backend: extractBackendError(err) })
      // design.md D6 — a real rejection may mean the balance moved between
      // this dialog opening and this submit; invalidate so the ceiling
      // (and the account view behind it) corrects itself.
      onAccountInvalidate?.()
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const payload: CobroClienteCreate = {
      cliente_id: clienteId,
      monto: form.monto,
      fecha: form.fecha,
      metodo: form.metodo as MetodoCobro,
      comprobante_url: form.comprobante_url,
    }

    createMutation.mutate(payload, {
      onSuccess: (result) => {
        setErrors({})
        setAmbiguousOutcome(false)
        onSuccess(result.cobro, { replay: result.replay })
      },
      onError: handleSubmitError,
    })
  }

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel()
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/40" />
        <Dialog.Content
          aria-label="Registrar cobro"
          aria-modal="true"
          className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle focus:outline-none dark:bg-card-dark dark:ring-white/10"
        >
          <div className="mb-6 flex items-start justify-between gap-3">
            <Dialog.Title className="font-inter text-xl font-semibold text-ink dark:text-zinc-100">
              Registrar cobro
            </Dialog.Title>
            <button
              type="button"
              aria-label="Cerrar formulario"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-full p-2 text-ink-soft transition-colors hover:bg-page hover:text-ink disabled:opacity-50"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <Dialog.Description className="sr-only">
            Registrar un cobro para este cliente.
          </Dialog.Description>

          <p className="mb-4 text-sm text-ink-soft">
            Máximo: {formatMonto(saldo)} — es lo que debe hoy.
          </p>

          <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <InputField
                label="Monto"
                id="monto"
                name="monto"
                type="number"
                min="0.01"
                max={saldo}
                step="0.01"
                value={form.monto}
                onChange={handleChange}
                error={errors.monto}
                required
              />

              <InputField
                label="Fecha"
                id="fecha"
                name="fecha"
                type="date"
                max={getTodayInArgentina()}
                value={form.fecha}
                onChange={handleChange}
                error={errors.fecha}
                required
              />

              <div className="flex flex-col gap-1.5">
                <label htmlFor="metodo" className="text-sm font-medium text-ink">
                  Método de cobro
                </label>
                <select
                  id="metodo"
                  name="metodo"
                  value={form.metodo}
                  onChange={handleChange}
                  aria-required="true"
                  aria-invalid={Boolean(errors.metodo)}
                  aria-describedby={errors.metodo ? 'metodo-error' : undefined}
                  className="w-full rounded-card-sm border border-border-subtle bg-surface px-3 py-2.5 text-sm text-ink transition-all duration-200 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100 dark:bg-card-dark-secondary dark:text-zinc-100"
                >
                  <option value="">— Seleccionar —</option>
                  {METODO_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {errors.metodo && (
                  <span id="metodo-error" role="alert" className="text-xs font-medium text-danger">
                    {errors.metodo}
                  </span>
                )}
              </div>
            </div>

            <FileUploadField
              tipo="comprobante"
              onUrlChange={(url) => setForm((prev) => ({ ...prev, comprobante_url: url }))}
              currentUrl={form.comprobante_url}
            />

            {errors.backend && (
              <p role="alert" aria-live="assertive" className="text-sm text-danger">
                {errors.backend}
              </p>
            )}

            {/* design.md D8 — unconfirmed outcome: this endpoint does NOT
                dedupe, so the copy never says retrying is safe. */}
            {ambiguousOutcome && (
              <div
                role="status"
                aria-live="polite"
                className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning ring-1 ring-warning/10"
              >
                <p>
                  No pudimos confirmar si el cobro se guardó. Esta operación no queda identificada
                  para evitar duplicados, así que antes de reintentar,{' '}
                  <Link to={`/clientes/${clienteId}`} className="font-semibold underline">
                    revisá los movimientos del cliente
                  </Link>{' '}
                  para asegurarte de que no quedó cargado.
                </p>
              </div>
            )}

            <div className="mt-1 flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                disabled={isPending}
                className="rounded-pill px-5 py-2.5 text-sm font-semibold text-ink-soft-2 transition-colors hover:bg-page disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isPending}
                className="rounded-pill bg-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-violet-600 active:scale-[0.98] disabled:opacity-50"
              >
                {isPending ? 'Guardando…' : 'Registrar cobro'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default CobroFormDialog
