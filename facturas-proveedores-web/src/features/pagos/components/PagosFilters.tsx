/**
 * PagosFilters — filter controls for the payment list.
 *
 * Supports: supplier only (via SupplierSearch). No estado filter (RN-PAG-01:
 * Pago has no `estado`). No date range in MVP (D-C11-7).
 *
 * Filter state is kept in URL search params by the parent `PagosPage`.
 * Reuses the shared `SupplierSearch` (D-C11-2).
 */
import { useState } from 'react'
import { SupplierSearch } from '@shared/components/SupplierSearch/SupplierSearch'
import type { PagosFilters as PagosFiltersType, ProveedorListItem } from '@shared/api/api'

interface PagosFiltersProps {
  filters: PagosFiltersType
  onChange: (filters: PagosFiltersType) => void
}

export function PagosFilters({ filters, onChange }: PagosFiltersProps) {
  const [selectedProveedor, setSelectedProveedor] = useState<ProveedorListItem | null>(null)

  function handleProveedorChange(proveedor: ProveedorListItem | null) {
    setSelectedProveedor(proveedor)
    const next: PagosFiltersType = { ...filters, page: 1 }
    if (proveedor) {
      next.proveedor_id = proveedor.id
    } else {
      delete next.proveedor_id
    }
    onChange(next)
  }

  function handleClear() {
    setSelectedProveedor(null)
    onChange({})
  }

  return (
    <div role="search" aria-label="Filtros de pagos" className="flex flex-wrap items-center gap-3 font-inter">
      <div className="min-w-[220px] flex-1 sm:flex-none">
        <SupplierSearch
          value={selectedProveedor}
          onChange={handleProveedorChange}
          placeholder="Filtrar por proveedor…"
        />
      </div>

      <button
        type="button"
        onClick={handleClear}
        className="rounded-pill px-4 py-2 text-xs font-semibold text-ink-soft-2 transition-colors hover:bg-surface-alt"
      >
        Limpiar filtros
      </button>
    </div>
  )
}

export default PagosFilters
