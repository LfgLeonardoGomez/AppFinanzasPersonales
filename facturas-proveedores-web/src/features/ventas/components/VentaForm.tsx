/**
 * VentaForm — create/edit sales form (counter form), C-34.
 *
 * INVARIANT (design.md D1, RN-VTA-03): the customer field is rendered if
 * and only if `forma_pago === 'CUENTA_CORRIENTE'`. It is REMOVED FROM THE
 * DOM — not hidden — for every other payment method, and `cliente` is
 * cleared from form state on the same tick as the payment-method change.
 * This mirrors the backend invariant `cliente_id IS NOT NULL ⟺
 * forma_pago = CUENTA_CORRIENTE`, enforced in `venta_service._validar_par`
 * and a database CHECK.
 *
 * D10: the form opens on today's date computed in
 * `America/Argentina/Buenos_Aires` (`getTodayInArgentina`), not the
 * browser's local clock, with initial focus on the amount field.
 *
 * D4/D5: on edit, `VentaUpdate.cliente_id` is included ONLY when the sale
 * stays on `CUENTA_CORRIENTE` with a customer selected — never sent as
 * `null`. Leaving cuenta corriente sends only the new `forma_pago`; the
 * caller passes `wasOnAccount` to `useUpdateVenta` so cross-feature cache
 * invalidation still fires (ventasHooks.ts).
 *
 * D11: client validation (amount > 0, date not future, customer required
 * for a fiado) exists for usability only — the backend's `422 detail` is
 * always what gets shown on a rejected submission.
 */
import { useState, useEffect, type FormEvent, type ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { ClienteAutocomplete, type ClienteRef } from '@shared/components/ClienteAutocomplete/ClienteAutocomplete'
import { DeudaDesapareceDialog } from './DeudaDesapareceDialog'
import { useCreateVenta, useUpdateVenta } from '../api/ventasHooks'
import type { UseMutationResult } from '@tanstack/react-query'
import { getTodayInArgentina } from '@shared/utils/date'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import type { Venta, VentaCreate, VentaUpdate, FormaPago } from '@shared/api/api'

type CreateVentaMutation = UseMutationResult<Venta, Error, VentaCreate>
type UpdateVentaMutation = UseMutationResult<
  Venta,
  Error,
  { id: string; data: VentaUpdate; wasOnAccount?: boolean }
>

interface FormErrors {
  monto?: string
  fecha?: string
  cliente?: string
  backend?: string
}

interface VentaFormProps {
  venta?: Venta
  /** Existing customer to preselect in edit mode (name resolved by the caller). */
  clienteInicial?: ClienteRef | null
  onSuccess: (saved: Venta) => void
  onCancel: () => void
  externalCreateMutation?: CreateVentaMutation
  externalUpdateMutation?: UpdateVentaMutation
}

interface FormState {
  fecha: string
  monto: string
  forma_pago: FormaPago
  notas: string
}

const FORMA_PAGO_OPTIONS: { value: FormaPago; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'CUENTA_CORRIENTE', label: 'Cuenta corriente' },
  { value: 'OTRO', label: 'Otro' },
]

function initialState(venta?: Venta): FormState {
  return {
    fecha: venta?.fecha ?? getTodayInArgentina(),
    monto: venta ? String(venta.monto) : '',
    forma_pago: venta?.forma_pago ?? 'EFECTIVO',
    notas: venta?.notas ?? '',
  }
}

