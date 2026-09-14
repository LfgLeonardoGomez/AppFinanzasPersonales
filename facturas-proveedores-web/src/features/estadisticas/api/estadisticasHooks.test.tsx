/**
 * TanStack Query hook tests for estadísticas (C-38, task 4.3).
 *
 * The important behaviour here is the query KEY. The spec requires that
 * changing the granularity refetches rather than reslicing what is already
 * cached — the frontend must never re-bucket a series it already has, because
 * that would be a second implementation of the backend's aggregation, and a
 * second implementation is a number that can one day disagree with the first.
 *
 * A key that omitted `granularidad` would serve the `mes` series when the
 * user asked for `dia`, and the screen would look perfectly fine.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { useVentasEstadisticas, useResumen } from './estadisticasHooks'

// ── Wire fixtures ────────────────────────────────────────────────────────────

const wireVentas = {
  desde: '2026-01-01',
  hasta: '2026-01-31',
  granularidad: 'dia',
  periodos: [
    {
      periodo: '2026-01-01',
      desde: '2026-01-01',
      hasta: '2026-01-01',
      total: '500.00',
      desglose: {
        EFECTIVO: '500.00',
        TRANSFERENCIA: '0.00',
        TARJETA: '0.00',
        CUENTA_CORRIENTE: '0.00',
        OTRO: '0.00',
      },
    },
  ],
}

const wireResumen = {
  desde: '2026-01-01',
  hasta: '2026-01-31',
  compras: '800.00',
  ventas: '1250.75',
  diferencia: '450.75',
}

// ── MSW ──────────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/estadisticas/ventas', () => HttpResponse.json(wireVentas)),
  http.get('/api/estadisticas/resumen', () => HttpResponse.json(wireResumen)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, Wrapper }
}

// ── useVentasEstadisticas / useResumen ───────────────────────────────────────

describe('useVentasEstadisticas', () => {
  it('exposes the parsed series with its desglose', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () =>
        useVentasEstadisticas({ desde: '2026-01-01', hasta: '2026-01-31', granularidad: 'dia' }),
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.periodos[0]!.desglose.EFECTIVO).toBe(500)
  })
})

describe('useResumen', () => {
  it('exposes compras, ventas and diferencia as numbers', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useResumen({ desde: '2026-01-01', hasta: '2026-01-31' }),
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.diferencia).toBe(450.75)
  })
})
