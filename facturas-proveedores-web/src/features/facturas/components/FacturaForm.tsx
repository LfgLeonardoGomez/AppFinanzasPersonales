/**
 * FacturaForm — create/edit invoice form.
 *
 * Premium card layout with InputField wrappers. All original test contracts
 * preserved: label names, id="fecha_emision", data-testid="proveedor-readonly",
 * button names, alert roles.
 */
import { useState, useEffect, useRef, type FormEvent, type ChangeEvent } from 'react'
import { X } from 'lucide-react'
import { SupplierSearch } from '@shared/components/SupplierSearch/SupplierSearch'
import { ItemsEditor } from './ItemsEditor'
import { FileUploadField } from './FileUploadField'
import { useCreateFactura, useUpdateFactura } from '../api/facturasHooks'
import type { UseMutationResult } from '@tanstack/react-query'
import { getTodayUTC3 } from '@shared/utils/date'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import type {
  FacturaResponse,
  FacturaCreate,
  FacturaUpdate,
  ProveedorListItem,
  FacturaItemCreate,
  PropuestaFactura,
} from '@shared/api/api'

type CreateFacturaMutation = UseMutationResult<FacturaResponse, Error, FacturaCreate>
type UpdateFacturaMutation = UseMutationResult<FacturaResponse, Error, { id: string; data: FacturaUpdate }>

// c-26 (D1): a supplier id is never a valid label. When no name is
// available (not passed, or the supplier was soft-deleted upstream),
// show this neutral placeholder instead of falling back to the id.
const PROVEEDOR_NOMBRE_PLACEHOLDER = 'Proveedor no disponible'

interface FormErrors {
  proveedor?: string
  fecha_emision?: string
  monto_total?: string
  backend?: string
}

interface FacturaFormProps {
  factura?: FacturaResponse
  proveedor?: ProveedorListItem | null
  onSuccess: (saved: FacturaResponse) => void
  onCancel: () => void
  initialSelectedProveedor?: ProveedorListItem | null
  prefillFromProposal?: {
    propuesta: PropuestaFactura
    selectedProveedor: ProveedorListItem
  } | null
  externalCreateMutation?: CreateFacturaMutation
  externalUpdateMutation?: UpdateFacturaMutation
}

interface FormState {
  fecha_emision: string
  monto_total: string
  numero: string
  fecha_vencimiento: string
  archivo_url: string | null
  items: FacturaItemCreate[]
}

function initialState(factura?: FacturaResponse): FormState {
  return {
    fecha_emision: factura?.fecha_emision ?? '',
    monto_total: factura ? String(factura.monto_total) : '',
    numero: factura?.numero ?? '',
    fecha_vencimiento: factura?.fecha_vencimiento ?? '',
    archivo_url: factura?.archivo_url ?? null,
    items: factura?.items?.map((item) => ({
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precio_unitario: item.precio_unitario,
    })) ?? [],
  }
}

