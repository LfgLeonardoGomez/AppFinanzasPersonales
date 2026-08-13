/**
 * Tests for the sales API layer (C-34, tasks 5.1-5.4).
 *
 * MSW intercepts the raw Axios calls — no real backend, no TanStack Query
 * involved (that layer is covered separately in ventasHooks.test.tsx).
 * Mirrors the plain-async-function style of `clientesApi.test.ts` /
 * `pagosApi.ts`.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { listVentas, createVenta, updateVenta, deleteVenta } from './ventasApi'
import type { Venta, VentaListItem } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockVentaEfectivo: VentaListItem = {
  id: 'venta-1',
  negocio_id: 'negocio-1',
  cliente_id: null,
  fecha: '2026-08-10',
  monto: '1000.00',
  forma_pago: 'EFECTIVO',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
}

const mockVentaFiada: Venta = {
  id: 'venta-2',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  fecha: '2026-08-10',
  monto: '500.00',
  forma_pago: 'CUENTA_CORRIENTE',
  notas: null,
  created_at: '2026-08-10T10:00:00',
  updated_at: '2026-08-10T10:00:00',
}

// ── MSW Server ────────────────────────────────────────────────────────────────

let capturedUrl = ''
let lastCreatedBody: Record<string, unknown> | null = null
let lastPatchedBody: Record<string, unknown> | null = null

const server = setupServer(
  http.get('/api/ventas', ({ request }) => {
    capturedUrl = request.url
    return HttpResponse.json([mockVentaEfectivo])
  }),

  http.post('/api/ventas', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    lastCreatedBody = body
    return HttpResponse.json({ ...mockVentaFiada, ...body }, { status: 201 })
  }),

  http.patch('/api/ventas/:id', async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>
    lastPatchedBody = body
    return HttpResponse.json({ ...mockVentaFiada, ...body })
  }),

  http.delete('/api/ventas/:id', () => new HttpResponse(null, { status: 204 })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedUrl = ''
  lastCreatedBody = null
  lastPatchedBody = null
})

// ── listVentas (task 5.1) ────────────────────────────────────────────────────

describe('listVentas', () => {
  it('sends desde, hasta, forma_pago and cliente_id when all are set', async () => {
    await listVentas({
      desde: '2026-08-01',
      hasta: '2026-08-31',
      forma_pago: 'CUENTA_CORRIENTE',
      cliente_id: 'cliente-1',
    })
    const url = new URL(capturedUrl)
    expect(url.searchParams.get('desde')).toBe('2026-08-01')
    expect(url.searchParams.get('hasta')).toBe('2026-08-31')
    expect(url.searchParams.get('forma_pago')).toBe('CUENTA_CORRIENTE')
    expect(url.searchParams.get('cliente_id')).toBe('cliente-1')
  })

  it('omits empty filters entirely (triangulation) — no filter keys appear at all', async () => {
    await listVentas({})
    const url = new URL(capturedUrl)
    expect(url.searchParams.has('desde')).toBe(false)
    expect(url.searchParams.has('hasta')).toBe(false)
    expect(url.searchParams.has('forma_pago')).toBe(false)
    expect(url.searchParams.has('cliente_id')).toBe(false)
  })

  it('omits only the filters left unset when some are provided (triangulation)', async () => {
    await listVentas({ desde: '2026-08-01' })
    const url = new URL(capturedUrl)
    expect(url.searchParams.get('desde')).toBe('2026-08-01')
    expect(url.searchParams.has('hasta')).toBe(false)
    expect(url.searchParams.has('forma_pago')).toBe(false)
    expect(url.searchParams.has('cliente_id')).toBe(false)
  })
})

// ── createVenta (task 5.2) ───────────────────────────────────────────────────

describe('createVenta', () => {
  it('posts cliente_id when forma_pago is CUENTA_CORRIENTE', async () => {
    await createVenta({
      monto: '500.00',
      fecha: '2026-08-10',
      forma_pago: 'CUENTA_CORRIENTE',
      cliente_id: 'cliente-1',
    })
    expect(lastCreatedBody).not.toBeNull()
    expect(lastCreatedBody?.cliente_id).toBe('cliente-1')
  })

  it('does NOT post cliente_id when forma_pago is EFECTIVO (triangulation)', async () => {
    await createVenta({
      monto: '1000.00',
      fecha: '2026-08-10',
      forma_pago: 'EFECTIVO',
    })
    expect(lastCreatedBody).not.toBeNull()
    expect(lastCreatedBody).not.toHaveProperty('cliente_id')
  })
})

// ── updateVenta (task 5.3 — D5/D7 contract) ─────────────────────────────────

describe('updateVenta', () => {
  it('never sends cliente_id: null — leaving cuenta corriente sends only the new forma_pago', async () => {
    await updateVenta('venta-2', { forma_pago: 'EFECTIVO' })
    expect(lastPatchedBody).not.toBeNull()
    expect(lastPatchedBody?.forma_pago).toBe('EFECTIVO')
    expect(lastPatchedBody).not.toHaveProperty('cliente_id')
  })

  it('forwards cliente_id when explicitly given (triangulation, e.g. staying on account with a new customer)', async () => {
    await updateVenta('venta-2', { forma_pago: 'CUENTA_CORRIENTE', cliente_id: 'cliente-3' })
    expect(lastPatchedBody).not.toBeNull()
    expect(lastPatchedBody?.cliente_id).toBe('cliente-3')
  })
})

// ── deleteVenta (task 5.4) ────────────────────────────────────────────────────

describe('deleteVenta', () => {
  it('deletes by id, taking a VentaDeleteInput carrying cliente_id and forma_pago', async () => {
    await expect(
      deleteVenta({ id: 'venta-2', cliente_id: 'cliente-1', forma_pago: 'CUENTA_CORRIENTE' }),
    ).resolves.toBeUndefined()
  })

  it('deletes a cash sale too (triangulation — null cliente_id)', async () => {
    await expect(
      deleteVenta({ id: 'venta-1', cliente_id: null, forma_pago: 'EFECTIVO' }),
    ).resolves.toBeUndefined()
  })
})
