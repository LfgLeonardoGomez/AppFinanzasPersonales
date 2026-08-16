/**
 * PagoForm — create/edit payment form.
 *
 * Premium card layout with InputField wrappers. All original test contracts
 * preserved: label names, id="fecha", data-testid="proveedor-readonly",
 * button names, alert roles, RN-PAG-01 note.
 *
 * C-42 review fix (finding 2, WARNING) — interim mitigation for an
 * ambiguous outcome (knowledge-base D-67): unlike ventas (C-42), this
 * endpoint has NO idempotency protection — that is C-43, explicitly out of
 * scope here. C-42's 20s global Axios timeout makes an ambiguous outcome
 * MORE dangerous for this form, not less: it turns a request that may have
 * already committed server-side into "an explicit error that invites
 * retrying over something that doesn't dedupe." So an ambiguous outcome
 * (`classifyError` from `submitOutcome.ts` — no response, or any 5xx) gets
 * its own `role="status"` banner that tells the user to check the payments
 * list BEFORE retrying, and never claims retrying is safe (it isn't — there
 * is no key to reuse). A real rejection keeps the exact prior behavior:
 * `errors.backend` via `extractBackendError`, unchanged.
 */
import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { SupplierSearch } from '@shared/components/SupplierSearch/SupplierSearch'
import { FileUploadField } from '@features/facturas/components/FileUploadField'
import { useCreatePago, useUpdatePago } from '../api/pagosHooks'
import { classifyError } from '@shared/api/submitOutcome'
import type { UseMutationResult } from '@tanstack/react-query'
import { getTodayInArgentina } from '@shared/utils/date'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import type {
  PagoResponse,
  PagoCreate,
  PagoUpdate,
  PagoListItem,
  ProveedorListItem,
  MetodoPago,
  PropuestaPago,
} from '@shared/api/api'

type CreatePagoMutation = UseMutationResult<PagoResponse, Error, PagoCreate>
type UpdatePagoMutation = UseMutationResult<PagoResponse, Error, { id: string; data: PagoUpdate }>

// c-26 (D1): mirrors FacturaForm's placeholder — a supplier id is never
// a valid label, soft-deleted or not.
const PROVEEDOR_NOMBRE_PLACEHOLDER = 'Proveedor no disponible'

interface FormErrors {
  proveedor?: string
  fecha?: string
  monto?: string
  metodo?: string
  backend?: string
}

interface PagoFormProps {
  pago?: PagoListItem
  proveedor?: ProveedorListItem | null
  onSuccess: (saved: PagoResponse) => void
  onCancel: () => void
  initialSelectedProveedor?: ProveedorListItem | null
  prefillFromProposal?: {
    propuesta: PropuestaPago
    selectedProveedor: ProveedorListItem
  } | null
  externalCreateMutation?: CreatePagoMutation
  externalUpdateMutation?: UpdatePagoMutation
}

interface FormState {
  fecha: string
  monto: string
  metodo: string
  comprobante_url: string | null
}

function initialState(pago?: PagoListItem): FormState {
  return {
    fecha: pago?.fecha ?? '',
    monto: pago ? String(pago.monto) : '',
    metodo: pago?.metodo ?? '',
    comprobante_url: (pago as (PagoListItem & { comprobante_url?: string | null }) | undefined)?.comprobante_url ?? null,
  }
}

const METODO_OPTIONS: { value: string; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'MERCADOPAGO', label: 'MercadoPago' },
  { value: 'OTRO', label: 'Otro' },
]

