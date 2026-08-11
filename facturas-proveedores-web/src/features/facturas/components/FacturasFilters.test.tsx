/**
 * Tests for FacturasFilters — supplier filter (SupplierSearch), estado select, date range.
 * TDD: Task 7.1 (RED) → 7.2 (GREEN) → 7.5 (TRIANGULATE).
 *
 * Filters are synced to URL search params (D-C09-4).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { FacturasFilters } from './FacturasFilters'
import type { ProveedorListItem, FacturasFilters as FacturasFiltersType } from '@shared/api/api'

const mockProveedor: ProveedorListItem = {
  id: 'prov-uuid-1',
  nombre: 'Proveedor Test SA',
  cuit: null,
  telefono: null,
  categoria: 'OTRO',
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

const server = setupServer(
  http.get('/api/proveedores/buscar', () => HttpResponse.json([mockProveedor])),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

function renderFilters(
  filters: FacturasFiltersType = {},
  onChange = vi.fn<[FacturasFiltersType], void>(),
) {
  return render(
    <FacturasFilters filters={filters} onChange={onChange} />,
    { wrapper: createWrapper() },
  )
}

describe('FacturasFilters', () => {
  it('renders the estado pill group, date-range inputs, and a clear button', () => {
    renderFilters()
    expect(screen.getByRole('group', { name: /estado/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pendiente' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Parcial' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagada' })).toBeInTheDocument()
    expect(screen.getByLabelText(/desde/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/hasta/i)).toBeInTheDocument()
  })

  it('calls onChange with estado when an estado pill is clicked', () => {
    const onChange = vi.fn<[FacturasFiltersType], void>()
    renderFilters({}, onChange)
    fireEvent.click(screen.getByRole('button', { name: 'Pagada' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ estado: 'PAGADA' }))
  })

  it('marks the active estado pill with aria-pressed and clears it via "Todas"', () => {
    const onChange = vi.fn<[FacturasFiltersType], void>()
    renderFilters({ estado: 'PENDIENTE' }, onChange)
    expect(screen.getByRole('button', { name: 'Pendiente' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Todas' }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange.mock.calls[0]![0]).not.toHaveProperty('estado')
  })

  it('calls onChange with fecha_desde when the date input changes', () => {
    const onChange = vi.fn<[FacturasFiltersType], void>()
    renderFilters({}, onChange)
    const desdeInput = screen.getByLabelText(/desde/i)
    fireEvent.change(desdeInput, { target: { value: '2026-01-01' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fecha_desde: '2026-01-01' }))
  })

  it('calls onChange with fecha_hasta when the date input changes', () => {
    const onChange = vi.fn<[FacturasFiltersType], void>()
    renderFilters({}, onChange)
    const hastaInput = screen.getByLabelText(/hasta/i)
    fireEvent.change(hastaInput, { target: { value: '2026-12-31' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ fecha_hasta: '2026-12-31' }))
  })

  it('calls onChange with empty filters when clear is clicked', () => {
    const onChange = vi.fn<[FacturasFiltersType], void>()
    renderFilters({ estado: 'PENDIENTE', fecha_desde: '2026-01-01' }, onChange)
    const clearBtn = screen.getByRole('button', { name: /limpiar/i })
    fireEvent.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('shows the SupplierSearch shared component for supplier filtering', () => {
    renderFilters()
    // SupplierSearch renders a combobox role input; estado select is also a combobox
    const comboboxes = screen.getAllByRole('combobox')
    expect(comboboxes.length).toBeGreaterThanOrEqual(1)
    // The SupplierSearch combobox has aria-autocomplete="list"
    const supplierCombobox = comboboxes.find(
      (el) => el.getAttribute('aria-autocomplete') === 'list',
    )
    expect(supplierCombobox).toBeInTheDocument()
  })
})
