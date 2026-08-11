/**
 * Tests for SupplierSearch — autocomplete component for supplier linkage (RN-VINC).
 * Uses MSW to mock GET /api/proveedores/buscar.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import SupplierSearch from './SupplierSearch'
import type { ProveedorListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockResults: ProveedorListItem[] = [
  {
    id: 'uuid-1',
    nombre: 'Transportes García',
    cuit: null,
    telefono: null,
    categoria: 'SERVICIO',
    notas: null,
    saldo: 0,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
  },
  {
    id: 'uuid-2',
    nombre: 'García Distribuciones',
    cuit: null,
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
  },
]

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/proveedores/buscar', ({ request }) => {
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (nombre.length < 2) return HttpResponse.json([])
    if (nombre.toLowerCase().includes('garc')) return HttpResponse.json(mockResults)
    return HttpResponse.json([])
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SupplierSearch', () => {
  it('shows matching supplier names in dropdown after typing ≥2 chars', async () => {
    render(<SupplierSearch value={null} onChange={() => {}} />, {
      wrapper: createWrapper(),
    })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'garc' } })
    await waitFor(() =>
      expect(screen.getByText('Transportes García')).toBeInTheDocument(),
    )
    expect(screen.getByText('García Distribuciones')).toBeInTheDocument()
  })

  it('calls onChange with the selected supplier when user clicks a result', async () => {
    const onChange = vi.fn()
    render(<SupplierSearch value={null} onChange={onChange} />, {
      wrapper: createWrapper(),
    })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'garc' } })
    await waitFor(() =>
      expect(screen.getByText('Transportes García')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByText('Transportes García'))
    expect(onChange).toHaveBeenCalledWith(mockResults[0])
  })

  it('shows no dropdown when query is shorter than 2 chars', async () => {
    render(<SupplierSearch value={null} onChange={() => {}} />, {
      wrapper: createWrapper(),
    })
    const input = screen.getByRole('combobox')
    fireEvent.change(input, { target: { value: 'g' } })
    // Wait a moment — no dropdown should appear
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('calls onChange(null) when clear button is clicked', async () => {
    const onChange = vi.fn()
    const firstResult = mockResults[0]
    if (!firstResult) throw new Error('mockResults[0] is undefined')
    render(<SupplierSearch value={firstResult} onChange={onChange} />, {
      wrapper: createWrapper(),
    })
    // When a value is set, a clear button should be present
    const clearBtn = screen.getByRole('button', { name: /limpiar|clear/i })
    fireEvent.click(clearBtn)
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('disables the input when disabled prop is true', () => {
    render(<SupplierSearch value={null} onChange={() => {}} disabled />, {
      wrapper: createWrapper(),
    })
    expect(screen.getByRole('combobox')).toBeDisabled()
  })

  it('shows "Sin coincidencias" when search returns empty results', async () => {
    render(<SupplierSearch value={null} onChange={() => {}} />, {
      wrapper: createWrapper(),
    })
    const input = screen.getByRole('combobox')
    // 'zz' will match no suppliers
    fireEvent.change(input, { target: { value: 'zz' } })
    await waitFor(() =>
      expect(screen.getByText(/sin coincidencias/i)).toBeInTheDocument(),
    )
  })
})
