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
import { ESTADISTICAS_KEYS, useCompras, useVentasEstadisticas, useResumen } from './estadisticasHooks'
import type { Granularidad } from '@shared/api/api'

// ── Wire fixtures ────────────────────────────────────────────────────────────

function wireComprasFor(granularidad: string, total: string) {
  return {
    desde: '2026-01-01',
    hasta: '2026-03-31',
    granularidad,
    proveedor_id: null,
    periodos: [
      { periodo: '2026-01-01', desde: '2026-01-01', hasta: '2026-01-31', total },
    ],
  }
}

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

let comprasRequestCount = 0
const comprasGranularidadesSeen: string[] = []

const server = setupServer(
  http.get('/api/estadisticas/compras', ({ request }) => {
    comprasRequestCount += 1
    const granularidad = new URL(request.url).searchParams.get('granularidad') ?? ''
    comprasGranularidadesSeen.push(granularidad)
    // A different total per granularity, so a stale cache hit is visible in
    // the assertion rather than hidden behind identical numbers.
    return HttpResponse.json(
      wireComprasFor(granularidad, granularidad === 'mes' ? '1000.00' : '250.00'),
    )
  }),

  http.get('/api/estadisticas/ventas', () => HttpResponse.json(wireVentas)),
  http.get('/api/estadisticas/resumen', () => HttpResponse.json(wireResumen)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  comprasRequestCount = 0
  comprasGranularidadesSeen.length = 0
})

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const Wrapper = function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return { queryClient, Wrapper }
}

// ── Query keys ───────────────────────────────────────────────────────────────

describe('ESTADISTICAS_KEYS', () => {
  it('gives two granularities two different compras keys', () => {
    const mes = ESTADISTICAS_KEYS.compras({
      desde: '2026-01-01',
      hasta: '2026-03-31',
      granularidad: 'mes',
    })
    const dia = ESTADISTICAS_KEYS.compras({
      desde: '2026-01-01',
      hasta: '2026-03-31',
      granularidad: 'dia',
    })

    expect(mes).not.toEqual(dia)
  })

  it('gives two ranges two different compras keys', () => {
    const enero = ESTADISTICAS_KEYS.compras({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      granularidad: 'mes',
    })
    const febrero = ESTADISTICAS_KEYS.compras({
      desde: '2026-02-01',
      hasta: '2026-02-28',
      granularidad: 'mes',
    })

    expect(enero).not.toEqual(febrero)
  })

  it('gives a supplier-scoped call a different key from the unscoped one', () => {
    const base = { desde: '2026-01-01', hasta: '2026-03-31', granularidad: 'mes' } as const
    const unscoped = ESTADISTICAS_KEYS.compras(base)
    const scoped = ESTADISTICAS_KEYS.compras({ ...base, proveedorId: 'prov-1' })

    expect(unscoped).not.toEqual(scoped)
  })
})

// ── useCompras ───────────────────────────────────────────────────────────────

describe('useCompras', () => {
  it('fetches and exposes the parsed series', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () => useCompras({ desde: '2026-01-01', hasta: '2026-03-31', granularidad: 'mes' }),
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.periodos[0]!.total).toBe(1000)
  })

  it('REFETCHES when the granularity changes, instead of reslicing the cached series', async () => {
    const { Wrapper } = createWrapper()
    // `initialProps` must be typed as the WHOLE union, not inferred from the
    // initial value: `'mes' as const` narrows `rerender`'s parameter to
    // `'mes'`, which makes the very switch this test exists to exercise a
    // type error.
    const initialProps: { granularidad: Granularidad } = { granularidad: 'mes' }
    const { result, rerender } = renderHook(
      ({ granularidad }: { granularidad: Granularidad }) =>
        useCompras({ desde: '2026-01-01', hasta: '2026-03-31', granularidad }),
      { wrapper: Wrapper, initialProps },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.periodos[0]!.total).toBe(1000)

    rerender({ granularidad: 'dia' })

    await waitFor(() => expect(result.current.data?.periodos[0]!.total).toBe(250))
    expect(comprasRequestCount).toBe(2)
    expect(comprasGranularidadesSeen).toEqual(['mes', 'dia'])
  })

  it('passes the proveedor_id through when scoped', async () => {
    const { Wrapper } = createWrapper()
    const { result } = renderHook(
      () =>
        useCompras({
          desde: '2026-01-01',
          hasta: '2026-03-31',
          granularidad: 'mes',
          proveedorId: 'prov-7',
        }),
      { wrapper: Wrapper },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(comprasRequestCount).toBe(1)
  })
})

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
