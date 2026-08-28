/**
 * Tests for the supplier purchases panel (C-38, tasks 8.1-8.2).
 *
 * This panel is what closes the original request that started the whole
 * statistics line: "how much did I buy from this supplier?".
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PanelComprasProveedor } from './PanelComprasProveedor'

let capturedUrl = ''

/** The happy-path payload. `afterEach` restores it, so a test that swaps in
 *  an error response cannot leak that response into the next test. */
const respuestaPorDefecto = () =>
  HttpResponse.json({
    desde: '2025-08-26',
    hasta: '2026-08-26',
    granularidad: 'mes',
    proveedor_id: 'prov-1',
    periodos: [
      { periodo: '2026-01-01', desde: '2026-01-01', hasta: '2026-01-31', total: '1000.00' },
      { periodo: '2026-02-01', desde: '2026-02-01', hasta: '2026-02-28', total: '0.00' },
      { periodo: '2026-03-01', desde: '2026-03-01', hasta: '2026-03-31', total: '2500.00' },
    ],
  }) as unknown as Response

let respond: () => Response = respuestaPorDefecto

const server = setupServer(
  http.get('/api/estadisticas/compras', ({ request }) => {
    capturedUrl = request.url
    return respond()
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedUrl = ''
  respond = respuestaPorDefecto
})

function renderPanel(proveedorId = 'prov-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/proveedores/prov-1']}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  return render(<PanelComprasProveedor proveedorId={proveedorId} />, { wrapper: Wrapper })
}

describe('PanelComprasProveedor', () => {
  it('scopes the request to THIS supplier', async () => {
    renderPanel('prov-42')

    await waitFor(() => expect(capturedUrl).not.toBe(''))
    expect(new URL(capturedUrl).searchParams.get('proveedor_id')).toBe('prov-42')
  })

  it('shows the totals the backend returned', async () => {
    renderPanel()

    const valores = await screen.findByRole('list', { name: /valores/i })
    expect(within(valores).getByText(/1\.000/)).toBeInTheDocument()
    expect(within(valores).getByText(/2\.500/)).toBeInTheDocument()
  })

  it('keeps the zero period rather than dropping it', async () => {
    renderPanel()

    const valores = await screen.findByRole('list', { name: /valores/i })
    expect(within(valores).getAllByRole('listitem')).toHaveLength(3)
  })

  it('shows a loading affordance before the data arrives', () => {
    renderPanel()

    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('reports a 404 as a missing supplier, without revealing it belongs to another business', async () => {
    respond = () =>
      HttpResponse.json({ detail: 'Proveedor not found' }, { status: 404 }) as unknown as Response

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/proveedor/i)
    expect(alert.textContent).not.toMatch(/otro negocio|no te pertenece|sin permiso/i)
  })

  it('renders the actionable message when the range exceeds the period cap', async () => {
    respond = () =>
      HttpResponse.json(
        {
          detail: {
            mensaje: 'El rango pedido produciría 732 períodos, por encima del tope de 400.',
            periodos_estimados: 732,
            tope: 400,
            sugerencia: 'Usá una granularidad más gruesa o un rango más corto.',
          },
        },
        { status: 422 },
      ) as unknown as Response

    renderPanel()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/732/)
    expect(alert).toHaveTextContent(/granularidad/i)
  })
})
