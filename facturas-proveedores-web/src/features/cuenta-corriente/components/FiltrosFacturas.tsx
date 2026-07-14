/**
 * FiltrosFacturas — premium filter controls for the cuenta-corriente table.
 *
 * Preserves all test contracts:
 *  - role="group" aria-label="Filtros de facturas"
 *  - id="filtro-estado" + label "Estado"
 *  - id="filtro-fecha-desde" + label "Fecha desde"
 *  - id="filtro-fecha-hasta" + label "Fecha hasta"
 *  - "Limpiar filtros" button
 */
import type { ChangeEvent } from 'react'
import type {
  FiltrosFacturas as FiltrosFacturasType,
  EstadoFactura,
} from '@shared/api/api'

interface FiltrosFacturasProps {
  filters: FiltrosFacturasType
  onChange: (next: FiltrosFacturasType) => void
}

const ESTADO_OPTIONS: { value: EstadoFactura | ''; label: string }[] = [
  { value: '', label: 'Todos' },
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'PARCIAL', label: 'Parcial' },
  { value: 'PAGADA', label: 'Pagada' },
]

function isFiltered(filters: FiltrosFacturasType): boolean {
  return Boolean(filters.estado) || Boolean(filters.fecha_desde) || Boolean(filters.fecha_hasta)
}

export function FiltrosFacturas({ filters, onChange }: FiltrosFacturasProps) {
  function handleEstado(e: ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value as EstadoFactura | ''
    if (value === '') {
      const next: FiltrosFacturasType = { ...filters }
      delete next.estado
      onChange(next)
      return
    }
    onChange({ ...filters, estado: value })
  }

  function handleFechaDesde(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    const next: FiltrosFacturasType = { ...filters }
    if (value) {
      next.fecha_desde = value
    } else {
      delete next.fecha_desde
    }
    onChange(next)
  }

  function handleFechaHasta(e: ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    const next: FiltrosFacturasType = { ...filters }
    if (value) {
      next.fecha_hasta = value
    } else {
      delete next.fecha_hasta
    }
    onChange(next)
  }

  function handleClear() {
    onChange({})
  }

  return (
    <div
      role="group"
      aria-label="Filtros de facturas"
      className="flex flex-wrap items-end gap-3 rounded-xl border border-black/[0.04] bg-cream-dark/20 p-3 dark:border-white/5 dark:bg-white/[0.02]"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-estado" className="text-xs font-medium text-navy-500 dark:text-zinc-400">
          Estado
        </label>
        <select
          id="filtro-estado"
          value={filters.estado ?? ''}
          onChange={handleEstado}
          className="rounded-lg border border-black/[0.06] bg-white px-2 py-1.5 text-sm text-navy-800 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
        >
          {ESTADO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-fecha-desde" className="text-xs font-medium text-navy-500 dark:text-zinc-400">
          Fecha desde
        </label>
        <input
          id="filtro-fecha-desde"
          type="date"
          value={filters.fecha_desde ?? ''}
          onChange={handleFechaDesde}
          className="rounded-lg border border-black/[0.06] bg-white px-2 py-1.5 text-sm text-navy-800 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="filtro-fecha-hasta" className="text-xs font-medium text-navy-500 dark:text-zinc-400">
          Fecha hasta
        </label>
        <input
          id="filtro-fecha-hasta"
          type="date"
          value={filters.fecha_hasta ?? ''}
          onChange={handleFechaHasta}
          className="rounded-lg border border-black/[0.06] bg-white px-2 py-1.5 text-sm text-navy-800 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-100 dark:border-white/10 dark:bg-espresso dark:text-zinc-100 dark:focus:ring-accent-500/20"
        />
      </div>

      {isFiltered(filters) && (
        <button
          type="button"
          onClick={handleClear}
          className="mb-0.5 self-end text-sm font-semibold text-navy-500 underline-offset-2 transition-colors hover:text-navy-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Limpiar filtros
        </button>
      )}
    </div>
  )
}

export default FiltrosFacturas
