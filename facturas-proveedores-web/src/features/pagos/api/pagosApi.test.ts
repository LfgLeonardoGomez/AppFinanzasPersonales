/**
 * Tests for the pagos API layer — C-43 Fase B, tasks 10.2-10.6.
 *
 * MSW intercepts the raw Axios calls, so the assertions are about the
 * header MSW actually received — not about a mock of `idempotency.ts`.
 * Mirrors `ventasApi.test.ts` (C-42), which is the pattern this change
 * deliberately repeats per entity (design.md D1).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createPago, updatePago, deletePago, getPago, listPagos } from './pagosApi'
import { createVenta } from '@features/ventas/api/ventasApi'
import type { PagoCreate } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Wire shape (C-41, D9): `monto` is a Pydantic-v2 Decimal STRING on the
// wire. `parsePago` / `parsePagoListItem` (pagosApi.ts) convert it to the
// `number` the public `PagoResponse` / `PagoListItem` types promise — a
// fixture that already returns a JS number is a test that passes without
// exercising that conversion.

const mockPago = {
  id: 'pago-1',
  negocio_id: 'negocio-1',
  proveedor_id: 'prov-1',
  monto: '1000.00',
  fecha: '2026-08-20',
  metodo: 'EFECTIVO' as const,
  comprobante_url: null,
  origen: 'MANUAL' as const,
  created_at: '2026-08-20T10:00:00',
  updated_at: '2026-08-20T10:00:00',
  proveedor_nombre: 'Proveedor Uno',
}

function payload(overrides: Partial<PagoCreate> = {}): PagoCreate {
  return {
    proveedor_id: 'prov-1',
    monto: 1000,
    fecha: '2026-08-20',
    metodo: 'EFECTIVO',
    comprobante_url: null,
    ...overrides,
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.post('/api/pagos', () => HttpResponse.json(mockPago, { status: 201 })),
  http.patch('/api/pagos/:id', () => HttpResponse.json(mockPago)),
  http.delete('/api/pagos/:id', () => new HttpResponse(null, { status: 204 })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  window.sessionStorage.clear()
})

// ── createPago — Idempotency-Key (tasks 10.2-10.4) ───────────────────────────

describe('createPago — Idempotency-Key (C-43)', () => {
  /**
   * TASK 10.2 — THE GUARD. A POST without `Idempotency-Key` does NOT
   * error: the backend treats the header as optional and silently falls
   * back to the un-deduplicated path (Fase A). So this test is the ONLY
   * signal that a new call site went through `createPago` instead of
   * hitting `apiClient` directly. If it ever goes red, a duplicate
   * payment is one lost response away.
   */
  it('always sends an Idempotency-Key header with a valid UUID (task 10.2)', async () => {
    let capturedKey: string | null = null
    server.use(
      http.post('/api/pagos', ({ request }) => {
        capturedKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json(mockPago, { status: 201 })
      }),
    )

    await createPago(payload())

    expect(capturedKey).toMatch(UUID_V4)
  })

  it('reuses the same key on a retry of the same payload after a response-less failure (task 10.3)', async () => {
    const capturedKeys: (string | null)[] = []
    let call = 0
    server.use(
      http.post('/api/pagos', ({ request }) => {
        call += 1
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (call === 1) return HttpResponse.error()
        return HttpResponse.json(mockPago, { status: 201 })
      }),
    )

    await expect(createPago(payload())).rejects.toBeTruthy()
    await createPago(payload())

    expect(capturedKeys).toHaveLength(2)
    expect(capturedKeys[0]).toBe(capturedKeys[1])
  })

  it('mints a NEW key when the amount changes between the two attempts (task 10.4, triangulation)', async () => {
    const capturedKeys: (string | null)[] = []
    let call = 0
    server.use(
      http.post('/api/pagos', ({ request }) => {
        call += 1
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (call === 1) return HttpResponse.error()
        return HttpResponse.json(mockPago, { status: 201 })
      }),
    )

    await expect(createPago(payload({ monto: 1000 }))).rejects.toBeTruthy()
    await createPago(payload({ monto: 2500 }))

    expect(capturedKeys).toHaveLength(2)
    expect(capturedKeys[0]).not.toBe(capturedKeys[1])
  })

  it('resolves { pago, replay: false } on an ordinary 201 creation', async () => {
    const result = await createPago(payload())
    expect(result.replay).toBe(false)
    expect(result.pago.id).toBe(mockPago.id)
  })

  it('resolves { pago, replay: true } on a 200 + Idempotent-Replay: true response', async () => {
    server.use(
      http.post('/api/pagos', () =>
        HttpResponse.json(mockPago, { status: 200, headers: { 'Idempotent-Replay': 'true' } }),
      ),
    )
    const result = await createPago(payload())
    expect(result.replay).toBe(true)
    expect(result.pago.id).toBe(mockPago.id)
  })

  it('resolves the supplier name on a replay exactly as on a creation (design.md D4 — the response is built when answering)', async () => {
    server.use(
      http.post('/api/pagos', () =>
        HttpResponse.json(
          { ...mockPago, proveedor_nombre: 'Proveedor Renombrado' },
          { status: 200, headers: { 'Idempotent-Replay': 'true' } },
        ),
      ),
    )
    const result = await createPago(payload())
    expect(result.replay).toBe(true)
    expect(result.pago.proveedor_nombre).toBe('Proveedor Renombrado')
  })

  it('discards the pending key after a 409 so a corrected payload is not stuck on the conflicting one', async () => {
    const capturedKeys: (string | null)[] = []
    server.use(
      http.post('/api/pagos', ({ request }) => {
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (capturedKeys.length === 1) {
          return HttpResponse.json({ detail: { mensaje: 'Ya existe' } }, { status: 409 })
        }
        return HttpResponse.json(mockPago, { status: 201 })
      }),
    )

    await expect(createPago(payload())).rejects.toBeTruthy()
    await createPago(payload())

    expect(capturedKeys[0]).not.toBe(capturedKeys[1])
  })

  it('keeps the pending key after a 422 so resending the SAME payload reuses it (triangulation of the 409 case)', async () => {
    const capturedKeys: (string | null)[] = []
    server.use(
      http.post('/api/pagos', ({ request }) => {
        capturedKeys.push(request.headers.get('Idempotency-Key'))
        if (capturedKeys.length === 1) {
          return HttpResponse.json({ detail: 'monto invalido' }, { status: 422 })
        }
        return HttpResponse.json(mockPago, { status: 201 })
      }),
    )

    await expect(createPago(payload())).rejects.toBeTruthy()
    await createPago(payload())

    // Same payload after a 422 → same key: the attempt was rejected, so no
    // row exists, and reusing the key costs nothing while protecting the
    // case where the 422 itself was the ambiguous part of a flaky link.
    expect(capturedKeys[0]).toBe(capturedKeys[1])
  })
})

