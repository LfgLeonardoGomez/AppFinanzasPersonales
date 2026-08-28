/**
 * Tests for the estadísticas screen (C-38, task 11.1).
 *
 * Two things this page has to get right:
 *   1. ONE selector drives both panels — not one each.
 *   2. It is a separate route from /ventas, so the statistics range and the
 *      sales-list filter never share the same `desde`/`hasta` params
 *      (design.md D2).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { EstadisticasPage } from './EstadisticasPage'

const granularidadesPedidas: string[] = []

const server = setupServer(
  http.get('/api/estadisticas/ventas', ({ request }) => {
    granularidadesPedidas.push(new URL(request.url).searchParams.get('granularidad') ?? '')
    return HttpResponse.json({
      desde: '2026-07-28',
      hasta: '2026-08-26',
      granularidad: 'dia',
      periodos: [
        {
          periodo: '2026-08-01',
          desde: '2026-08-01',
          hasta: '2026-08-01',
          total: '1500.00',
          desglose: {
            EFECTIVO: '1500.00',
            TRANSFERENCIA: '0.00',
            TARJETA: '0.00',
            CUENTA_CORRIENTE: '0.00',
            OTRO: '0.00',
          },
        },
      ],
    })
  }),

  http.get('/api/estadisticas/resumen', () =>
    HttpResponse.json({
      desde: '2026-07-28',
      hasta: '2026-08-26',
      compras: '800.00',
      ventas: '1500.00',
      diferencia: '700.00',
    }),
  ),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  granularidadesPedidas.length = 0
})

function renderPage(entry = '/estadisticas') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </MemoryRouter>
  )
  return render(<EstadisticasPage />, { wrapper: Wrapper })
}

describe('EstadisticasPage', () => {
  it('renders exactly ONE range + granularity selector for both panels', async () => {
    renderPage()

    await screen.findByTestId('estadisticas-page')
    expect(screen.getAllByRole('search', { name: /rango y granularidad/i })).toHaveLength(1)
  })

  it('shows both the contrast and the sales panel', async () => {
    renderPage()

    expect(await screen.findByRole('region', { name: /compras contra ventas/i })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: /ventas por período/i })).toBeInTheDocument()
  })

  it('drives the sales panel from the shared selector', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => expect(granularidadesPedidas).toContain('dia'))

    const grupo = screen.getByRole('group', { name: /granularidad/i })
    await user.click(within(grupo).getByRole('button', { name: /^mes$/i }))

    await waitFor(() => expect(granularidadesPedidas).toContain('mes'))
  })

  it('reads its range from the URL', async () => {
    renderPage('/estadisticas?desde=2026-01-01&hasta=2026-01-31&granularidad=semana')

    await waitFor(() => expect(granularidadesPedidas).toContain('semana'))
  })
})
