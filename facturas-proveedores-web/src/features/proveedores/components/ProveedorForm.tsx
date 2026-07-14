/**
 * ProveedorForm — create/edit supplier form.
 *
 * Premium card layout with InputField wrappers. All original semantics
 * preserved for test compatibility (label names, button names, error texts).
 */
import { useState, type FormEvent, type ChangeEvent } from 'react'
import { useCreateProveedor, useUpdateProveedor } from '../api/proveedoresHooks'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import type { Proveedor, ProveedorCreate, ProveedorUpdate, Categoria } from '@shared/api/api'

const CUIT_REGEX = /^\d{2}-\d{8}-\d{1}$/

const CATEGORIAS: { value: Categoria; label: string }[] = [
  { value: 'INSUMO', label: 'Insumo' },
  { value: 'SERVICIO', label: 'Servicio' },
  { value: 'OTRO', label: 'Otro' },
]

interface ProveedorFormProps {
  proveedor?: Proveedor
  onSuccess: (saved: Proveedor) => void
  onCancel: () => void
}

interface FormState {
  nombre: string
  cuit: string
  telefono: string
  categoria: Categoria
  notas: string
}

interface FormErrors {
  nombre?: string
  cuit?: string
  backend?: string
}

function initialState(proveedor?: Proveedor): FormState {
  return {
    nombre: proveedor?.nombre ?? '',
    cuit: proveedor?.cuit ?? '',
    telefono: proveedor?.telefono ?? '',
    categoria: proveedor?.categoria ?? 'OTRO',
    notas: proveedor?.notas ?? '',
  }
}

export function ProveedorForm({ proveedor, onSuccess, onCancel }: ProveedorFormProps) {
  const [form, setForm] = useState<FormState>(() => initialState(proveedor))
  const [errors, setErrors] = useState<FormErrors>({})
  const [cuitTouched, setCuitTouched] = useState(false)

  const createMutation = useCreateProveedor()
  const updateMutation = useUpdateProveedor()

  const isEditMode = Boolean(proveedor)
  const isPending = createMutation.isPending || updateMutation.isPending

  function handleChange(
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) {
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
    if (!form.nombre.trim()) {
      errs.nombre = 'El nombre es requerido.'
    }
    return errs
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    const payload = {
      nombre: form.nombre.trim(),
      cuit: form.cuit.trim() || null,
      telefono: form.telefono.trim() || null,
      categoria: form.categoria,
      notas: form.notas.trim() || null,
    }

    if (isEditMode && proveedor) {
      const updatePayload: ProveedorUpdate = payload
      updateMutation.mutate(
        { id: proveedor.id, data: updatePayload },
        {
          onSuccess: (updated) => {
            setErrors({})
            onSuccess(updated)
          },
          onError: () => {
            setErrors({ backend: 'Error al actualizar el proveedor.' })
          },
        },
      )
    } else {
      const createPayload: ProveedorCreate = payload
      createMutation.mutate(createPayload, {
        onSuccess: (created) => {
          setErrors({})
          onSuccess(created)
        },
        onError: () => {
          setErrors({ backend: 'Error al crear el proveedor.' })
        },
      })
    }
  }

  return (
    <Card>
      <h2 className="mb-6 font-serif text-xl font-semibold text-navy-800 dark:text-zinc-100">
        {isEditMode ? 'Editar proveedor' : 'Nuevo proveedor'}
      </h2>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <InputField
          label="Nombre"
          id="nombre"
          name="nombre"
          type="text"
          value={form.nombre}
          onChange={handleChange}
          error={errors.nombre}
          required
        />

        <InputField
          label="CUIT"
          id="cuit"
          name="cuit"
          type="text"
          value={form.cuit}
          onChange={handleChange}
          onBlur={() => setCuitTouched(true)}
          placeholder="XX-XXXXXXXX-X"
          hint={
            cuitTouched && form.cuit && !CUIT_REGEX.test(form.cuit)
              ? 'Formato esperado: XX-XXXXXXXX-X'
              : 'Formato: XX-XXXXXXXX-X (opcional)'
          }
        />

        <InputField
          label="Teléfono"
          id="telefono"
          name="telefono"
          type="text"
          value={form.telefono}
          onChange={handleChange}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="categoria" className="text-sm font-medium text-navy-700 dark:text-zinc-300">
            Categoría
          </label>
          <select
            id="categoria"
            name="categoria"
            value={form.categoria}
            onChange={handleChange}
            className="w-full rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 text-sm text-navy-800 transition-all duration-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="notas" className="text-sm font-medium text-navy-700 dark:text-zinc-300">
            Notas
          </label>
          <textarea
            id="notas"
            name="notas"
            value={form.notas}
            onChange={handleChange}
            rows={3}
            className="w-full rounded-xl border border-black/[0.06] bg-white px-3 py-2.5 text-sm text-navy-800 transition-all duration-200 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
          />
        </div>

        {errors.backend && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {errors.backend}
          </p>
        )}

        <div className="mt-2 flex items-center gap-3">
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

export default ProveedorForm
