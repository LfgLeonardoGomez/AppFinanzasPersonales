/**
 * FacturasFilters — filter controls for the invoice list.
 *
 * Supports: supplier (via SupplierSearch), estado (PENDIENTE/PARCIAL/PAGADA), date range.
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

const ESTADO_OPTIONS: { value: EstadoFactura; label: string }[] = [
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

  function handleEstadoChange(e: ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value as EstadoFactura | ''
    const next: FacturasFiltersType = { ...filters, page: 1 }
    if (val) {
      next.estado = val as EstadoFactura
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
    <div role="search" aria-label="Filtros de facturas">
      {/* Supplier filter — reuses the shared SupplierSearch (D-C09-5) */}
      <div>
        <SupplierSearch
          value={selectedProveedor}
          onChange={handleProveedorChange}
          placeholder="Filtrar por proveedor…"
        />
      </div>

      {/* Estado filter */}
      <div>
        <label htmlFor="filter-estado">Estado</label>
        <select
          id="filter-estado"
          aria-label="Estado"
          value={filters.estado ?? ''}
          onChange={handleEstadoChange}
        >
          <option value="">Todos los estados</option>
          {ESTADO_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Date range filters */}
      <div>
        <label htmlFor="filter-fecha-desde">Desde</label>
        <input
          id="filter-fecha-desde"
          type="date"
          value={filters.fecha_desde ?? ''}
          onChange={handleFechaDesdeChange}
          aria-label="Desde"
        />
      </div>

      <div>
        <label htmlFor="filter-fecha-hasta">Hasta</label>
        <input
          id="filter-fecha-hasta"
          type="date"
          value={filters.fecha_hasta ?? ''}
          onChange={handleFechaHastaChange}
          aria-label="Hasta"
        />
      </div>

      {/* Clear filters */}
      <button type="button" onClick={handleClear}>
        Limpiar filtros
      </button>
    </div>
  )
}

export default FacturasFilters
