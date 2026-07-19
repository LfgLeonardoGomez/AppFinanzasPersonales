/**
 * Tests for ProveedorDetailPage (C-13, task 10 / D7).
 *
 * The page is the integration of the cuenta-corriente triple with the
 * existing supplier detail header. It uses two parallel queries:
 *   - `useProveedor(id)` (C-07) for the supplier name in the header
 *   - `useCuentaCorriente(id)` (C-13) for the saldo + tablas
 *
 * Behavior:
 *   - Renders the supplier name in the header (C-07)
 *   - Renders the `SaldoBadge` with the cuenta-corriente's `saldo`
 *   - Action buttons: "Cargar factura" → `/facturas/nueva?proveedor_id={id}`,
 *     "Cargar pago" → `/pagos/nuevo?proveedor_id={id}`
 *   - Empty triple: "Sin movimientos registrados"
 *   - 404 on either query: "Proveedor no encontrado" empty state
 *   - Loading: header skeleton
 *   - Generic error: "Reintentar" button
 *
 * TDD: Task 10.1 (RED) → 10.2 (GREEN) → 10.3 (TRIANGULATE).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ProveedorDetailPage } from './ProveedorDetailPage'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const PROVEEDOR_ID = 'proveedor-uuid-1'

const mockProveedor = {
  id: PROVEEDOR_ID,
  usuario_id: 'user-1',
  nombre: 'Proveedor Alfa',
  cuit: null,
  telefono: null,
  categoria: 'SERVICIO' as const,
  notas: null,
  saldo: 0,
  created_at: '2026-06-01T00:00:00',
  updated_at: '2026-06-01T00:00:00',
}

const mockCuentaCorriente = {
  proveedor_id: PROVEEDOR_ID,
  saldo: '1500.00',
  facturas_con_estado: [
    {
      id: 'factura-1',
      usuario_id: 'user-1',
      proveedor_id: PROVEEDOR_ID,
      numero: 'FAC-001',
      fecha_emision: '2026-06-01',
      fecha_vencimiento: null,
      monto_total: '1500.00',
      archivo_url: null,
      origen: 'MANUAL' as const,
      estado: 'PENDIENTE' as const,
      created_at: '2026-06-01T10:00:00',
      updated_at: '2026-06-01T10:00:00',
    },
  ],
  historial: [
    {
      id: 'factura-1',
      tipo: 'FACTURA' as const,
      fecha: '2026-06-01',
      monto: '1500.00',
      saldo_acumulado: '1500.00',
    },
  ],
}

const mockEmptyCuentaCorriente = {
  proveedor_id: PROVEEDOR_ID,
  saldo: '0.00',
  facturas_con_estado: [] as unknown[],
  historial: [] as unknown[],
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get(`/api/proveedores/${PROVEEDOR_ID}`, () => {
    return HttpResponse.json(mockProveedor)
  }),
  http.get(`/api/proveedores/${PROVEEDOR_ID}/cuenta-corriente`, () => {
    return HttpResponse.json(mockCuentaCorriente)
  }),
  http.get('/api/proveedores/proveedor-empty/cuenta-corriente', () => {
    return HttpResponse.json(mockEmptyCuentaCorriente)
  }),
  http.get('/api/proveedores/proveedor-foreign', () => {
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),
  http.get('/api/proveedores/proveedor-foreign/cuenta-corriente', () => {
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),
  http.get('/api/proveedores/proveedor-foreign-empty', () => {
    return HttpResponse.json({ ...mockProveedor, id: 'proveedor-foreign-empty', nombre: 'Proveedor Empty' })
  }),
  http.get('/api/proveedores/proveedor-foreign-empty/cuenta-corriente', () => {
    return HttpResponse.json(mockEmptyCuentaCorriente)
  }),
  http.get('/api/proveedores/proveedor-error', () => {
    return HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
  }),
  http.get('/api/proveedores/proveedor-error/cuenta-corriente', () => {
    return HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper(initialEntries: string[] = [`/proveedores/${PROVEEDOR_ID}`]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/proveedores/:id" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProveedorDetailPage', () => {
  it('renders the supplier name in the header (from useProveedor)', async () => {
    render(<ProveedorDetailPage />, { wrapper: createWrapper() })
    await waitFor(() =>
      expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument(),
    )
  })

  it('renders the SaldoBadge with the cuenta-corriente saldo', async () => {
    render(<ProveedorDetailPage />, { wrapper: createWrapper() })
    await waitFor(() =>
      expect(screen.getByTestId('saldo-badge')).toBeInTheDocument(),
    )
    const badge = screen.getByTestId('saldo-badge')
    // 1500 > 0 → deuda variant
    expect(badge.dataset.variant).toBe('deuda')
    expect(badge.textContent).toContain('1.500,00')
  })

  it('renders the "Cargar factura" link with ?proveedor_id= query string', async () => {
    render(<ProveedorDetailPage />, { wrapper: createWrapper() })
    await waitFor(() =>
      expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument(),
    )
    const link = screen.getByRole('link', { name: /cargar factura/i })
    expect(link).toHaveAttribute('href', `/facturas/nueva?proveedor_id=${PROVEEDOR_ID}`)
  })

  it('renders the "Cargar pago" link with ?proveedor_id= query string', async () => {
    render(<ProveedorDetailPage />, { wrapper: createWrapper() })
    await waitFor(() =>
      expect(screen.getByText('Proveedor Alfa')).toBeInTheDocument(),
    )
    const link = screen.getByRole('link', { name: /cargar pago/i })
    expect(link).toHaveAttribute('href', `/pagos/nuevo?proveedor_id=${PROVEEDOR_ID}`)
  })

  it('renders the TablaFacturasConEstado (default tab) and HistorialCronologico (Historial tab) below the action row', async () => {
    // C-13 redesign (Detalle Proveedor toggle): Facturas is the default
    // tab; Historial renders after selecting its pill (they no longer
    // render simultaneously — LAYOUT.md "cuenta corriente ... liviana").
    render(<ProveedorDetailPage />, { wrapper: createWrapper() })
    await waitFor(() =>
      expect(screen.getByTestId('tabla-facturas-row-factura-1')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Historial' }))
    expect(screen.getByTestId('historial-row-factura-1')).toBeInTheDocument()
  })

  it('the empty triple renders the "Sin movimientos registrados" empty state', async () => {
    render(<ProveedorDetailPage />, {
      wrapper: createWrapper(['/proveedores/proveedor-foreign-empty']),
    })
    await waitFor(() =>
      expect(screen.getByText(/sin movimientos registrados/i)).toBeInTheDocument(),
    )
  })

  it('404 on useProveedor renders the "Proveedor no encontrado" empty state with a link to /proveedores', async () => {
    render(<ProveedorDetailPage />, {
      wrapper: createWrapper(['/proveedores/proveedor-foreign']),
    })
    await waitFor(() =>
      expect(screen.getByText(/proveedor no encontrado/i)).toBeInTheDocument(),
    )
    const link = screen.getByRole('link', { name: /ver proveedores|ir a proveedores|volver a proveedores/i })
    expect(link).toHaveAttribute('href', '/proveedores')
  })

  it('404 on useCuentaCorriente (with useProveedor succeeding) renders the "Proveedor no encontrado" empty state', async () => {
    // Simulate: useProveedor returns 200 for a non-standard supplier, but
    // the cuenta-corriente endpoint returns 404. This is a defensive
    // scenario — the page should still show the friendly empty state.
    server.use(
      http.get('/api/proveedores/:id', ({ params }) => {
        if (params.id === 'proveedor-ghost') {
          return HttpResponse.json({
            ...mockProveedor,
            id: 'proveedor-ghost',
            nombre: 'Proveedor Ghost',
          })
        }
        return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
      }),
      http.get('/api/proveedores/proveedor-ghost/cuenta-corriente', () => {
        return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
      }),
    )
    render(<ProveedorDetailPage />, {
      wrapper: createWrapper(['/proveedores/proveedor-ghost']),
    })
    await waitFor(() =>
      expect(screen.getByText(/proveedor no encontrado/i)).toBeInTheDocument(),
    )
  })

  it('generic error on useCuentaCorriente renders the "Reintentar" button', async () => {
    // Override: useProveedor succeeds, useCuentaCorriente returns 500.
    server.use(
      http.get('/api/proveedores/proveedor-error', () => {
        return HttpResponse.json({ ...mockProveedor, id: 'proveedor-error', nombre: 'Proveedor Error' })
      }),
    )
    render(<ProveedorDetailPage />, {
      wrapper: createWrapper(['/proveedores/proveedor-error']),
    })
    await waitFor(() =>
      expect(screen.getByText(/no se pudo cargar la cuenta corriente/i)).toBeInTheDocument(),
    )
    expect(screen.getByRole('button', { name: /reintentar/i })).toBeInTheDocument()
  })
})
