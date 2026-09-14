/**
 * Tests for the estadísticas API layer (C-38, tasks 4.1-4.2).
 *
 * MSW intercepts the raw Axios calls — no real backend, no TanStack Query
 * (that layer is covered in `estadisticasHooks.test.tsx`). Mirrors the
 * plain-async-function style of `ventasApi.test.ts`.
 *
 * The query string IS the contract here: a dropped `granularidad` or a
 * `proveedor_id` sent when it should not be would silently return a
 * different — but perfectly plausible — set of numbers.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { getVentas, getResumen } from './estadisticasApi'

// ── Fixtures (wire shape — decimals as strings) ──────────────────────────────

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

// ── MSW Server ───────────────────────────────────────────────────────────────

let capturedUrl = ''

const server = setupServer(
  http.get('/api/estadisticas/ventas', ({ request }) => {
    capturedUrl = request.url
    return HttpResponse.json(wireVentas)
  }),

  http.get('/api/estadisticas/resumen', ({ request }) => {
    capturedUrl = request.url
    return HttpResponse.json(wireResumen)
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedUrl = ''
})

function params(): URLSearchParams {
  return new URL(capturedUrl).searchParams
}

// ── getVentas (task 4.2) ─────────────────────────────────────────────────────

describe('getVentas', () => {
  it('sends desde, hasta and granularidad', async () => {
    await getVentas({ desde: '2026-01-01', hasta: '2026-01-31', granularidad: 'dia' })

    expect(params().get('desde')).toBe('2026-01-01')
    expect(params().get('hasta')).toBe('2026-01-31')
    expect(params().get('granularidad')).toBe('dia')
  })

  it('never sends proveedor_id — the ventas endpoint does not accept one', async () => {
    await getVentas({ desde: '2026-01-01', hasta: '2026-01-31', granularidad: 'dia' })

    expect(capturedUrl).not.toContain('proveedor_id')
  })

  it('returns the parsed response, with the desglose as numbers', async () => {
    const res = await getVentas({
      desde: '2026-01-01',
      hasta: '2026-01-31',
      granularidad: 'dia',
    })

    expect(res.periodos[0]!.total).toBe(500)
    expect(res.periodos[0]!.desglose.EFECTIVO).toBe(500)
    expect(res.periodos[0]!.desglose.TARJETA).toBe(0)
  })
})

// ── getResumen (task 4.2) ────────────────────────────────────────────────────

describe('getResumen', () => {
  it('sends only desde and hasta — resumen takes no granularidad', async () => {
    await getResumen({ desde: '2026-01-01', hasta: '2026-01-31' })

    expect(params().get('desde')).toBe('2026-01-01')
    expect(params().get('hasta')).toBe('2026-01-31')
    expect(params().has('granularidad')).toBe(false)
  })

  it('returns the parsed response, with decimals as numbers', async () => {
    const res = await getResumen({ desde: '2026-01-01', hasta: '2026-01-31' })

    expect(res.compras).toBe(800)
    expect(res.ventas).toBe(1250.75)
    expect(res.diferencia).toBe(450.75)
  })
})
