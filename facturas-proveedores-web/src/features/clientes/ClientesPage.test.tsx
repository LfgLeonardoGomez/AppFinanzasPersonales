/**
 * Tests for ClientesPage (C-36, design.md D10, tasks 10.1-10.5).
 *
 * `ClientesPage` renders `useClientes()` — the plain listing, the only
 * endpoint that carries balances — sorted by balance descending by default.
 * It never fetches per-customer accounts (design.md D10: the backend
 * computes every balance in one aggregate query specifically so ordering by
 * debt does not become N+1).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactElement } from 'react'
import { ClientesPage } from './ClientesPage'
import type { ClienteListItem } from '@shared/api/api'

function cliente(overrides: Partial<ClienteListItem>): ClienteListItem {
  return {
    id: 'cliente-x',
    negocio_id: 'negocio-1',
    nombre: 'Cliente X',
    nombre_normalizado: 'CLIENTE X',
    telefono: null,
    notas: null,
    created_at: '2026-08-01T10:00:00',
    updated_at: '2026-08-01T10:00:00',
    saldo: null,
    ...overrides,
  }
}

let clientesGetCount = 0
let cuentaCorrienteGetCount = 0
let clientesFixture: ClienteListItem[] = []

const server = setupServer(
  http.get('/api/clientes', () => {
    clientesGetCount += 1
    return HttpResponse.json(clientesFixture)
  }),
  http.get('/api/clientes/:id/cuenta-corriente', () => {
    cuentaCorrienteGetCount += 1
    return HttpResponse.json({ cliente_id: 'x', saldo: '0.00', ventas_con_estado: [], historial: [] })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
beforeEach(() => {
  clientesGetCount = 0
  cuentaCorrienteGetCount = 0
})
afterEach(() => server.resetHandlers())

function renderPage(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ClientesPage — ordered by balance descending by default (task 10.1)', () => {
  it('renders each customer with the listing balance, largest debt first', async () => {
    clientesFixture = [
      cliente({ id: 'c-1', nombre: 'Debe poco', saldo: '100.00' }),
      cliente({ id: 'c-2', nombre: 'Debe mucho', saldo: '5000.00' }),
      cliente({ id: 'c-3', nombre: 'Sin deuda', saldo: '0.00' }),
    ]
    renderPage(<ClientesPage />)
    await waitFor(() => expect(screen.getByText('Debe mucho')).toBeInTheDocument())

    const names = screen.getAllByTestId(/^cliente-nombre-/).map((n) => n.textContent)
    expect(names).toEqual(['Debe mucho', 'Debe poco', 'Sin deuda'])
  })
})

describe('ClientesPage — no N+1 (task 10.2)', () => {
  it('rendering a list of many customers issues no per-customer account request', async () => {
    clientesFixture = Array.from({ length: 10 }, (_, i) =>
      cliente({ id: `c-${i}`, nombre: `Cliente ${i}`, saldo: `${i * 10}.00` }),
    )
    renderPage(<ClientesPage />)
    await waitFor(() => expect(screen.getAllByTestId(/^cliente-nombre-/).length).toBe(10))
    expect(cuentaCorrienteGetCount).toBe(0)
  })
})

describe('ClientesPage — sort toggle re-orders without refetch (task 10.3)', () => {
  it('switching order re-sorts client-side, without a second GET', async () => {
    clientesFixture = [
      cliente({ id: 'c-1', nombre: 'Ana', saldo: '100.00' }),
      cliente({ id: 'c-2', nombre: 'Beto', saldo: '5000.00' }),
    ]
    renderPage(<ClientesPage />)
    await waitFor(() => expect(screen.getAllByTestId(/^cliente-nombre-/).length).toBe(2))
    const countAfterLoad = clientesGetCount

    fireEvent.click(screen.getByRole('button', { name: /nombre/i }))
    await waitFor(() => {
      const names = screen.getAllByTestId(/^cliente-nombre-/).map((n) => n.textContent)
      expect(names).toEqual(['Ana', 'Beto'])
    })
    expect(clientesGetCount).toBe(countAfterLoad)
  })
})

describe('ClientesPage — absent balance sorts last, not as zero (task 10.4)', () => {
  it('a null saldo orders after every numeric saldo, including a zero one', async () => {
    clientesFixture = [
      cliente({ id: 'c-1', nombre: 'Al día', saldo: '0.00' }),
      cliente({ id: 'c-2', nombre: 'Desconocido', saldo: null }),
      cliente({ id: 'c-3', nombre: 'Debe', saldo: '200.00' }),
    ]
    renderPage(<ClientesPage />)
    await waitFor(() => expect(screen.getAllByTestId(/^cliente-nombre-/).length).toBe(3))
    const names = screen.getAllByTestId(/^cliente-nombre-/).map((n) => n.textContent)
    expect(names).toEqual(['Debe', 'Al día', 'Desconocido'])
  })
})

describe('ClientesPage — empty state and row links (task 10.5)', () => {
  it('a negocio with no customers renders an empty state', async () => {
    clientesFixture = []
    renderPage(<ClientesPage />)
    await waitFor(() => expect(screen.getByText(/sin clientes/i)).toBeInTheDocument())
  })

  it('each row links to /clientes/:id', async () => {
    clientesFixture = [cliente({ id: 'c-1', nombre: 'Ana', saldo: '100.00' })]
    renderPage(<ClientesPage />)
    await waitFor(() => expect(screen.getByText('Ana')).toBeInTheDocument())
    const link = screen.getByRole('link', { name: /ana/i })
    expect(link).toHaveAttribute('href', '/clientes/c-1')
  })
})
