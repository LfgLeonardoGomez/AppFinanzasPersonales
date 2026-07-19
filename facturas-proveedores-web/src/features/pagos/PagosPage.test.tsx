/**
 * Tests for PagosPage — list page integrating filters + list.
 * TDD: Task 8.1 (RED) → 8.2 (GREEN) → 8.4 (home quick-access lives in router.tsx).
 * C-18 (FE-001): SPA navigation — clicking Edit must use useNavigate, NOT
 * window.location.href (which would full-reload and destroy the SPA).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PagosPage } from './PagosPage'
import type { PagoListItem, PagoListResponse } from '@shared/api/api'

const mockPago: PagoListItem = {
  id: 'pago-1',
  proveedor_id: 'prov-1',
  monto: 1500,
  fecha: '2026-06-15',
  metodo: 'EFECTIVO',
  origen: 'MANUAL',
  created_at: '2026-06-15T10:00:00',
}

const server = setupServer(
  http.get('/api/pagos', () =>
    HttpResponse.json({
      items: [mockPago],
      total: 1,
      page: 1,
      page_size: 50,
    } as PagoListResponse),
  ),
  http.get('/api/proveedores/buscar', () => HttpResponse.json([])),
  http.get('/api/proveedores', () => HttpResponse.json([])),
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
      <MemoryRouter initialEntries={['/pagos']}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

function createWrapperWithRoutes() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/pagos']}>
          <Routes>
            <Route path="/pagos" element={children} />
            <Route path="/pagos/:id/editar" element={<div>EDIT_FORM</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('PagosPage', () => {
  it('renders the payment list integrated with filters', async () => {
    render(<PagosPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getByText('EFECTIVO')).toBeInTheDocument()
    })
  })

  it('shows a "Cargar pago" create link', async () => {
    render(<PagosPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /cargar pago|nuevo pago/i })).toBeInTheDocument()
    })
  })

  it('shows the "Pago al proveedor" reinforcement label in each row', async () => {
    render(<PagosPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getAllByText(/pago al proveedor/i).length).toBeGreaterThanOrEqual(1)
    })
  })
})

// ── C-18 (FE-001): SPA navigation via useNavigate, not window.location.href ──

describe('PagosPage — FE-001 SPA navigation', () => {
  it('navigates to /pagos/:id/editar via SPA navigation when Edit is clicked', async () => {
    render(<PagosPage />, { wrapper: createWrapperWithRoutes() })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())
    const editButton = screen.getByRole('button', { name: /editar/i })
    fireEvent.click(editButton)
    await waitFor(() => expect(screen.getByText('EDIT_FORM')).toBeInTheDocument())
  })

  it('does NOT assign window.location.href when Edit is clicked', async () => {
    let capturedHref: string | null = null
    const originalLocation = window.location
    const locationProxy = new Proxy(window.location, {
      set(target, prop, value) {
        if (prop === 'href') {
          capturedHref = String(value)
        }
        return Reflect.set(target, prop, value)
      },
      get(target, prop) {
        return Reflect.get(target, prop)
      },
    })
    Object.defineProperty(window, 'location', {
      value: locationProxy,
      writable: true,
      configurable: true,
    })

    try {
      render(<PagosPage />, { wrapper: createWrapperWithRoutes() })
      await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())
      const editButton = screen.getByRole('button', { name: /editar/i })
      fireEvent.click(editButton)
      expect(capturedHref).toBeNull()
    } finally {
      Object.defineProperty(window, 'location', {
        value: originalLocation,
        writable: true,
        configurable: true,
      })
    }
  })
})
