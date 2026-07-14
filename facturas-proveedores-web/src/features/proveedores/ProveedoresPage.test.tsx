/**
 * Tests for ProveedoresPage — route entry point for supplier management.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { ReactNode } from 'react'
import ProveedoresPage from './ProveedoresPage'
import type { ProveedorListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockPagedResponse: ProveedorListItem[] = [
  {
    id: 'uuid-1',
    usuario_id: 'user-1',
    nombre: 'Proveedor Uno',
    cuit: null,
    telefono: null,
    categoria: 'SERVICIO',
    notas: null,
    saldo: 100,
    created_at: '2026-06-01T00:00:00',
    updated_at: '2026-06-01T00:00:00',
  },
]

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/proveedores', () => HttpResponse.json(mockPagedResponse)),
  http.post('/api/proveedores', async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json(
      { ...mockPagedResponse.items[0], id: 'uuid-new', nombre: body.nombre },
      { status: 201 },
    )
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
      <MemoryRouter initialEntries={['/proveedores']}>
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProveedoresPage', () => {
  it('renders the supplier list when loaded', async () => {
    render(<ProveedoresPage />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Proveedor Uno')).toBeInTheDocument())
  })

  it('shows "Nuevo proveedor" button that opens the create form modal', async () => {
    render(<ProveedoresPage />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Proveedor Uno')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /nuevo proveedor/i }))
    // Form modal should open — check for a form element or label
    await waitFor(() =>
      expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument(),
    )
  })

  it('closes the form when "Cancelar" is clicked', async () => {
    render(<ProveedoresPage />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('Proveedor Uno')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /nuevo proveedor/i }))
    await waitFor(() => expect(screen.getByLabelText(/nombre/i)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }))
    await waitFor(() =>
      expect(screen.queryByLabelText(/nombre/i)).not.toBeInTheDocument(),
    )
  })
})

describe('ProveedoresPage — routing', () => {
  it('is accessible under /proveedores route when rendered inside Routes', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter initialEntries={['/proveedores']}>
        <QueryClientProvider client={qc}>
          <Routes>
            <Route path="/proveedores" element={<ProveedoresPage />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getByText('Proveedor Uno')).toBeInTheDocument())
  })
})
