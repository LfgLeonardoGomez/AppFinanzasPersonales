/**
 * Tests for ClienteDetailPage (C-36, design.md D5, tasks 11.1-11.4).
 *
 * D5 — the name comes from `GET /api/clientes/{id}` and the balance/fiados
 * /history come from the account endpoint. `cliente.saldo` is NEVER read on
 * this page — it is structurally `null` on the single-customer read, which
 * is the exact shape of a bug that type-checks.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { ClienteDetailPage } from './ClienteDetailPage'

const mockCliente = {
  id: 'cliente-1',
  negocio_id: 'negocio-1',
  nombre: 'Juan Pérez',
  nombre_normalizado: 'JUAN PEREZ',
  telefono: null,
  notas: null,
  created_at: '2026-08-01T10:00:00',
  updated_at: '2026-08-01T10:00:00',
  saldo: null, // ALWAYS null on this endpoint (design.md D5)
}

let accountStatus = 200
let clienteStatus = 200

const server = setupServer(
  http.get('/api/clientes/:id', () => {
    if (clienteStatus === 404) return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
    return HttpResponse.json(mockCliente)
  }),
  http.get('/api/clientes/:id/cuenta-corriente', () => {
    if (accountStatus === 404) return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
    if (accountStatus === 500) return HttpResponse.json({ detail: 'boom' }, { status: 500 })
    return HttpResponse.json({
      cliente_id: 'cliente-1',
      saldo: '1500.00', // deliberately non-zero and non-null — the page must render THIS, not cliente.saldo
      ventas_con_estado: [],
      historial: [],
    })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  accountStatus = 200
  clienteStatus = 200
})

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/clientes/cliente-1']}>
        <Routes>
          <Route path="/clientes/:id" element={<ClienteDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ClienteDetailPage — two sources (task 11.1)', () => {
  it('reads the name from GET /api/clientes/{id} and the balance from the account endpoint', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
    expect(screen.getByTestId('saldo-badge').textContent).toContain('1.500')
  })
})

describe('ClienteDetailPage — the bug that type-checks (task 11.2)', () => {
  it('renders the account balance even though cliente.saldo is null (always, on this endpoint)', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('saldo-badge')).toBeInTheDocument())
    // If the page ever reads cliente.saldo, this would render as "—" or $0.
    expect(screen.getByTestId('saldo-badge').textContent).not.toBe('—')
    expect(screen.getByTestId('saldo-badge').textContent).toContain('1.500')
  })
})

describe('ClienteDetailPage — 404 from either query (task 11.3)', () => {
  it('a 404 on the customer renders "cliente no encontrado" with a link back, no retry', async () => {
    clienteStatus = 404
    renderPage()
    await waitFor(() => expect(screen.getByText(/cliente no encontrado/i)).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /clientes/i })).toHaveAttribute('href', '/clientes')
  })

  it('a 404 on the account also renders the not-found state (triangulation)', async () => {
    accountStatus = 404
    renderPage()
    await waitFor(() => expect(screen.getByText(/cliente no encontrado/i)).toBeInTheDocument())
  })
})

describe('ClienteDetailPage — non-404 account failure (task 11.4)', () => {
  it('a 500 on the account offers a retry affordance while the header still shows the customer', async () => {
    accountStatus = 500
    renderPage()
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })
})