export function VentaForm({
  venta,
  clienteInicial,
  onSuccess,
  onCancel,
  externalCreateMutation,
  externalUpdateMutation,
}: VentaFormProps) {
  const isEditMode = Boolean(venta)
  // D5/D7 contract: the response to a PATCH reflects only the sale's NEW
  // state — it can't tell `useUpdateVenta` whether the sale used to be on
  // account. The form knows, from the venta it loaded, so it passes it along.
  const wasOnAccount = venta?.forma_pago === 'CUENTA_CORRIENTE'

  const [form, setForm] = useState<FormState>(() => initialState(venta))
  const [cliente, setCliente] = useState<ClienteRef | null>(
    wasOnAccount ? (clienteInicial ?? null) : null,
  )
  const [errors, setErrors] = useState<FormErrors>({})
  // design.md D5, spec "moving a sale out of cuenta corriente warns before
  // saving": when this edit's PATCH would leave a fiado, the warning must
  // appear BEFORE the request is sent. The payload is validated and staged
  // here; only confirming the dialog actually fires the mutation.
  const [pendingLeaveUpdate, setPendingLeaveUpdate] = useState<VentaUpdate | null>(null)

  // D10 — initial focus on the amount field.
  useEffect(() => {
    document.getElementById('monto')?.focus()
  }, [])

  const createMutationInternal = useCreateVenta()
  const updateMutationInternal = useUpdateVenta()
  const createMutation = externalCreateMutation ?? createMutationInternal
  const updateMutation = externalUpdateMutation ?? updateMutationInternal
  const isPending = createMutation.isPending || updateMutation.isPending

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    setForm((prev) => ({ ...prev, [name]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[name as keyof FormErrors]
      delete next.backend
      return next
    })
  }

  // D1 — switching away from CUENTA_CORRIENTE clears `cliente` on the same
  // tick as the payment-method change; the field then unmounts on the next
  // render because it's conditionally rendered, not CSS-hidden.
  function handleFormaPagoChange(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as FormaPago
    setForm((prev) => ({ ...prev, forma_pago: value }))
    if (value !== 'CUENTA_CORRIENTE') {
      setCliente(null)
    }
    setErrors((prev) => {
      const next = { ...prev }
      delete next.cliente
      delete next.backend
      return next
    })
  }

  function handleClienteChange(next: ClienteRef | null) {
    setCliente(next)
    if (next) {
      setErrors((prev) => {
        const rest = { ...prev }
        delete rest.cliente
        return rest
      })
    }
  }

  function validate(): FormErrors {
    const errs: FormErrors = {}
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
    if (form.forma_pago === 'CUENTA_CORRIENTE' && !cliente) {
      errs.cliente = 'Un fiado necesita un cliente: sin cliente, la deuda no es de nadie.'
    }
    return errs
  }

  function submitUpdate(payload: VentaUpdate) {
    if (!venta) return
    updateMutation.mutate(
      { id: venta.id, data: payload, wasOnAccount },
      {
        onSuccess: (updated) => {
          setErrors({})
          onSuccess(updated)
        },
        onError: (err: unknown) => {
          setErrors({ backend: extractBackendError(err) })
        },
      },
    )
  }

  function handleConfirmLeaveWarning() {
    if (!pendingLeaveUpdate) return
    const payload = pendingLeaveUpdate
    setPendingLeaveUpdate(null)
    submitUpdate(payload)
  }

  function handleCancelLeaveWarning() {
    setPendingLeaveUpdate(null)
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const clienteIdField =
      form.forma_pago === 'CUENTA_CORRIENTE' && cliente ? { cliente_id: cliente.id } : {}

    if (isEditMode && venta) {
      const updatePayload: VentaUpdate = {
        monto: form.monto,
        fecha: form.fecha,
        forma_pago: form.forma_pago,
        notas: form.notas || null,
        ...clienteIdField,
      }

      // design.md D5 — fires ONLY when this sale WAS on account and the edit
      // moves it away. Amount/date/notes-only edits that keep it on account
      // never reach this branch (task 8.6): the debt still exists and still
      // belongs to someone, so nothing needs confirming.
      if (wasOnAccount && form.forma_pago !== 'CUENTA_CORRIENTE') {
        setPendingLeaveUpdate(updatePayload)
        return
      }

      submitUpdate(updatePayload)
    } else {
      const createPayload: VentaCreate = {
        monto: form.monto,
        fecha: form.fecha,
        forma_pago: form.forma_pago,
        notas: form.notas || null,
        ...clienteIdField,
      }
      createMutation.mutate(createPayload, {
        onSuccess: (created) => {
          setErrors({})
          onSuccess(created)
        },
        onError: (err: unknown) => {
          setErrors({ backend: extractBackendError(err) })
        },
      })
    }
  }

  return (
    <Card>
      <div className="mb-6 flex items-start justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold text-navy-800 dark:text-zinc-100">
          {isEditMode ? 'Editar venta' : 'Nueva venta'}
        </h2>
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
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
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
            <label htmlFor="forma_pago" className="text-sm font-medium text-navy-700 dark:text-zinc-300">
              Forma de pago
            </label>
            <select
              id="forma_pago"
              name="forma_pago"
              value={form.forma_pago}
              onChange={handleFormaPagoChange}
              aria-required="true"
              className="w-full rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 text-sm text-navy-800 transition-all duration-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
            >
              {FORMA_PAGO_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* D1 — present ONLY for CUENTA_CORRIENTE, removed from the DOM
            otherwise (not CSS-hidden). */}
        {form.forma_pago === 'CUENTA_CORRIENTE' && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-navy-700 dark:text-zinc-300">
              Cliente
            </label>
            <ClienteAutocomplete
              value={cliente}
              onChange={handleClienteChange}
              placeholder="Buscar cliente…"
            />
            {errors.cliente && (
              <span role="alert" className="text-xs font-medium text-danger">
                {errors.cliente}
              </span>
            )}
          </div>
        )}

        {errors.backend && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {errors.backend}
          </p>
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

      {pendingLeaveUpdate && (
        <DeudaDesapareceDialog
          open={true}
          mode="leave"
          clienteNombre={clienteInicial?.nombre ?? ''}
          monto={venta?.monto ?? '0'}
          formaPagoNueva={pendingLeaveUpdate.forma_pago ?? form.forma_pago}
          onConfirm={handleConfirmLeaveWarning}
          onCancel={handleCancelLeaveWarning}
          isPending={updateMutation.isPending}
        />
      )}
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
  return 'Error al guardar la venta.'
}

export default VentaForm
