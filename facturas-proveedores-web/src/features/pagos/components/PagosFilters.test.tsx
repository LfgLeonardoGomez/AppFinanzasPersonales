/**
 * Tests for PagosFilters — supplier filter (SupplierSearch), clear button.
 *
 * TDD: Task 7.1 (RED) → 7.2 (GREEN) → 7.5 (TRIANGULATE).
 *
 * Filters are synced to URL search params by the parent `PagosPage`
 * (D-C11-7 — only supplier filter in MVP; no estado, no date range).
 *
 * Mirrors C-09 `FacturasFilters` for consistency.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { PagosFilters } from './PagosFilters'
import type { ProveedorListItem, PagosFilters as PagosFiltersType } from '@shared/api/api'

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
  filters: PagosFiltersType = {},
  onChange = vi.fn<[PagosFiltersType], void>(),
) {
  return render(
    <PagosFilters filters={filters} onChange={onChange} />,
    { wrapper: createWrapper() },
  )
}

describe('PagosFilters', () => {
  it('shows the SupplierSearch shared component for supplier filtering', () => {
    renderFilters()
    const supplierCombobox = screen.getByRole('combobox', { name: '' })
    expect(supplierCombobox).toBeInTheDocument()
  })

  it('renders a clear button that resets filters to empty', () => {
    const onChange = vi.fn<[PagosFiltersType], void>()
    renderFilters({ proveedor_id: 'prov-uuid-1' }, onChange)
    const clearBtn = screen.getByRole('button', { name: /limpiar/i })
    fireEvent.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('renders no estado filter (Pago has no estado — RN-PAG-01)', () => {
    renderFilters()
    // No estado select — only the supplier combobox
    const comboboxes = screen.getAllByRole('combobox')
    // The supplier autocomplete is the only combobox
    expect(comboboxes.length).toBe(1)
  })
})
