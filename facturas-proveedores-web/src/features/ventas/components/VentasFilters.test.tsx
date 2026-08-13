/**
 * Tests for VentasFilters — filter controls for the sales list (C-34, task 7.2).
 *
 * Mirrors `FacturasFilters` (pill group for the enum filter + date range) and
 * `PagosFilters` (a `ClienteAutocomplete` for the customer filter, in the
 * customer role `SupplierSearch` plays for `PagosFilters`).
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { VentasFilters } from './VentasFilters'
import type { ClienteListItem } from '@shared/api/api'

const mockCliente: ClienteListItem = {
  id: 'cliente-1',
  negocio_id: 'negocio-1',
  nombre: 'Juan Pérez',
  nombre_normalizado: 'JUAN PEREZ',
  telefono: null,
  notas: null,
  created_at: '2026-08-01T10:00:00',
  updated_at: '2026-08-01T10:00:00',
  saldo: null,
}

const server = setupServer(
  http.get('/api/clientes/buscar', ({ request }) => {
    const url = new URL(request.url)
    const nombre = url.searchParams.get('nombre') ?? ''
    if (!nombre || nombre.length < 2) return HttpResponse.json([])
    return HttpResponse.json([mockCliente])
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

describe('VentasFilters — filtering by payment method (task 7.2)', () => {
  it('calls onChange with only forma_pago set when a method pill is clicked', () => {
    const onChange = vi.fn()
    render(<VentasFilters filters={{}} onChange={onChange} />, { wrapper: createWrapper() })

    fireEvent.click(screen.getByRole('button', { name: /cuenta corriente/i }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ forma_pago: 'CUENTA_CORRIENTE' }))
  })

  it('clears forma_pago when "Todas" is clicked (triangulation)', () => {
    const onChange = vi.fn()
    render(
      <VentasFilters filters={{ forma_pago: 'EFECTIVO' }} onChange={onChange} />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByRole('button', { name: /^todas$/i }))

    const lastCall = onChange.mock.calls.at(-1)?.[0]
    expect(lastCall).not.toHaveProperty('forma_pago')
  })
})

describe('VentasFilters — filtering by date range (task 7.2)', () => {
  it('sets desde and hasta independently', () => {
    const onChange = vi.fn()
    render(<VentasFilters filters={{}} onChange={onChange} />, { wrapper: createWrapper() })

    fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-01' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ desde: '2026-08-01' }))

    fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-08-13' } })
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ hasta: '2026-08-13' }))
  })
})

describe('VentasFilters — filtering by customer (task 7.2)', () => {
  it('passes cliente_id when a customer is selected via ClienteAutocomplete', async () => {
    const onChange = vi.fn()
    render(<VentasFilters filters={{}} onChange={onChange} />, { wrapper: createWrapper() })

    const searchInput = screen.getByPlaceholderText(/buscar cliente/i)
    fireEvent.change(searchInput, { target: { value: 'Juan' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /juan pérez/i })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('option', { name: /juan pérez/i }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ cliente_id: 'cliente-1' }))
  })
})

describe('VentasFilters — clearing filters', () => {
  it('resets every filter when "Limpiar filtros" is clicked', () => {
    const onChange = vi.fn()
    render(
      <VentasFilters filters={{ forma_pago: 'EFECTIVO', cliente_id: 'cliente-1' }} onChange={onChange} />,
      { wrapper: createWrapper() },
    )

    fireEvent.click(screen.getByRole('button', { name: /limpiar filtros/i }))

    expect(onChange).toHaveBeenCalledWith({})
  })
})