export function FacturaForm({
  factura,
  proveedor: initialProveedor,
  onSuccess,
  onCancel,
  initialSelectedProveedor,
  prefillFromProposal,
  externalCreateMutation,
  externalUpdateMutation,
}: FacturaFormProps) {
  const isEditMode = Boolean(factura)

  const [form, setForm] = useState<FormState>(() => initialState(factura))
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
      numero: prefillFromProposal.propuesta.numero ?? '',
      fecha_emision: prefillFromProposal.propuesta.fecha_emision ?? '',
      monto_total:
        prefillFromProposal.propuesta.monto_total !== null &&
        prefillFromProposal.propuesta.monto_total !== undefined
          ? String(prefillFromProposal.propuesta.monto_total)
          : '',
    }))
    setSelectedProveedor(prefillFromProposal.selectedProveedor)
  }, [prefillFromProposal])

  const [errors, setErrors] = useState<FormErrors>({})
  const [itemsSumMismatchAfterSave, setItemsSumMismatchAfterSave] = useState(false)

  const createMutationInternal = useCreateFactura()
  const updateMutationInternal = useUpdateFactura()
  const createMutation = externalCreateMutation ?? createMutationInternal
  const updateMutation = externalUpdateMutation ?? updateMutationInternal
  const isPending = createMutation.isPending || updateMutation.isPending

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
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
    if (!selectedProveedor) {
      errs.proveedor = 'El proveedor es requerido.'
    }
    const montoNum = parseFloat(form.monto_total)
    if (!form.monto_total || isNaN(montoNum) || montoNum <= 0) {
      errs.monto_total = 'El monto total debe ser mayor a cero.'
    }
    if (!form.fecha_emision) {
      errs.fecha_emision = 'La fecha de emisión es requerida.'
    } else {
      const today = getTodayUTC3()
      if (form.fecha_emision > today) {
        errs.fecha_emision = 'La fecha de emisión no puede ser futura.'
      }
    }
    return errs
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setItemsSumMismatchAfterSave(false)

    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const basePayload = {
      fecha_emision: form.fecha_emision,
      monto_total: parseFloat(form.monto_total),
      numero: form.numero.trim() || null,
      fecha_vencimiento: form.fecha_vencimiento || null,
      archivo_url: form.archivo_url,
      ...(form.items.length > 0 ? { items: form.items } : {}),
    }

    if (isEditMode && factura) {
      const updatePayload: FacturaUpdate = basePayload
      updateMutation.mutate(
        { id: factura.id, data: updatePayload },
        {
          onSuccess: (updated) => {
            setErrors({})
            if (updated.items_sum_mismatch) setItemsSumMismatchAfterSave(true)
            onSuccess(updated)
          },
          onError: () => {
            setErrors({ backend: 'Error al actualizar la factura.' })
          },
        },
      )
    } else {
      const createPayload: FacturaCreate = {
        proveedor_id: selectedProveedor!.id,
        ...basePayload,
        ...(prefillConsumedRef.current ? { origen: 'IA' as const } : {}),
      }
      createMutation.mutate(createPayload, {
        onSuccess: (created) => {
          setErrors({})
          if (created.items_sum_mismatch) setItemsSumMismatchAfterSave(true)
          onSuccess(created)
        },
        onError: () => {
          setErrors({ backend: 'Error al crear la factura.' })
        },
      })
    }
  }

  const anyError = errors.proveedor ?? errors.fecha_emision ?? errors.monto_total

  return (
    <Card>
      <div className="mb-6 flex items-start justify-between gap-3">
        <h2 className="font-serif text-xl font-semibold text-navy-800 dark:text-zinc-100">
          {isEditMode ? 'Editar factura' : 'Nueva factura'}
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
              {/* c-26 (D1): NEVER fall back to factura?.proveedor_id — a
                  UUID is not a degraded name, it is noise. */}
              {initialProveedor?.nombre?.trim() || PROVEEDOR_NOMBRE_PLACEHOLDER}
            </div>
          ) : (
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
          )}
          {errors.proveedor && (
            <span role="alert" className="text-xs font-medium text-danger">
              {errors.proveedor}
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <InputField
            label="Fecha de emisión"
            id="fecha_emision"
            name="fecha_emision"
            type="date"
            value={form.fecha_emision}
            onChange={handleChange}
            error={errors.fecha_emision}
            required
          />

          <InputField
            label="Monto total"
            id="monto_total"
            name="monto_total"
            type="number"
            min="0.01"
            step="0.01"
            value={form.monto_total}
            onChange={handleChange}
            error={errors.monto_total}
            required
          />

          <InputField
            label="Número de factura (opcional)"
            id="numero"
            name="numero"
            type="text"
            value={form.numero}
            onChange={handleChange}
            placeholder="Ej: FAC-001"
          />

          <InputField
            label="Fecha de vencimiento (opcional)"
            id="fecha_vencimiento"
            name="fecha_vencimiento"
            type="date"
            value={form.fecha_vencimiento}
            onChange={handleChange}
          />
        </div>

        {/* Items */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium text-navy-700 dark:text-zinc-300">
            Ítems (opcional)
          </label>
          <div className="rounded-xl border border-black/[0.06] bg-white p-3 dark:border-white/10 dark:bg-espresso">
            <ItemsEditor
              items={form.items}
              montoTotal={parseFloat(form.monto_total) || 0}
              onChange={(items) => setForm((prev) => ({ ...prev, items }))}
            />
          </div>
        </div>

        {/* File upload */}
        <div>
          <FileUploadField
            tipo="factura"
            onUrlChange={(url) => setForm((prev) => ({ ...prev, archivo_url: url }))}
            currentUrl={form.archivo_url}
          />
        </div>

        {/* Backend error / mismatch */}
        {errors.backend && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {errors.backend}
          </p>
        )}

        {!anyError && itemsSumMismatchAfterSave && (
          <p role="alert" aria-live="polite" className="text-sm text-warning">
            El servidor detectó una diferencia entre la suma de ítems y el monto total.
          </p>
        )}

        {/* Actions */}
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

export default FacturaForm
