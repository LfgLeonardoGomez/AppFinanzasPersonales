/**
 * c-26 (D1) frontend regression test: the edit-mode FacturaFormPage
 * displays the supplier's name from FacturaResponse.proveedor_nombre, NOT
 * the UUID. Before the fix, `FacturaFormPage`'s edit branch never passed
 * `proveedor` to `FacturaForm`, so `FacturaForm.tsx`'s
 * `initialProveedor?.nombre ?? factura?.proveedor_id` fallback always
 * printed the raw UUID (mirrors the payment side's FE-005 fix, C-18).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { FacturaFormPage } from './FacturaFormPage'

const PROVEEDOR_ID = 'prov-uuid-1'
const PROVEEDOR_NOMBRE = 'pencamar'

function mockFactura(overrides: Record<string, unknown> = {}) {
  return {
    id: 'factura-uuid-1',
    usuario_id: 'user-1',
    proveedor_id: PROVEEDOR_ID,
    numero: 'F-001',
    fecha_emision: '2026-06-01',
    fecha_vencimiento: null,
    monto_total: 1500,
    archivo_url: null,
    origen: 'MANUAL',
    estado: 'PENDIENTE',
    items: [],
    items_sum_mismatch: false,
    created_at: '2026-06-01T10:00:00',
    updated_at: '2026-06-01T10:00:00',
    proveedor_nombre: PROVEEDOR_NOMBRE,
    ...overrides,
  }
}

const server = setupServer(
  http.get('/api/facturas/factura-uuid-1', () => {
    return HttpResponse.json(mockFactura())
  }),
  http.get('/api/proveedores/buscar', () => HttpResponse.json([])),
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
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/facturas/factura-uuid-1/editar']}>
          <Routes>
            <Route path="/facturas/:id/editar" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('FacturaFormPage — c-26 (D1) edit-mode supplier name display', () => {
  it('displays the supplier name from proveedor_nombre, NOT the UUID', async () => {
    render(<FacturaFormPage />, { wrapper: createWrapper() })
    await waitFor(() => {
      const readonlyField = screen.getByTestId('proveedor-readonly')
      expect(readonlyField).toHaveTextContent(PROVEEDOR_NOMBRE)
    })
    const readonlyField = await screen.findByTestId('proveedor-readonly')
    expect(readonlyField).not.toHaveTextContent(PROVEEDOR_ID)
  })

  it('shows a neutral placeholder — never the UUID — when proveedor_nombre is null (soft-deleted supplier)', async () => {
    server.use(
      http.get('/api/facturas/factura-uuid-1', () => {
        return HttpResponse.json(mockFactura({ proveedor_nombre: null }))
      }),
    )
    render(<FacturaFormPage />, { wrapper: createWrapper() })
    const readonlyField = await screen.findByTestId('proveedor-readonly')
    expect(readonlyField).not.toHaveTextContent(PROVEEDOR_ID)
    expect(readonlyField.textContent).toMatch(/proveedor no disponible/i)
  })
})
