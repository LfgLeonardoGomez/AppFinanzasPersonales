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

// ── createVenta — Idempotency-Key (C-42, tasks 9.1-9.3, 9.11) ─────────────────
//
// These exercise the REAL createVenta → apiClient → MSW path, capturing the
// `Idempotency-Key` header MSW actually received — not a mock of
// `idempotency.ts` or `submitOutcome.ts`.

describe('createVenta — Idempotency-Key (C-42)', () => {
  it('always sends an Idempotency-Key header with a valid UUID (task 9.1)', async () => {
    let capturedKey: string | null = null
    server.use(
      http.post('/api/ventas', async ({ request }) => {
        capturedKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json(mockVentaFiada, { status: 201 })
      }),
    )

    await createVenta({ monto: '111.00', fecha: '2026-08-10', forma_pago: 'EFECTIVO' })

    expect(capturedKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    )
  })

  it('reuses the same key on a retry of the same payload after a response-less failure (task 9.2)', async () => {
    const capturedKeys: (string | null)[] = []
    let call = 0
    server.use(
      http.post('/api/ventas', ({ request }) => {
        call += 1
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (call === 1) return HttpResponse.error()
        return HttpResponse.json(mockVentaFiada, { status: 201 })
      }),
    )

    const payload = { monto: '222.00', fecha: '2026-08-11', forma_pago: 'EFECTIVO' as const }
    await expect(createVenta(payload)).rejects.toBeTruthy()
    await createVenta(payload)

    expect(capturedKeys).toHaveLength(2)
    expect(capturedKeys[0]).toBe(capturedKeys[1])
  })

  it('mints a new key when the amount changes after a failed attempt (task 9.3, triangulation of 9.2)', async () => {
    const capturedKeys: (string | null)[] = []
    let call = 0
    server.use(
      http.post('/api/ventas', ({ request }) => {
        call += 1
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (call === 1) return HttpResponse.error()
        return HttpResponse.json(mockVentaFiada, { status: 201 })
      }),
    )

    await expect(
      createVenta({ monto: '333.00', fecha: '2026-08-12', forma_pago: 'EFECTIVO' }),
    ).rejects.toBeTruthy()
    await createVenta({ monto: '444.00', fecha: '2026-08-12', forma_pago: 'EFECTIVO' })

    expect(capturedKeys).toHaveLength(2)
    expect(capturedKeys[0]).not.toBe(capturedKeys[1])
  })

  it('the same reuse-on-retry protection covers a fiado payload (task 9.11 — the debt path stays covered)', async () => {
    const capturedKeys: (string | null)[] = []
    let call = 0
    server.use(
      http.post('/api/ventas', ({ request }) => {
        call += 1
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (call === 1) return HttpResponse.error()
        return HttpResponse.json(mockVentaFiada, { status: 201 })
      }),
    )

    const payload = {
      monto: '555.00',
      fecha: '2026-08-13',
      forma_pago: 'CUENTA_CORRIENTE' as const,
      cliente_id: 'cliente-1',
    }
    await expect(createVenta(payload)).rejects.toBeTruthy()
    await createVenta(payload)

    expect(capturedKeys).toHaveLength(2)
    expect(capturedKeys[0]).toBe(capturedKeys[1])
  })

  it('updateVenta and deleteVenta do NOT send an Idempotency-Key (task 9.4 — out of scope, sending one would suggest a protection that does not exist)', async () => {
    let patchHeaderSeen: string | null = null
    let deleteHeaderSeen: string | null = null
    server.use(
      http.patch('/api/ventas/:id', async ({ request }) => {
        patchHeaderSeen = request.headers.get('Idempotency-Key')
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...mockVentaFiada, ...body })
      }),
      http.delete('/api/ventas/:id', ({ request }) => {
        deleteHeaderSeen = request.headers.get('Idempotency-Key')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await updateVenta('venta-2', { forma_pago: 'EFECTIVO' })
    await deleteVenta({ id: 'venta-2', cliente_id: 'cliente-1', forma_pago: 'CUENTA_CORRIENTE' })

    expect(patchHeaderSeen).toBeNull()
    expect(deleteHeaderSeen).toBeNull()
  })

  it('resolves { venta, replay: false } on an ordinary 201 creation', async () => {
    server.use(
      http.post('/api/ventas', () => HttpResponse.json(mockVentaFiada, { status: 201 })),
    )
    const result = await createVenta({ monto: '666.00', fecha: '2026-08-14', forma_pago: 'EFECTIVO' })
    expect(result.replay).toBe(false)
    expect(result.venta.id).toBe(mockVentaFiada.id)
  })

  it('resolves { venta, replay: true } on a 200 + Idempotent-Replay: true response (real MSW header, not a mocked module)', async () => {
    server.use(
      http.post('/api/ventas', () =>
        HttpResponse.json(mockVentaFiada, { status: 200, headers: { 'Idempotent-Replay': 'true' } }),
      ),
    )
    const result = await createVenta({ monto: '777.00', fecha: '2026-08-15', forma_pago: 'EFECTIVO' })
    expect(result.replay).toBe(true)
    expect(result.venta.id).toBe(mockVentaFiada.id)
  })

  // ── Review fix (finding 1, CRITICAL) — cross-submission race through the
  // real createVenta call sites, not just idempotency.ts in isolation. ──────
  it('a slow sale A resolving AFTER a different sale B overwrote the slot does not stop B from reusing its own key on retry', async () => {
    let releaseA: (() => void) | undefined
    const capturedKeys: { a?: string | null; bFirst?: string | null; bRetry?: string | null } = {}

    server.use(
      http.post('/api/ventas', async ({ request }) => {
        const key = request.headers.get('Idempotency-Key')
        // Sale A's request: identified by its own distinctive amount,
        // hangs until the test explicitly releases it — simulating the
        // "request hangs" step of the race (finding 1, step 1).
        const body = (await request.json()) as Record<string, unknown>
        if (body.monto === '900.00') {
          capturedKeys.a = key
          await new Promise<void>((resolve) => {
            releaseA = () => resolve()
          })
          return HttpResponse.json(mockVentaFiada, { status: 201 })
        }
        // Sale B's own first attempt: comes back ambiguous (network error)
        // so the form would offer a retry (finding 1, step 4).
        capturedKeys.bFirst = key
        return HttpResponse.error()
      }),
    )

    // Step 1 — Sale A submitted, request hangs (does not await yet).
    const payloadA = { monto: '900.00', fecha: '2026-08-10', forma_pago: 'EFECTIVO' as const }
    const promiseA = createVenta(payloadA)

    // Step 2 — a DIFFERENT sale B submitted before A resolves; its own
    // attempt comes back ambiguous.
    const payloadB = { monto: '901.00', fecha: '2026-08-10', forma_pago: 'EFECTIVO' as const }
    await expect(createVenta(payloadB)).rejects.toBeTruthy()

    // Step 3 — release A now; it resolves 201 and confirms with ITS OWN
    // key, which by now is stale (B's slot has already superseded it).
    releaseA?.()
    await promiseA

    // Step 5 — B's retry (same payload) must reuse its OWN key, not mint a
    // fresh one — proving A's stale confirm did not wipe B's bookkeeping.
    server.use(
      http.post('/api/ventas', ({ request }) => {
        capturedKeys.bRetry = request.headers.get('Idempotency-Key')
        return HttpResponse.json(mockVentaFiada, { status: 201 })
      }),
    )
    await createVenta(payloadB)

    expect(capturedKeys.bRetry).toBe(capturedKeys.bFirst)
    expect(capturedKeys.bRetry).not.toBe(capturedKeys.a)
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