// ── updatePago / deletePago (task 10.5) ──────────────────────────────────────

describe('updatePago and deletePago — deliberately unprotected (task 10.5)', () => {
  it('neither sends an Idempotency-Key — sending one would suggest a guarantee that does not exist', async () => {
    let patchHeaderSeen: string | null = null
    let deleteHeaderSeen: string | null = null
    server.use(
      http.patch('/api/pagos/:id', ({ request }) => {
        patchHeaderSeen = request.headers.get('Idempotency-Key')
        return HttpResponse.json(mockPago)
      }),
      http.delete('/api/pagos/:id', ({ request }) => {
        deleteHeaderSeen = request.headers.get('Idempotency-Key')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await updatePago('pago-1', { monto: 500 })
    await deletePago({ id: 'pago-1', proveedor_id: 'prov-1' })

    expect(patchHeaderSeen).toBeNull()
    expect(deleteHeaderSeen).toBeNull()
  })
})

// ── Namespace isolation (task 10.6) ──────────────────────────────────────────

describe('pagos owns its own idempotency namespace (task 10.6)', () => {
  it('confirming a pago does not discard a venta pending key — the venta retry still reuses its own', async () => {
    const ventaKeys: (string | null)[] = []
    server.use(
      http.post('/api/ventas', ({ request }) => {
        ventaKeys.push(request.headers.get('Idempotency-Key'))
        // The venta's first attempt is ambiguous, so its key stays pending.
        if (ventaKeys.length === 1) return HttpResponse.error()
        // C-41, D9: `monto` is a Pydantic-v2 Decimal STRING on the wire —
        // `parseVenta` (ventasApi.ts) requires it even though this test
        // only cares about the Idempotency-Key header, not the response
        // body's shape.
        return HttpResponse.json(
          {
            id: 'venta-1',
            negocio_id: 'negocio-1',
            cliente_id: null,
            fecha: '2026-08-20',
            monto: '400.00',
            forma_pago: 'EFECTIVO',
            notas: null,
            created_at: '2026-08-20T10:00:00',
            updated_at: '2026-08-20T10:00:00',
          },
          { status: 201 },
        )
      }),
      http.post('/api/pagos', () => HttpResponse.json(mockPago, { status: 201 })),
    )

    const ventaPayload = {
      monto: '400.00',
      fecha: '2026-08-20',
      forma_pago: 'EFECTIVO' as const,
    }

    // 1 — a venta attempt fails ambiguously: its key is now pending.
    await expect(createVenta(ventaPayload)).rejects.toBeTruthy()

    // 2 — a pago is saved successfully in between, confirming ITS key.
    await createPago(payload())

    // 3 — the venta retry must still reuse its own pending key.
    await createVenta(ventaPayload)

    expect(ventaKeys).toHaveLength(2)
    expect(ventaKeys[0]).toBe(ventaKeys[1])
  })

  it('a pending pago key and a pending venta key coexist without overwriting each other (triangulation)', async () => {
    const ventaKeys: (string | null)[] = []
    const pagoKeys: (string | null)[] = []
    server.use(
      http.post('/api/ventas', ({ request }) => {
        ventaKeys.push(request.headers.get('Idempotency-Key'))
        return HttpResponse.error()
      }),
      http.post('/api/pagos', ({ request }) => {
        pagoKeys.push(request.headers.get('Idempotency-Key'))
        return HttpResponse.error()
      }),
    )

    const ventaPayload = { monto: '400.00', fecha: '2026-08-20', forma_pago: 'EFECTIVO' as const }

    await expect(createVenta(ventaPayload)).rejects.toBeTruthy()
    await expect(createPago(payload())).rejects.toBeTruthy()
    await expect(createVenta(ventaPayload)).rejects.toBeTruthy()
    await expect(createPago(payload())).rejects.toBeTruthy()

    expect(ventaKeys[0]).toBe(ventaKeys[1])
    expect(pagoKeys[0]).toBe(pagoKeys[1])
    expect(ventaKeys[0]).not.toBe(pagoKeys[0])
  })
})

// ── Wire → public parsing boundary (C-41, D3, D9, tasks 5.1/5.2) ────────────
//
// `monto` is a Pydantic-v2 Decimal string on the wire. These tests exercise
// the conversion at every entry point that returns a `PagoResponse` /
// `PagoListItem` — `getPago`, `listPagos`, `createPago`, `updatePago` —
// mirroring `facturasApi.test.ts` (task group 4).

describe('getPago / listPagos — parse boundary', () => {
  it('converts monto to number', async () => {
    server.use(http.get('/api/pagos/:id', () => HttpResponse.json(mockPago)))

    const pago = await getPago('pago-1')

    expect(pago.monto).toBe(1000)
  })

  it('converts monto to number on each row of the paginated list (triangulation)', async () => {
    server.use(
      http.get('/api/pagos', () =>
        HttpResponse.json({
          items: [
            { ...mockPago, id: 'pago-1', monto: '1000.00' },
            { ...mockPago, id: 'pago-2', monto: '2500.75' },
          ],
          total: 2,
          page: 1,
          page_size: 20,
        }),
      ),
    )

    const result = await listPagos()

    expect(result.items[0]?.monto).toBe(1000)
    expect(result.items[1]?.monto).toBe(2500.75)
  })

  it('the proveedor_id — a UUID, never a money field — is never touched by the money conversion (D3)', async () => {
    server.use(http.get('/api/pagos/:id', () => HttpResponse.json(mockPago)))

    const pago = await getPago('pago-1')

    expect(pago.proveedor_id).toBe('prov-1')
    expect(typeof pago.proveedor_id).toBe('string')
  })
})

describe('getPago / listPagos — malformed decimal throws (D4, D-88)', () => {
  it('throws instead of returning 0 when monto is malformed', async () => {
    server.use(
      http.get('/api/pagos/:id', () => HttpResponse.json({ ...mockPago, monto: 'not-a-number' })),
    )

    await expect(getPago('pago-1')).rejects.toThrow(/monto/)
  })

  it('throws instead of returning 0 when monto is an empty string (triangulation)', async () => {
    server.use(http.get('/api/pagos/:id', () => HttpResponse.json({ ...mockPago, monto: '' })))

    await expect(getPago('pago-1')).rejects.toThrow(/monto/)
  })
})

describe('createPago / updatePago — parse boundary (triangulation)', () => {
  it('createPago converts the response monto to number', async () => {
    server.use(http.post('/api/pagos', () => HttpResponse.json(mockPago, { status: 201 })))

    const result = await createPago(payload())

    expect(result.pago.monto).toBe(1000)
  })

  it('updatePago converts the response monto to number', async () => {
    server.use(
      http.patch('/api/pagos/:id', () => HttpResponse.json({ ...mockPago, monto: '750.25' })),
    )

    const pago = await updatePago('pago-1', { monto: 750.25 })

    expect(pago.monto).toBe(750.25)
  })
})
