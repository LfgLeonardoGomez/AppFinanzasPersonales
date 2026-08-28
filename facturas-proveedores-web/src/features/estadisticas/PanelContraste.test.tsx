/**
 * Tests for the purchases-vs-sales panel (C-38, tasks 10.1-10.3).
 *
 * The naming test is the important one. `diferencia` is NOT a margin: the
 * system does not know what the goods it sold cost — a supplier invoice is
 * the shop's own purchase, not the cost of any particular sale (C-37 D6).
 * Labelling it "margen" would put an accounting word on a number that does
 * not mean that, and the number would look entirely plausible.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PanelContraste } from './PanelContraste'

const respuestaPorDefecto = () =>
  HttpResponse.json({
    desde: '2025-08-26',
    hasta: '2026-08-26',
    compras: '800.00',
    ventas: '1250.75',
    diferencia: '450.75',
  }) as unknown as Response

let respond: () => Response = respuestaPorDefecto

const server = setupServer(http.get('/api/estadisticas/resumen', () => respond()))

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  respond = respuestaPorDefecto
})

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={['/estadisticas']}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  return render(<PanelContraste desde="2025-08-26" hasta="2026-08-26" />, { wrapper: Wrapper })
}

describe('PanelContraste', () => {
  it('shows compras, ventas and diferencia as the backend sent them', async () => {
    renderPanel()

    expect(await screen.findByTestId('contraste-compras')).toHaveTextContent(/800/)
    expect(screen.getByTestId('contraste-ventas')).toHaveTextContent(/1\.250,75/)
    expect(screen.getByTestId('contraste-diferencia')).toHaveTextContent(/450,75/)
  })

  it('does NOT call the difference a margin, a profit or a return', async () => {
    renderPanel()

    const seccion = await screen.findByRole('region', { name: /compras.*ventas|contraste/i })
    expect(seccion.textContent).not.toMatch(/margen|rentabilidad|ganancia|utilidad/i)
  })

  it('labels the third value as "diferencia"', async () => {
    renderPanel()

    expect(await screen.findByText(/diferencia/i)).toBeInTheDocument()
  })

  it('keeps a negative difference negative — it neither hides it nor flips its sign', async () => {
    respond = () =>
      HttpResponse.json({
        desde: '2025-08-26',
        hasta: '2026-08-26',
        compras: '2000.00',
        ventas: '1200.00',
        diferencia: '-800.00',
      }) as unknown as Response

    renderPanel()

    const diferencia = await screen.findByTestId('contraste-diferencia')
    expect(diferencia.textContent).toMatch(/-/)
    expect(diferencia).toHaveTextContent(/800/)
  })

  it('shows a loading affordance and NO zero before the data arrives', () => {
    renderPanel()

    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByTestId('contraste-compras')).not.toBeInTheDocument()
  })

  it('renders the actionable message on a 422', async () => {
    respond = () =>
      HttpResponse.json({ detail: '`desde` no puede ser posterior a `hasta`.' }, { status: 422 }) as unknown as Response

    renderPanel()

    expect(await screen.findByRole('alert')).toHaveTextContent(/rango/i)
  })
})
