/**
 * FacturasFilters — filter controls for the invoice list.
 *
 * Supports: supplier (via SupplierSearch), estado (PENDIENTE/PARCIAL/PAGADA
 * — as a pill group, per the redesign), date range.
 * D-C09-4: filters are kept in URL search params by the parent page.
 * D-C09-5: reuses the shared SupplierSearch component.
 *
 * The estado filter value is passed directly to the API; the backend resolves it
 * in Python after FIFO (RN-FAC-09). The frontend does NOT re-filter the response.
 */
import { type ChangeEvent } from 'react'
import { SupplierSearch } from '@shared/components/SupplierSearch/SupplierSearch'
import type { FacturasFilters as FacturasFiltersType, EstadoFactura, ProveedorListItem } from '@shared/api/api'
import { useState } from 'react'

const ESTADO_PILLS: { value: EstadoFactura | null; label: string }[] = [
  { value: null, label: 'Todas' },
  { value: 'PENDIENTE', label: 'Pendiente' },
  { value: 'PARCIAL', label: 'Parcial' },
  { value: 'PAGADA', label: 'Pagada' },
]

interface FacturasFiltersProps {
  filters: FacturasFiltersType
  onChange: (filters: FacturasFiltersType) => void
}

export function FacturasFilters({ filters, onChange }: FacturasFiltersProps) {
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorListItem | null>(null)

  function handleProveedorChange(proveedor: ProveedorListItem | null) {
    setSelectedProveedor(proveedor)
    const next: FacturasFiltersType = { ...filters, page: 1 }
    if (proveedor) {
      next.proveedor_id = proveedor.id
    } else {
      delete next.proveedor_id
    }
    onChange(next)
  }

  function handleEstadoPillClick(value: EstadoFactura | null) {
    const next: FacturasFiltersType = { ...filters, page: 1 }
    if (value) {
      next.estado = value
    } else {
      delete next.estado
    }
    onChange(next)
  }

  function handleFechaDesdeChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    const next: FacturasFiltersType = { ...filters, page: 1 }
    if (val) {
      next.fecha_desde = val
    } else {
      delete next.fecha_desde
    }
    onChange(next)
  }

  function handleFechaHastaChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    const next: FacturasFiltersType = { ...filters, page: 1 }
    if (val) {
      next.fecha_hasta = val
    } else {
      delete next.fecha_hasta
    }
    onChange(next)
  }

  function handleClear() {
    setSelectedProveedor(null)
    onChange({})
  }

  return (
    <div role="search" aria-label="Filtros de facturas" className="flex flex-col gap-3 font-inter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Estado filter — pill group (DESIGN_SYSTEM.md: baja densidad, sin selects) */}
        <div role="group" aria-label="Estado" className="flex flex-wrap gap-2">
          {ESTADO_PILLS.map((opt) => {
            const isActive = opt.value === null ? !filters.estado : filters.estado === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleEstadoPillClick(opt.value)}
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

        {/* Supplier filter — reuses the shared SupplierSearch (D-C09-5) */}
        <div className="min-w-[220px] flex-1 sm:flex-none">
          <SupplierSearch
            value={selectedProveedor}
            onChange={handleProveedorChange}
            placeholder="Filtrar por proveedor…"
          />
        </div>
      </div>

      {/* Date range filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-fecha-desde" className="mb-1 block text-xs font-medium text-ink-soft">
            Desde
          </label>
          <input
            id="filter-fecha-desde"
            type="date"
            value={filters.fecha_desde ?? ''}
            onChange={handleFechaDesdeChange}
            aria-label="Desde"
            className="rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>

        <div>
          <label htmlFor="filter-fecha-hasta" className="mb-1 block text-xs font-medium text-ink-soft">
            Hasta
          </label>
          <input
            id="filter-fecha-hasta"
            type="date"
            value={filters.fecha_hasta ?? ''}
            onChange={handleFechaHastaChange}
            aria-label="Hasta"
            className="rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>

        {/* Clear filters */}
        <button
          type="button"
          onClick={handleClear}
          className="rounded-pill px-4 py-2 text-xs font-semibold text-ink-soft-2 transition-colors hover:bg-surface-alt"
        >
          Limpiar filtros
        </button>
      </div>
    </div>
  )
}

export default FacturasFilters
