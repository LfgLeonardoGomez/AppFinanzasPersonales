/**
 * Tests for the sales panel with its payment-method breakdown (C-38,
 * tasks 9.1-9.3).
 *
 * The load-bearing assertion is "the breakdown adds up to the total" — read
 * from the DOM, on numbers the component did not compute. The backend
 * guarantees `sum(desglose) === total` by construction because it derives
 * both from the same grouped rows; if the frontend ever starts summing the
 * breakdown to produce the total, that guarantee turns into a second
 * implementation that can drift.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import type { ReactNode } from 'react'
import { PanelVentas } from './PanelVentas'

const respuestaPorDefecto = () =>
  HttpResponse.json({
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
          EFECTIVO: '900.00',
          TRANSFERENCIA: '400.00',
          TARJETA: '200.00',
          CUENTA_CORRIENTE: '0.00',
          OTRO: '0.00',
        },
      },
    ],
  }) as unknown as Response

let respond: () => Response = respuestaPorDefecto

const server = setupServer(http.get('/api/estadisticas/ventas', () => respond()))

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
  return render(
    <PanelVentas rango={{ desde: '2026-07-28', hasta: '2026-08-26', granularidad: 'dia' }} />,
    { wrapper: Wrapper },
  )
}

/** Reads "$ 1.234,56" back into 1234.56 — the same text a user reads. */
function montoDesdeTexto(texto: string): number {
  const limpio = texto.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')
  return Number(limpio)
}

describe('PanelVentas — desglose', () => {
  it('shows the breakdown with human labels, never the raw enum', async () => {
    renderPanel()

    const desglose = await screen.findByRole('list', { name: /desglose/i })
    expect(within(desglose).getByText('Cuenta corriente')).toBeInTheDocument()
    expect(within(desglose).queryByText('CUENTA_CORRIENTE')).not.toBeInTheDocument()
  })

  it('the displayed breakdown adds up to the displayed total', async () => {
    renderPanel()

    const desglose = await screen.findByRole('list', { name: /desglose/i })
    const montos = within(desglose)
      .getAllByTestId('desglose-monto')
      .map((el) => montoDesdeTexto(el.textContent ?? ''))
    const suma = montos.reduce((acc, n) => acc + n, 0)

    const total = montoDesdeTexto(screen.getByTestId('periodo-total').textContent ?? '')

    expect(suma).toBeCloseTo(total, 2)
    expect(total).toBe(1500)
  })

  it('keeps a payment method at zero, with its label', async () => {
    renderPanel()

    const desglose = await screen.findByRole('list', { name: /desglose/i })
    expect(within(desglose).getAllByTestId('desglose-monto')).toHaveLength(5)
    expect(within(desglose).getByText('Tarjeta')).toBeInTheDocument()
  })

  it('does NOT recompute the total from the breakdown', async () => {
    // Deliberately inconsistent wire data: if the panel summed the breakdown
    // to render the total, it would show 1400 instead of the 1500 the
    // backend sent.
    respond = () =>
      HttpResponse.json({
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
              EFECTIVO: '1400.00',
              TRANSFERENCIA: '0.00',
              TARJETA: '0.00',
              CUENTA_CORRIENTE: '0.00',
              OTRO: '0.00',
            },
          },
        ],
      }) as unknown as Response

    renderPanel()

    const total = await screen.findByTestId('periodo-total')
    expect(montoDesdeTexto(total.textContent ?? '')).toBe(1500)
  })
})

describe('PanelVentas — states', () => {
  it('shows a loading affordance before the data arrives', () => {
    renderPanel()

    expect(screen.getAllByRole('status').length).toBeGreaterThan(0)
  })

  it('says there was no movement when the range is empty', async () => {
    respond = () =>
      HttpResponse.json({
        desde: '2026-07-28',
        hasta: '2026-08-26',
        granularidad: 'dia',
        periodos: [],
      }) as unknown as Response

    renderPanel()

    expect(await screen.findByText(/sin movimiento/i)).toBeInTheDocument()
  })
})