export function PagoForm({
  pago,
  proveedor: initialProveedor,
  onSuccess,
  onCancel,
  initialSelectedProveedor,
  prefillFromProposal,
  externalCreateMutation,
  externalUpdateMutation,
}: PagoFormProps) {
  const isEditMode = Boolean(pago)

  const [form, setForm] = useState<FormState>(() => initialState(pago))
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorListItem | null>(
    initialSelectedProveedor ?? initialProveedor ?? null,
  )

  useEffect(() => {
    if (initialSelectedProveedor && !selectedProveedor) {
      setSelectedProveedor(initialSelectedProveedor)
    }
  }, [initialSelectedProveedor, selectedProveedor])

  const prefillConsumedRef = useRef(false)
  useEffect(() => {
    if (!prefillFromProposal || prefillConsumedRef.current) return
    prefillConsumedRef.current = true
    setForm((prev) => ({
      ...prev,
      fecha: prefillFromProposal.propuesta.fecha ?? '',
      monto:
        prefillFromProposal.propuesta.monto !== null &&
        prefillFromProposal.propuesta.monto !== undefined
          ? String(prefillFromProposal.propuesta.monto)
          : '',
      metodo: prefillFromProposal.propuesta.metodo ?? '',
    }))
    setSelectedProveedor(prefillFromProposal.selectedProveedor)
  }, [prefillFromProposal])

  const [errors, setErrors] = useState<FormErrors>({})
  // C-42 review fix (finding 2) — an ambiguous ("no pudimos confirmar")
  // outcome is its own state, never folded into `errors.backend`: this
  // endpoint does not dedupe, so the message points at the list instead of
  // offering a "safe" retry.
  const [ambiguousOutcome, setAmbiguousOutcome] = useState(false)

  const createMutationInternal = useCreatePago()
  const updateMutationInternal = useUpdatePago()
  const createMutation = externalCreateMutation ?? createMutationInternal
  const updateMutation = externalUpdateMutation ?? updateMutationInternal
  const isPending = createMutation.isPending || updateMutation.isPending

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
    if (!isEditMode && !selectedProveedor) {
      errs.proveedor = 'El proveedor es requerido.'
    }
    const montoNum = parseFloat(form.monto)
    if (!form.monto || isNaN(montoNum) || montoNum <= 0) {
      errs.monto = 'El monto debe ser mayor a cero.'
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
      errs.metodo = 'El método de pago es obligatorio.'
    }
    return errs
  }

  // C-42 review fix (finding 2) — classifies the failure via the shared
  // `classifyError` (no duplicated logic). An ambiguous outcome sets its
  // own state; a real rejection keeps exactly the prior behavior.
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
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    if (isEditMode && pago) {
      const updatePayload: PagoUpdate = {
        monto: parseFloat(form.monto),
        fecha: form.fecha,
        metodo: form.metodo as MetodoPago,
        comprobante_url: form.comprobante_url,
      }
      updateMutation.mutate(
        { id: pago.id, data: updatePayload },
        {
          onSuccess: (updated) => {
            setErrors({})
            setAmbiguousOutcome(false)
            onSuccess(updated)
          },
          onError: handleSubmitError,
        },
      )
    } else {
      const createPayload: PagoCreate = {
        proveedor_id: selectedProveedor!.id,
        monto: parseFloat(form.monto),
        fecha: form.fecha,
        metodo: form.metodo as MetodoPago,
        comprobante_url: form.comprobante_url,
        ...(prefillConsumedRef.current ? { origen: 'IA' as const } : {}),
      }
      createMutation.mutate(createPayload, {
        onSuccess: (created) => {
          setErrors({})
          setAmbiguousOutcome(false)
          onSuccess(created)
        },
        onError: handleSubmitError,
      })
    }
  }

  return (
    <Card>
      <div className="mb-6 flex items-start justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold text-navy-800 dark:text-zinc-100">
          {isEditMode ? 'Editar pago' : 'Nuevo pago'}
        </h2>
        {/* c-26 (D2): additive top-right close control — Cancelar stays at
            the bottom. Same action, so a scrolled-past user still has an
            exit within view. */}
        <button
          type="button"
          aria-label="Cerrar formulario"
          onClick={onCancel}
          disabled={isPending}
          className="rounded-full p-2 text-navy-400 transition-colors hover:bg-cream-dark hover:text-navy-600 disabled:opacity-50 dark:text-zinc-500 dark:hover:bg-white/[0.04]"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
        {/* Proveedor */}
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-navy-700 dark:text-zinc-300">
            Proveedor
          </label>
          {isEditMode ? (
            <div
              data-testid="proveedor-readonly"
              className="rounded-xl border border-black/[0.06] bg-cream-dark/50 px-3 py-2.5 text-sm text-navy-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-zinc-300"
            >
              {/* c-26 (D1): NEVER fall back to pago?.proveedor_id — a
                  UUID is not a degraded name, it is noise. */}
              {initialProveedor?.nombre?.trim() || PROVEEDOR_NOMBRE_PLACEHOLDER}
            </div>
          ) : (
            <>
              <p
                role="note"
                className="text-xs text-navy-400 italic dark:text-zinc-500"
              >
                El pago se asocia al proveedor, no a una factura específica.
              </p>
              <div className="relative">
                <SupplierSearch
                  value={selectedProveedor}
                  onChange={(p) => {
                    setSelectedProveedor(p)
                    if (p) {
                      setErrors((prev) => {
                        const next = { ...prev }
                        delete next.proveedor
                        return next
                      })
                    }
                  }}
                  placeholder="Buscar proveedor…"
                  disabled={false}
                />
              </div>
            </>
          )}
          {errors.proveedor && (
            <span role="alert" className="text-xs font-medium text-danger">
              {errors.proveedor}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <InputField
            label="Fecha"
            id="fecha"
            name="fecha"
            type="date"
            value={form.fecha}
            onChange={handleChange}
            error={errors.fecha}
            required
          />

          <InputField
            label="Monto"
            id="monto"
            name="monto"
            type="number"
            min="0.01"
            step="0.01"
            value={form.monto}
            onChange={handleChange}
            error={errors.monto}
            required
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="metodo" className="text-sm font-medium text-navy-700 dark:text-zinc-300">
              Método de pago
            </label>
            <select
              id="metodo"
              name="metodo"
              value={form.metodo}
              onChange={handleChange}
              aria-required="true"
              aria-invalid={Boolean(errors.metodo)}
              aria-describedby={errors.metodo ? 'metodo-error' : undefined}
              className="w-full rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 text-sm text-navy-800 transition-all duration-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
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

        {/* Comprobante upload */}
        <div>
          <FileUploadField
            tipo="comprobante"
            onUrlChange={(url) => setForm((prev) => ({ ...prev, comprobante_url: url }))}
            currentUrl={form.comprobante_url}
          />
        </div>

        {errors.backend && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {errors.backend}
          </p>
        )}

        {/* C-42 review fix (finding 2) — ambiguous outcome: this endpoint
            does NOT dedupe, so the copy must never say retrying is safe.
            `role="status"` (not "alert") — mirrors VentaForm's convention
            for a non-failure, unconfirmed state. */}
        {ambiguousOutcome && (
          <div
            role="status"
            aria-live="polite"
            className="rounded-xl bg-warning-bg px-4 py-3 text-sm text-warning ring-1 ring-warning/10"
          >
            <p>
              No pudimos confirmar si el pago se guardó. Esta operación no queda identificada para
              evitar duplicados, así que antes de reintentar,{' '}
              <Link to="/pagos" className="font-semibold underline">
                revisá el listado de pagos
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
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-navy-600 transition-colors hover:bg-cream-dark disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-full bg-navy-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] disabled:opacity-50 dark:bg-accent-500 dark:hover:bg-accent-600"
          >
            {isPending ? 'Guardando…' : 'Guardar'}
          </button>
        </div>
      </form>
    </Card>
  )
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
  return 'Error al guardar el pago.'
}

export default PagoForm
