/**
 * Tests for VentasPage — route entry for the sales list (C-34, tasks
 * 7.3/7.9, design.md D9).
 *
 * Mirrors `PagosPage`/`FacturasPage`: filters live in URL search params.
 * D9: the default view is TODAY (desde = hasta = today) — the page opens on
 * the number the user came to see, not an unfiltered "all time" list.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { VentasPage } from './VentasPage'
import type { VentaListItem } from '@shared/api/api'

vi.mock('@shared/utils/date', async () => {
  const actual = await vi.importActual<typeof import('@shared/utils/date')>('@shared/utils/date')
  return { ...actual, getTodayInArgentina: () => '2026-08-13' }
})

const mockVenta: VentaListItem = {
  id: 'venta-1',
  negocio_id: 'negocio-1',
  cliente_id: null,
  fecha: '2026-08-13',
  monto: '1000.00',
  forma_pago: 'EFECTIVO',
  notas: null,
  created_at: '2026-08-13T10:00:00',
  updated_at: '2026-08-13T10:00:00',
}

let lastVentasUrl: URL | null = null

const server = setupServer(
  http.get('/api/ventas', ({ request }) => {
    lastVentasUrl = new URL(request.url)
    return HttpResponse.json([mockVenta])
  }),
  http.get('/api/clientes', () => HttpResponse.json([])),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  lastVentasUrl = null
})

function createWrapper(initialEntries: string[] = ['/ventas']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={initialEntries}>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    )
  }
}

function createWrapperWithRoutes(initialEntries: string[] = ['/ventas']) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/ventas" element={children} />
            <Route path="/ventas/:id/editar" element={<div>EDIT_FORM</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('VentasPage — default view is today (D9)', () => {
  it('requests desde=hasta=today when no filters are in the URL', async () => {
    render(<VentasPage />, { wrapper: createWrapper() })
    await waitFor(() => expect(lastVentasUrl).not.toBeNull())
    expect(lastVentasUrl?.searchParams.get('desde')).toBe('2026-08-13')
    expect(lastVentasUrl?.searchParams.get('hasta')).toBe('2026-08-13')
  })
})

describe('VentasPage — filters survive a reload (task 7.3)', () => {
  it('reads desde/hasta/forma_pago back from the URL on load (triangulation — non-default filters)', async () => {
    render(<VentasPage />, {
      wrapper: createWrapper(['/ventas?desde=2026-08-01&hasta=2026-08-05&forma_pago=TARJETA']),
    })
    await waitFor(() => expect(lastVentasUrl).not.toBeNull())
    expect(lastVentasUrl?.searchParams.get('desde')).toBe('2026-08-01')
    expect(lastVentasUrl?.searchParams.get('hasta')).toBe('2026-08-05')
    expect(lastVentasUrl?.searchParams.get('forma_pago')).toBe('TARJETA')
  })
})

describe('VentasPage — renders the list integrated with filters and totals', () => {
  it('shows a "Cargar venta" create link and the fetched sale', async () => {
    render(<VentasPage />, { wrapper: createWrapper() })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())
    expect(screen.getByRole('link', { name: /cargar venta|nueva venta/i })).toBeInTheDocument()
  })

  it('navigates to /ventas/:id/editar via SPA navigation when Edit is clicked', async () => {
    render(<VentasPage />, { wrapper: createWrapperWithRoutes() })
    await waitFor(() => expect(screen.getByText('EFECTIVO')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /editar/i }))
    await waitFor(() => expect(screen.getByText('EDIT_FORM')).toBeInTheDocument())
  })
})
