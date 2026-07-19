/**
 * Tests for the redesigned HomePage (specs/design/HOME.md).
 *
 * Home is now: greeting + IA-carga hero (protagonist) + proveedores frecuentes
 * + actividad reciente. Data comes from GET /api/proveedores?order_by=saldo and
 * GET /api/actividad-reciente. MSW intercepts both — no real backend.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import type { ReactNode } from 'react'
import { HomePage } from './HomePage'

const proveedores = [
  {
    id: 'p1',
    usuario_id: 'u1',
    nombre: 'Distribuidora Norte',
    categoria: 'OTRO',
    saldo: 148097,
    ultima_factura_fecha: '2026-07-17',
  },
]

const actividad = [
  {
    tipo: 'factura',
    id: 'f1',
    proveedor_id: 'p1',
    proveedor_nombre: 'Distribuidora Norte',
    monto: '148097.00',
    fecha: '2026-07-17',
    created_at: '2026-07-17T10:00:00',
  },
  {
    tipo: 'pago',
    id: 'pg1',
    proveedor_id: 'p1',
    proveedor_nombre: 'Distribuidora Norte',
    monto: '5000.00',
    fecha: '2026-07-16',
    created_at: '2026-07-16T10:00:00',
  },
]

const server = setupServer(
  http.get('/api/proveedores', () => HttpResponse.json(proveedores)),
  http.get('/api/actividad-reciente', () => HttpResponse.json(actividad)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderHome() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = (children: ReactNode) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={children} />
          <Route path="/facturas/nueva" element={<div>FACTURAS_NUEVA</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
  return render(wrapper(<HomePage />))
}

describe('HomePage — redesign', () => {
  it('shows the greeting and the IA-carga hero as the protagonist', () => {
    renderHome()
    expect(screen.getByText(/hola/i)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /cargar con ia/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /subir imagen/i })).toBeInTheDocument()
  })

  it('renders a proveedor frecuente card once loaded', async () => {
    renderHome()
    expect(await screen.findByText('Distribuidora Norte')).toBeInTheDocument()
  })

  it('renders the actividad reciente feed (factura + pago rows) once loaded', async () => {
    renderHome()
    expect(await screen.findByText(/Factura · Distribuidora Norte/)).toBeInTheDocument()
    expect(screen.getByText(/Pago · Distribuidora Norte/)).toBeInTheDocument()
  })

  it('"Subir imagen" opens the carga flow via SPA navigation', () => {
    renderHome()
    fireEvent.click(screen.getByRole('button', { name: /subir imagen/i }))
    expect(screen.getByText('FACTURAS_NUEVA')).toBeInTheDocument()
  })
})
