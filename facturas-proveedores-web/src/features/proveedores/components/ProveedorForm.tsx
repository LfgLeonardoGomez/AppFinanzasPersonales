/**
 * ProveedorForm — create/edit supplier form (redesign: design/screen-proveedores
 * — "Proveedor Form" handoff: Nombre, CUIT, Teléfono, Notas, Guardar/Cancelar,
 * Eliminar only in edit mode).
 *
 * DEVIATION from the Claude Design handoff: the mock shows an "Email de
 * contacto" field. The real Proveedor model (knowledge-base/04_modelo_de_datos.md,
 * backend app/models/proveedor.py, `@shared/api/api` `Proveedor` type) has NO
 * `email` field — only `nombre`, `cuit`, `telefono`, `categoria`, `notas`.
 * Inventing a persisted field the backend does not support would violate
 * "never invent a field" — so this form keeps `categoria` (the real field)
 * instead of an `email` input. See the redesign report for detail.
 *
 * All original test contracts preserved (label names, button names, error
 * texts). New: an optional `onDeleteClick` prop renders "Eliminar proveedor"
 * in edit mode only (Proveedor Form handoff) — the caller (ProveedorDialog)
 * owns the actual delete confirmation + mutation, reusing the existing
 * DeleteProveedorDialog + useDeleteProveedor (no new API).
 */
import { useState, type FormEvent, type ChangeEvent } from 'react'
import { useCreateProveedor, useUpdateProveedor } from '../api/proveedoresHooks'
import { InputField } from '@shared/components/InputField/InputField'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
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
  /** Renders "Eliminar proveedor" (edit mode only) when provided. */
  onDeleteClick?: () => void
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

export function ProveedorForm({ proveedor, onSuccess, onCancel, onDeleteClick }: ProveedorFormProps) {
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
      <h2 className="mb-6 font-inter text-xl font-bold tracking-tight text-ink dark:text-zinc-100">
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
          <label htmlFor="categoria" className="text-sm font-medium text-ink">
            Categoría
          </label>
          <select
            id="categoria"
            name="categoria"
            value={form.categoria}
            onChange={handleChange}
            className="w-full rounded-card-sm border border-border-subtle bg-surface px-3 py-2.5 text-sm text-ink transition-all duration-200 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          >
            {CATEGORIAS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="notas" className="text-sm font-medium text-ink">
            Notas
          </label>
          <textarea
            id="notas"
            name="notas"
            value={form.notas}
            onChange={handleChange}
            rows={3}
            placeholder="Condiciones de pago, referencias, etc."
            className="w-full rounded-card-sm border border-border-subtle bg-surface px-3 py-2.5 text-sm text-ink placeholder:text-ink-soft transition-all duration-200 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>

        {errors.backend && (
          <p role="alert" aria-live="assertive" className="text-sm text-danger">
            {errors.backend}
          </p>
        )}

        <div className="mt-2 flex items-center gap-3">
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button type="submit" variant="primary" loading={isPending}>
            Guardar
          </Button>
        </div>

        {isEditMode && onDeleteClick && (
          <Button
            type="button"
            variant="danger"
            fullWidth
            onClick={onDeleteClick}
            disabled={isPending}
          >
            Eliminar proveedor
          </Button>
        )}
      </form>
    </Card>
  )
}

export default ProveedorForm
