/**
 * Tests for VentaFormPage — route entry for create (/ventas/nueva) and edit
 * (/ventas/:id/editar), C-34 task 6.8.
 *
 * Mirrors PagoFormPage.test.tsx's routing/MSW setup, simplified: there is no
 * IA-vision carga modal for ventas (design.md Non-Goals) — both modes render
 * `VentaForm` directly.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse, delay } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { VentaFormPage } from './VentaFormPage'
import type { Venta, ClienteListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockVentaFiada: Venta = {
  id: 'venta-1',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  fecha: '2026-08-10',
  monto: '500.00',
  forma_pago: 'CUENTA_CORRIENTE',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
}

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

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/ventas/:id', ({ params }) => {
    if (params.id === 'venta-1') return HttpResponse.json(mockVentaFiada)
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  http.get('/api/clientes', () => HttpResponse.json([mockCliente])),
  http.get('/api/clientes/buscar', () => HttpResponse.json([])),

  http.post('/api/ventas', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockVentaFiada, ...body }, { status: 201 })
  }),

  http.patch('/api/ventas/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    return HttpResponse.json({ ...mockVentaFiada, ...body })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/ventas/nueva" element={<VentaFormPage />} />
          <Route path="/ventas/:id/editar" element={<VentaFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// ── Create mode ───────────────────────────────────────────────────────────────

describe('VentaFormPage — create mode', () => {
  it('renders VentaForm directly, with no id in the route', () => {
    renderAt('/ventas/nueva')
    expect(screen.getByText(/nueva venta/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/monto/i)).toBeInTheDocument()
  })
})

// ── Edit mode ─────────────────────────────────────────────────────────────────

describe('VentaFormPage — edit mode', () => {
  it('loads the existing venta and pre-fills the form', async () => {
    renderAt('/ventas/venta-1/editar')
    await waitFor(() => expect(screen.getAllByText(/editar venta/i).length).toBeGreaterThan(0))
    const montoInput = screen.getByLabelText(/monto/i) as HTMLInputElement
    await waitFor(() => expect(montoInput.value).toBe('500.00'))
  })

  it('shows an error state for a venta that does not exist (triangulation)', async () => {
    renderAt('/ventas/nonexistent/editar')
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
  })

  it('shows the real customer name when clientes resolves AFTER venta (finding A)', async () => {
    server.use(
      http.get('/api/clientes', async () => {
        await delay(50)
        return HttpResponse.json([mockCliente])
      }),
    )
    renderAt('/ventas/venta-1/editar')
    await waitFor(() => expect(screen.getAllByText(/editar venta/i).length).toBeGreaterThan(0))
    // clientes resolves later than venta — the chip must show the real name,
    // never a blank fallback baked in before clientes arrived.
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
    expect(screen.queryByLabelText(/limpiar selección/i)).toBeInTheDocument()
  })

  it('shows the real customer name when venta resolves AFTER clientes (finding A, triangulation)', async () => {
    server.use(
      http.get('/api/ventas/:id', async ({ params }) => {
        await delay(50)
        if (params.id === 'venta-1') return HttpResponse.json(mockVentaFiada)
        return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
      }),
    )
    renderAt('/ventas/venta-1/editar')
    await waitFor(() => expect(screen.getAllByText(/editar venta/i).length).toBeGreaterThan(0))
    await waitFor(() => expect(screen.getByText('Juan Pérez')).toBeInTheDocument())
  })
})
