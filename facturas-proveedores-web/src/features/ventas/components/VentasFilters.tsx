/**
 * VentasFilters — filter controls for the sales list (C-34, task 7.2).
 *
 * Supports: forma_pago (pill group, mirrors `FacturasFilters`' estado
 * pills), date range (Desde/Hasta), and customer (via the shared
 * `ClienteAutocomplete`, in the role `SupplierSearch` plays for
 * `PagosFilters`).
 *
 * Filter state is kept in URL search params by the parent `VentasPage`
 * (design.md D9).
 */
import { type ChangeEvent, useState } from 'react'
import { ClienteAutocomplete, type ClienteRef } from '@shared/components/ClienteAutocomplete/ClienteAutocomplete'
import { FORMA_PAGO_LABELS } from '../utils/formaPagoLabels'
import type { VentasFilters as VentasFiltersType, FormaPago } from '@shared/api/api'

const FORMA_PAGO_PILLS: { value: FormaPago | null; label: string }[] = [
  { value: null, label: 'Todas' },
  ...(Object.entries(FORMA_PAGO_LABELS) as [FormaPago, string][]).map(([value, label]) => ({
    value,
    label,
  })),
]

interface VentasFiltersProps {
  filters: VentasFiltersType
  onChange: (filters: VentasFiltersType) => void
}

export function VentasFilters({ filters, onChange }: VentasFiltersProps) {
  const [selectedCliente, setSelectedCliente] = useState<ClienteRef | null>(null)

  function handleFormaPagoPillClick(value: FormaPago | null) {
    const next: VentasFiltersType = { ...filters }
    if (value) {
      next.forma_pago = value
    } else {
      delete next.forma_pago
    }
    onChange(next)
  }

  function handleDesdeChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    const next: VentasFiltersType = { ...filters }
    if (val) {
      next.desde = val
    } else {
      delete next.desde
    }
    onChange(next)
  }

  function handleHastaChange(e: ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    const next: VentasFiltersType = { ...filters }
    if (val) {
      next.hasta = val
    } else {
      delete next.hasta
    }
    onChange(next)
  }

  function handleClienteChange(cliente: ClienteRef | null) {
    setSelectedCliente(cliente)
    const next: VentasFiltersType = { ...filters }
    if (cliente) {
      next.cliente_id = cliente.id
    } else {
      delete next.cliente_id
    }
    onChange(next)
  }

  function handleClear() {
    setSelectedCliente(null)
    onChange({})
  }

  return (
    <div role="search" aria-label="Filtros de ventas" className="flex flex-col gap-3 font-inter">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Forma de pago" className="flex flex-wrap gap-2">
          {FORMA_PAGO_PILLS.map((opt) => {
            const isActive = opt.value === null ? !filters.forma_pago : filters.forma_pago === opt.value
            return (
              <button
                key={opt.label}
                type="button"
                aria-pressed={isActive}
                onClick={() => handleFormaPagoPillClick(opt.value)}
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

        <div className="min-w-[220px] flex-1 sm:flex-none">
          <ClienteAutocomplete value={selectedCliente} onChange={handleClienteChange} />
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="filter-venta-desde" className="mb-1 block text-xs font-medium text-ink-soft">
            Desde
          </label>
          <input
            id="filter-venta-desde"
            type="date"
            value={filters.desde ?? ''}
            onChange={handleDesdeChange}
            aria-label="Desde"
            className="rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
          />
        </div>

        <div>
          <label htmlFor="filter-venta-hasta" className="mb-1 block text-xs font-medium text-ink-soft">
            Hasta
          </label>
          <input
            id="filter-venta-hasta"
            type="date"
            value={filters.hasta ?? ''}
            onChange={handleHastaChange}
            aria-label="Hasta"
            className="rounded-xl border border-border-subtle bg-surface px-3 py-2 text-sm text-ink focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100"
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
    </div>
  )
}

export default VentasFilters
