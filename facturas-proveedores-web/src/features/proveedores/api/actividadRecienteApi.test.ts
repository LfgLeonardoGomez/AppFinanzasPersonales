/**
 * Tests for the actividad-reciente API layer (C-44, D2, D3).
 *
 * MSW intercepts the raw Axios call — no real backend, no TanStack Query
 * (that layer is covered in `actividadRecienteHooks.test.tsx`). Handlers are
 * declared HERE, inside `features/proveedores/`, not reused from another
 * feature's test file — a fixture mocking this endpoint from outside this
 * directory would not appear in a filtered run (design.md Risks, confirmed
 * twice in C-41).
 *
 * Fixtures reproduce the WIRE shape (decimals as strings) — this endpoint
 * used to be consumed by `features/home/api/homeApi.ts`, which cast the raw
 * response straight to a type promising `monto: string` without converting
 * anything. Relocating it into `features/proveedores/` is also where that
 * lie gets fixed (design.md D3).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { getActividadReciente } from './actividadRecienteApi'

// ── Fixtures (wire shape — decimals as strings) ──────────────────────────────

function wireItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tipo: 'factura',
    id: 'act-1',
    proveedor_id: 'prov-1',
    proveedor_nombre: 'Proveedor Uno',
    monto: '1500.50',
    fecha: '2026-06-01',
    created_at: '2026-06-01T10:00:00',
    ...overrides,
  }
}

let responseBody: unknown[] = []
let capturedUrl = ''

const server = setupServer(
  http.get('/api/actividad-reciente', ({ request }) => {
    capturedUrl = request.url
    return HttpResponse.json(responseBody)
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  responseBody = []
  capturedUrl = ''
})

describe('getActividadReciente — wire → public parsing', () => {
  it('converts a string monto to a number', async () => {
    responseBody = [wireItem({ monto: '1500.50' })]
    const items = await getActividadReciente()
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.monto).toBe(1500.5)
    expect(typeof item.monto).toBe('number')
  })

  it('sends the limit as a query param', async () => {
    responseBody = [wireItem()]
    await getActividadReciente(8)
    expect(capturedUrl).toContain('limit=8')
  })

  it('throws on an empty-string monto — Number(\'\') is 0, not NaN', async () => {
    responseBody = [wireItem({ monto: '' })]
    await expect(getActividadReciente()).rejects.toThrow(/getActividadReciente|monto/i)
  })

  it('throws on a non-numeric monto, never degrades to 0', async () => {
    responseBody = [wireItem({ monto: 'garbage' })]
    await expect(getActividadReciente()).rejects.toThrow(/getActividadReciente|monto/i)
  })

  it('normalizes an absent proveedor_nombre to null without dropping the row', async () => {
    const raw = wireItem()
    delete (raw as Record<string, unknown>).proveedor_nombre
    responseBody = [raw]
    const items = await getActividadReciente()
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.proveedor_nombre).toBeNull()
    expect(item.id).toBe('act-1')
  })

  it('normalizes a null proveedor_nombre to null', async () => {
    responseBody = [wireItem({ proveedor_nombre: null })]
    const items = await getActividadReciente()
    expect(items).toHaveLength(1)
    expect(items[0]!.proveedor_nombre).toBeNull()
  })

  it('preserves tipo, id and fecha untouched by the monto conversion', async () => {
    responseBody = [wireItem({ tipo: 'pago', id: 'act-2', fecha: '2026-06-02' })]
    const items = await getActividadReciente()
    expect(items).toHaveLength(1)
    const item = items[0]!
    expect(item.tipo).toBe('pago')
    expect(item.id).toBe('act-2')
    expect(item.fecha).toBe('2026-06-02')
  })
})
