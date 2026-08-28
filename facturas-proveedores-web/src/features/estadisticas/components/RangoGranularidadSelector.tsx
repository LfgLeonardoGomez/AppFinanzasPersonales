/**
 * Shared range + granularity control for the estadísticas views (C-38).
 *
 * Purely presentational and fully controlled: it owns no state. Where that
 * state lives — the route's search params — is `useRangoGranularidad`'s job
 * (design.md D3).
 *
 * Styling mirrors `VentasFilters`: the same pill group and the same date
 * inputs, using design-system tokens only. No new visual language, and no
 * hardcoded colors (the design-system guard scans this directory).
 */
import { type ChangeEvent } from 'react'
import type { Granularidad } from '@shared/api/api'
import type { RangoEstadisticas } from '../utils/rangos'

const GRANULARIDAD_PILLS: { value: Granularidad; label: string }[] = [
  { value: 'dia', label: 'Día' },
  { value: 'semana', label: 'Semana' },
  { value: 'mes', label: 'Mes' },
]

interface RangoGranularidadSelectorProps {
  rango: RangoEstadisticas
  onChange: (rango: RangoEstadisticas) => void
}

export function RangoGranularidadSelector({ rango, onChange }: RangoGranularidadSelectorProps) {
  function handleGranularidad(value: Granularidad) {
    onChange({ ...rango, granularidad: value })
  }

  function handleDesde(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...rango, desde: e.target.value })
  }

  function handleHasta(e: ChangeEvent<HTMLInputElement>) {
    onChange({ ...rango, hasta: e.target.value })
  }

  return (
    <div
      role="search"
      aria-label="Rango y granularidad"
      className="flex flex-wrap items-end gap-3 font-inter"
    >
      <div role="group" aria-label="Granularidad" className="flex flex-wrap gap-2">
        {GRANULARIDAD_PILLS.map((opt) => {
          const isActive = rango.granularidad === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              aria-pressed={isActive}
              onClick={() => handleGranularidad(opt.value)}
              className={`rounded-pill px-4 py-2 text-xs font-semibold transition-colors duration-160 ${
                isActive
                  ? 'bg-violet-500 text-white'
                  : 'bg-surface text-ink-soft-2 ring-1 ring-border-violet-soft hover:bg-surface-alt'
              }`}
            >
              {opt.label}
            </button>
          )
        })}
      </div>

      <div>
        <label htmlFor="estadisticas-desde" className="mb-1 block text-xs font-medium text-ink-soft">
          Desde
        </label>
        <input
          id="estadisticas-desde"
          type="date"
          value={rango.desde}
          onChange={handleDesde}
          aria-label="Desde"
          className="rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
        />
      </div>

      <div>
        <label htmlFor="estadisticas-hasta" className="mb-1 block text-xs font-medium text-ink-soft">
          Hasta
        </label>
        <input
          id="estadisticas-hasta"
          type="date"
          value={rango.hasta}
          onChange={handleHasta}
          aria-label="Hasta"
          className="rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
        />
      </div>
    </div>
  )
}

export default RangoGranularidadSelector
