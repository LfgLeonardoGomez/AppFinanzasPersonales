/**
 * Tests for the "Actividad reciente" panel (C-44, spec `proveedores-frontend`).
 *
 * Relocated from `HomePage.tsx` — now fetches its own data via
 * `useActividadReciente` (D2), with MSW handlers declared here, inside
 * `features/proveedores/` (design.md Risks: a fixture mocking this endpoint
 * from outside this directory does not appear in a filtered run).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { ActividadReciente } from './ActividadReciente'

function wireItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tipo: 'factura',
    id: 'act-1',
    proveedor_id: 'prov-1',
    proveedor_nombre: 'Proveedor Uno',
    monto: '1500.50',
    fecha: '2026-06-01',
    created_at: new Date().toISOString(),
    ...overrides,
  }
}

let responseBody: unknown[] = []

const server = setupServer(
  http.get('/api/actividad-reciente', () => HttpResponse.json(responseBody)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  responseBody = []
})

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
  return render(<ActividadReciente />, { wrapper: Wrapper })
}

describe('ActividadReciente', () => {
  it('renders one row per movement, distinguishing factura from pago', async () => {
    responseBody = [
      wireItem({ id: 'act-1', tipo: 'factura' }),
      wireItem({ id: 'act-2', tipo: 'pago' }),
    ]
    renderPanel()

    const facturaRow = await screen.findByTestId('actividad-row-act-1')
    const pagoRow = screen.getByTestId('actividad-row-act-2')
    expect(within(facturaRow).getByText(/^Factura/)).toBeInTheDocument()
    expect(within(pagoRow).getByText(/^Pago/)).toBeInTheDocument()
  })

  it('shows an explicit empty state when there are no movements', async () => {
    responseBody = []
    renderPanel()

    expect(await screen.findByText('Sin movimientos recientes.')).toBeInTheDocument()
  })

  it('shows a row without a proveedor name instead of omitting it', async () => {
    responseBody = [wireItem({ id: 'act-1', proveedor_nombre: null })]
    renderPanel()

    const row = await screen.findByTestId('actividad-row-act-1')
    expect(row).toBeInTheDocument()
    expect(row).toHaveTextContent('Factura')
  })

  it('renders rows in the order the backend returned them, without reordering', async () => {
    // A non-trivial order (newest-looking id last, oldest-looking id first)
    // — if the component ever sorted by id, tipo, or fecha, this would catch it.
    responseBody = [
      wireItem({ id: 'act-3', tipo: 'pago', fecha: '2026-06-01' }),
      wireItem({ id: 'act-1', tipo: 'factura', fecha: '2026-06-03' }),
      wireItem({ id: 'act-2', tipo: 'factura', fecha: '2026-06-02' }),
    ]
    renderPanel()

    await screen.findByTestId('actividad-row-act-3')
    const rows = screen.getAllByRole('listitem')
    expect(rows.map((r) => r.getAttribute('data-testid'))).toEqual([
      'actividad-row-act-3',
      'actividad-row-act-1',
      'actividad-row-act-2',
    ])
  })
})
