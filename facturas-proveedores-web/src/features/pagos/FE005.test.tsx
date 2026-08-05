/**
 * C-18 (FE-005) frontend regression test: the edit-mode PagoFormPage
 * displays the supplier's name from PagoResponse.proveedor_nombre, NOT
 * the UUID. Before the fix, the page constructed the readonly ProveedorListItem
 * with `nombre: pago.proveedor_id` as a fallback (the backend did not
 * populate the name).
 *
 * c-26 (D1): the soft-deleted case previously fell back to the UUID too
 * (`nombre: pago.proveedor_nombre ?? pago.proveedor_id`) — the same defect
 * as the invoice form, just not caught by this test until now. It now
 * falls back to a neutral placeholder, never the id.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PagoFormPage } from './PagoFormPage'

const PROVEEDOR_ID = 'prov-uuid-1'
const PROVEEDOR_NOMBRE = 'YPF S.A.'

const server = setupServer(
  http.get(`/api/pagos/${encodeURIComponent('pago-uuid-1')}`, () => {
    return HttpResponse.json({
      id: 'pago-uuid-1',
      usuario_id: 'user-1',
      proveedor_id: PROVEEDOR_ID,
      monto: 1500,
      fecha: '2026-06-15',
      metodo: 'TRANSFERENCIA',
      comprobante_url: null,
      origen: 'MANUAL',
      created_at: '2026-06-15T10:00:00',
      updated_at: '2026-06-15T10:00:00',
      proveedor_nombre: PROVEEDOR_NOMBRE,
    })
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
        <MemoryRouter initialEntries={['/pagos/pago-uuid-1/editar']}>
          <Routes>
            <Route path="/pagos/:id/editar" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('PagoFormPage — FE-005 edit-mode supplier name display', () => {
  it('displays the supplier name from proveedor_nombre, NOT the UUID', async () => {
    render(<PagoFormPage />, { wrapper: createWrapper() })
    // The readonly supplier field renders in a div with data-testid="proveedor-readonly".
    await waitFor(() => {
      const readonlyField = screen.getByTestId('proveedor-readonly')
      expect(readonlyField).toHaveTextContent(PROVEEDOR_NOMBRE)
    })
    // Assert the UUID is NOT in the readonly field (regression guard).
    const readonlyField = await screen.findByTestId('proveedor-readonly')
    expect(readonlyField).not.toHaveTextContent(PROVEEDOR_ID)
  })

  it('shows a neutral placeholder — never the UUID — when proveedor_nombre is null (soft-deleted supplier, c-26 D1)', async () => {
    // Override the response to simulate a soft-deleted supplier.
    server.use(
      http.get(`/api/pagos/${encodeURIComponent('pago-uuid-1')}`, () => {
        return HttpResponse.json({
          id: 'pago-uuid-1',
          usuario_id: 'user-1',
          proveedor_id: PROVEEDOR_ID,
          monto: 1500,
          fecha: '2026-06-15',
          metodo: 'TRANSFERENCIA',
          comprobante_url: null,
          origen: 'MANUAL',
          created_at: '2026-06-15T10:00:00',
          updated_at: '2026-06-15T10:00:00',
          proveedor_nombre: null,
        })
      }),
    )
    render(<PagoFormPage />, { wrapper: createWrapper() })
    // c-26 (D1): a UUID is not a degraded name, it is noise. The id must
    // never render, soft-deleted or not.
    const readonlyField = await screen.findByTestId('proveedor-readonly')
    expect(readonlyField).not.toHaveTextContent(PROVEEDOR_ID)
    expect(readonlyField.textContent).toMatch(/proveedor no disponible/i)
  })
})
