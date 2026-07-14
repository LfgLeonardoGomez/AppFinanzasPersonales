/**
 * End-to-end integration test for the "fresh triple after mutation"
 * guarantee (C-13, task 12).
 *
 * The user-facing promise: when a user creates a pago on
 * `/proveedores/{X}`, the cuenta-corriente view reactively refreshes
 * (the saldo updates without a manual reload). This test mounts
 * `ProveedorDetailPage`, captures the initial saldo, triggers a pago
 * mutation that the cross-feature cache invalidation (PR-C) wires to
 * `cuenta-corriente.detail(X)`, and asserts the new saldo is rendered.
 *
 * Strategy: MSW intercepts all calls. A stateful handler returns the
 * initial triple on the first read, then the updated triple on every
 * subsequent read (simulating the server-side update after the pago
 * is created). The mutation goes through `useCreatePago.mutate(...)`;
 * TanStack Query's invalidation triggers a refetch; the page re-renders.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ProveedorDetailPage } from './ProveedorDetailPage'
import { useCreatePago } from '@features/pagos/api/pagosHooks'

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

// Before any pago: saldo 1500 (one factura pendiente of 1500).
const initialTriple = {
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

// After a 500 pago: saldo 1000 (deuda 1500 − pago 500 = 1000).
const updatedTriple = {
  proveedor_id: PROVEEDOR_ID,
  saldo: '1000.00',
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
      estado: 'PARCIAL' as const,
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
    {
      id: 'pago-1',
      tipo: 'PAGO' as const,
      fecha: '2026-06-10',
      monto: '500.00',
      saldo_acumulado: '1000.00',
    },
  ],
}

// ── MSW Server (stateful handler) ─────────────────────────────────────────────

// Module-level state so the handler can transition from initial → updated
// after the first POST /api/pagos succeeds.
let pagoCount = 0

const server = setupServer(
  http.get(`/api/proveedores/${PROVEEDOR_ID}`, () => {
    return HttpResponse.json(mockProveedor)
  }),
  http.get(`/api/proveedores/${PROVEEDOR_ID}/cuenta-corriente`, () => {
    // First read: initial triple. After the first pago is created: updated.
    if (pagoCount === 0) {
      return HttpResponse.json(initialTriple)
    }
    return HttpResponse.json(updatedTriple)
  }),
  http.post('/api/pagos', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    pagoCount += 1
    return HttpResponse.json(
      {
        id: 'pago-1',
        usuario_id: 'user-1',
        proveedor_id: body.proveedor_id as string,
        monto: body.monto as number,
        fecha: body.fecha as string,
        metodo: body.metodo as string,
        comprobante_url: null,
        origen: 'MANUAL',
        created_at: '2026-06-10T10:00:00',
        updated_at: '2026-06-10T10:00:00',
      },
      { status: 201 },
    )
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  pagoCount = 0
})

// ── Helper component: exposes a trigger function from inside the router tree ──

function MutationTrigger({
  onReady,
}: {
  onReady: (trigger: () => void) => void
}) {
  const createPago = useCreatePago()
  onReady(() => {
    createPago.mutate({
      proveedor_id: PROVEEDOR_ID,
      monto: 500,
      fecha: '2026-06-10',
      metodo: 'EFECTIVO',
    })
  })
  return null
}

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  let trigger: (() => void) | null = null
  return {
    queryClient,
    fire: () => {
      if (trigger) trigger()
    },
    Wrapper: function Wrapper({ children }: { children: ReactNode }) {
      return (
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[`/proveedores/${PROVEEDOR_ID}`]}>
            <Routes>
              <Route
                path="/proveedores/:id"
                element={
                  <>
                    {children}
                    <MutationTrigger onReady={(t) => (trigger = t)} />
                  </>
                }
              />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      )
    },
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('ProveedorDetailPage — end-to-end reactive refresh after mutation', () => {
  it('creating a pago reactively refreshes the cuenta-corriente view (new saldo renders)', async () => {
    const { Wrapper, fire } = createWrapper()
    render(<ProveedorDetailPage />, { wrapper: Wrapper })

    // Initial saldo: 1500 (deuda, one factura pendiente).
    await waitFor(() =>
      expect(screen.getByTestId('saldo-badge')).toBeInTheDocument(),
    )
    const initialBadge = screen.getByTestId('saldo-badge')
    expect(initialBadge.textContent).toContain('1.500,00')

    // Trigger the pago mutation. The cross-feature cache invalidation
    // (PR-C) marks `cuenta-corriente.detail(X)` as stale → TanStack
    // Query refetches on the next render.
    act(() => {
      fire()
    })

    // After the mutation + refetch, the badge shows the NEW saldo.
    await waitFor(
      () => {
        const newBadge = screen.getByTestId('saldo-badge')
        expect(newBadge.textContent).toContain('1.000,00')
      },
      { timeout: 3000 },
    )
  })
})
