/**
 * Tests for the "Proveedores frecuentes" panel (C-44, spec
 * `proveedores-frontend`, D2, D4).
 *
 * Relocated from `HomePage.tsx`. Fetches via `useProveedores({ orderBy:
 * 'saldo' })` — the feature's own hook (D2: no second HTTP client against
 * `/proveedores`) — and cuts to 6 in the component.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ProveedoresFrecuentes } from './ProveedoresFrecuentes'
import { ProveedoresList } from './ProveedoresList'

function wireListItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'prov-1',
    nombre: 'Proveedor Uno',
    cuit: null,
    categoria: 'OTRO',
    saldo: '2500.00',
    ultima_factura_fecha: null,
    ...overrides,
  }
}

let responseBody: unknown[] = []

const server = setupServer(
  http.get('/api/proveedores', () => HttpResponse.json(responseBody)),
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
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  return render(<ProveedoresFrecuentes />, { wrapper: Wrapper })
}

describe('ProveedoresFrecuentes', () => {
  it("shows each supplier's name and saldo", async () => {
    responseBody = [wireListItem({ id: 'prov-1', nombre: 'Proveedor Uno', saldo: '2500.00' })]
    renderPanel()

    expect(await screen.findByText('Proveedor Uno')).toBeInTheDocument()
    expect(screen.getByText(/2\.500/)).toBeInTheDocument()
  })

  it('shows an explicit empty state when there are no suppliers', async () => {
    responseBody = []
    renderPanel()

    expect(await screen.findByText('Sin proveedores')).toBeInTheDocument()
  })

  it('the factura and pago shortcuts lead to the create form with the supplier pre-identified', async () => {
    responseBody = [wireListItem({ id: 'prov-1', nombre: 'Proveedor Uno' })]
    renderPanel()

    const card = await screen.findByTestId('proveedor-frecuente-prov-1')
    expect(within(card).getByRole('link', { name: /factura/i })).toHaveAttribute(
      'href',
      '/facturas/nueva?proveedor_id=prov-1',
    )
    expect(within(card).getByRole('link', { name: /pago/i })).toHaveAttribute(
      'href',
      '/pagos/nuevo?proveedor_id=prov-1',
    )
  })
})

describe('ProveedoresFrecuentes + ProveedoresList — sign convention (D4)', () => {
  it('shows the same saldo, same sign, same color, for a supplier present in both panels', async () => {
    // A single supplier answers BOTH `GET /proveedores` calls this screen
    // makes (the list's default `order_by=nombre` and the panel's
    // `order_by=saldo`) — this test doesn't care which query produced it,
    // only that the SAME proveedor reads the SAME way in both panels.
    responseBody = [wireListItem({ id: 'prov-1', nombre: 'Proveedor Uno', saldo: '2500.00' })]

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <ProveedoresList onNewProveedor={() => {}} onEditProveedor={() => {}} />
          <ProveedoresFrecuentes />
        </QueryClientProvider>
      </MemoryRouter>,
    )

    await screen.findByRole('link', { name: /ver cuenta corriente/i })
    await screen.findByTestId('proveedor-frecuente-prov-1')

    // formatSaldo inverts the backend sign for display — saldo=2500 (debt)
    // renders as "-$ 2.500,00" with the danger color, in BOTH panels. Two
    // matches, same pattern, same color class — one from the list card, one
    // from the frecuentes card.
    const saldoElements = screen.getAllByText(/-\$?\s*2\.500,00/)
    expect(saldoElements).toHaveLength(2)
    for (const el of saldoElements) {
      expect(el.className).toContain('text-danger')
    }
  })
})
