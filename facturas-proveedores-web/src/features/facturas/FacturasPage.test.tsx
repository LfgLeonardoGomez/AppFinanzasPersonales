/**
 * Tests for FacturasPage — list page integrating filters + list.
 * TDD: Task 8.1 (RED) → 8.2 (GREEN) → 8.4 (home quick-access).
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
import { FacturasPage } from './FacturasPage'
import type { FacturaListItem } from '@shared/api/api'

const mockFactura: FacturaListItem = {
  id: 'fac-1',
  usuario_id: 'user-1',
  proveedor_id: 'prov-1',
  numero: 'FAC-001',
  fecha_emision: '2026-06-01',
  fecha_vencimiento: null,
  monto_total: 1500,
  archivo_url: null,
  origen: 'MANUAL',
  estado: 'PENDIENTE',
  created_at: '2026-06-01T10:00:00',
  updated_at: '2026-06-01T10:00:00',
}

const server = setupServer(
  http.get('/api/facturas', () => HttpResponse.json([mockFactura])),
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
      <MemoryRouter initialEntries={['/facturas']}>
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
        <MemoryRouter initialEntries={['/facturas']}>
          <Routes>
            <Route path="/facturas" element={children} />
            <Route path="/facturas/:id/editar" element={<div>EDIT_FORM</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('FacturasPage', () => {
  it('renders the invoice list integrated with filters', async () => {
    render(<FacturasPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getByText(/FAC-001/)).toBeInTheDocument()
      expect(screen.getByText('PENDIENTE')).toBeInTheDocument()
    })
  })

  it('renders filter controls alongside the list', async () => {
    render(<FacturasPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      // Estado pill group from FacturasFilters
      expect(screen.getByRole('group', { name: /estado/i })).toBeInTheDocument()
    })
  })

  it('has a "Cargar factura" / create link', async () => {
    render(<FacturasPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /cargar factura|nueva factura/i })).toBeInTheDocument()
    })
  })
})

// ── C-18 (FE-001): SPA navigation via useNavigate, not window.location.href ──

describe('FacturasPage — FE-001 SPA navigation', () => {
  it('navigates to /facturas/:id/editar via SPA navigation when Edit is clicked', async () => {
    render(<FacturasPage />, { wrapper: createWrapperWithRoutes() })
    await waitFor(() => expect(screen.getByText(/FAC-001/)).toBeInTheDocument())
    // Click the Edit button on the only row
    const editButton = screen.getByRole('button', { name: /^editar$/i })
    fireEvent.click(editButton)
    // The SPA route /facturas/:id/editar is matched by the test router →
    // the placeholder renders. This proves navigation happened in-app, not
    // via a full-page reload (which would unmount everything and the test
    // wrapper would lose its location, breaking the route match).
    await waitFor(() => expect(screen.getByText('EDIT_FORM')).toBeInTheDocument())
  })

  it('does NOT assign window.location.href when Edit is clicked', async () => {
    // Spy on the location.href setter — if the code under test does
    // `window.location.href = ...`, this spy will capture the value.
    // The pre-fix code uses this exact pattern; the post-fix code uses
    // useNavigate() which never touches window.location.
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
      render(<FacturasPage />, { wrapper: createWrapperWithRoutes() })
      await waitFor(() => expect(screen.getByText(/FAC-001/)).toBeInTheDocument())
      const editButton = screen.getByRole('button', { name: /^editar$/i })
      fireEvent.click(editButton)
      // The Edit click must NOT assign to window.location.href.
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
