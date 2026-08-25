/**
 * Tests for the facturas API layer — C-43 Fase B, tasks 11.1-11.5.
 *
 * MSW intercepts the raw Axios calls, so the assertions are about the
 * header MSW actually received. Mirrors `pagosApi.test.ts` and
 * `ventasApi.test.ts` — the recipe is deliberately repeated per entity
 * (design.md D1) so the ONE real difference stays visible: an invoice's
 * identity includes its items (design.md D3).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { createFactura, updateFactura, deleteFactura } from './facturasApi'
import { createPago } from '@features/pagos/api/pagosApi'
import type { FacturaResponse, FacturaCreate } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const mockFactura: FacturaResponse = {
  id: 'factura-1',
  negocio_id: 'negocio-1',
  proveedor_id: 'prov-1',
  numero: 'A-0001',
  fecha_emision: '2026-08-20',
  fecha_vencimiento: null,
  monto_total: 3000,
  archivo_url: null,
  origen: 'MANUAL',
  estado: 'PENDIENTE',
  items: [],
  items_sum_mismatch: false,
  created_at: '2026-08-20T10:00:00',
  updated_at: '2026-08-20T10:00:00',
  proveedor_nombre: 'Proveedor Uno',
}

function payload(overrides: Partial<FacturaCreate> = {}): FacturaCreate {
  return {
    proveedor_id: 'prov-1',
    fecha_emision: '2026-08-20',
    monto_total: 3000,
    numero: 'A-0001',
    items: [{ descripcion: 'Harina', cantidad: 2, precio_unitario: 1500 }],
    ...overrides,
  }
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.post('/api/facturas', () => HttpResponse.json(mockFactura, { status: 201 })),
  http.patch('/api/facturas/:id', () => HttpResponse.json(mockFactura)),
  http.delete('/api/facturas/:id', () => new HttpResponse(null, { status: 204 })),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  window.sessionStorage.clear()
})

/** Captures the `Idempotency-Key` of every POST, failing the first `failFor`
 * attempts with a response-less error so the key stays pending. */
function captureKeys(failFor: number): (string | null)[] {
  const keys: (string | null)[] = []
  server.use(
    http.post('/api/facturas', ({ request }) => {
      keys.push(request.headers.get('Idempotency-Key'))
      if (keys.length <= failFor) return HttpResponse.error()
      return HttpResponse.json(mockFactura, { status: 201 })
    }),
  )
  return keys
}

// ── createFactura — Idempotency-Key (tasks 11.1-11.4) ────────────────────────

describe('createFactura — Idempotency-Key (C-43)', () => {
  /** TASK 11.1 — the guard. Same reasoning as `createPago`'s: a POST
   * without the header does NOT error, so this test is the only signal
   * that a new call site went through `createFactura`. */
  it('always sends an Idempotency-Key header with a valid UUID (task 11.1)', async () => {
    let capturedKey: string | null = null
    server.use(
      http.post('/api/facturas', ({ request }) => {
        capturedKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json(mockFactura, { status: 201 })
      }),
    )

    await createFactura(payload())

    expect(capturedKey).toMatch(UUID_V4)
  })

  it('reuses the same key on a retry of the same payload after a response-less failure (task 11.2)', async () => {
    const keys = captureKeys(1)

    await expect(createFactura(payload())).rejects.toBeTruthy()
    await createFactura(payload())

    expect(keys).toHaveLength(2)
    expect(keys[0]).toBe(keys[1])
  })

  /**
   * TASK 11.3 — the difference that justifies the whole 409 branch.
   * An invoice's identity INCLUDES its items (design.md D3). Correcting a
   * line's price is exactly the correction that must never be silently
   * discarded — so it has to mint a NEW key. Without this, the corrected
   * invoice would collide with the backend's 409 instead of being saved.
   */
  it('mints a NEW key when an item price is corrected between attempts (task 11.3)', async () => {
    const keys = captureKeys(1)

    await expect(
      createFactura(
        payload({ items: [{ descripcion: 'Harina', cantidad: 2, precio_unitario: 1500 }] }),
      ),
    ).rejects.toBeTruthy()
    await createFactura(
      payload({ items: [{ descripcion: 'Harina', cantidad: 2, precio_unitario: 1600 }] }),
    )

    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('mints a NEW key when an item description is corrected between attempts (task 11.3, triangulation)', async () => {
    const keys = captureKeys(1)

    await expect(
      createFactura(
        payload({ items: [{ descripcion: 'Harina', cantidad: 2, precio_unitario: 1500 }] }),
      ),
    ).rejects.toBeTruthy()
    await createFactura(
      payload({ items: [{ descripcion: 'Harina 000', cantidad: 2, precio_unitario: 1500 }] }),
    )

    expect(keys[0]).not.toBe(keys[1])
  })

  it('mints a NEW key when an item is ADDED between attempts (task 11.4)', async () => {
    const keys = captureKeys(1)

    await expect(createFactura(payload())).rejects.toBeTruthy()
    await createFactura(
      payload({
        items: [
          { descripcion: 'Harina', cantidad: 2, precio_unitario: 1500 },
          { descripcion: 'Azúcar', cantidad: 1, precio_unitario: 800 },
        ],
      }),
    )

    expect(keys[0]).not.toBe(keys[1])
  })

  it('REUSES the key when the exact same payload — items included — is resent (task 11.4, triangulation)', async () => {
    const keys = captureKeys(1)

    await expect(createFactura(payload())).rejects.toBeTruthy()
    await createFactura(payload())

    expect(keys[0]).toBe(keys[1])
  })

  it('resolves { factura, replay: false } on an ordinary 201 creation', async () => {
    const result = await createFactura(payload())
    expect(result.replay).toBe(false)
    expect(result.factura.id).toBe(mockFactura.id)
  })

  it('resolves { factura, replay: true } on a 200 + Idempotent-Replay: true response', async () => {
    server.use(
      http.post('/api/facturas', () =>
        HttpResponse.json(mockFactura, { status: 200, headers: { 'Idempotent-Replay': 'true' } }),
      ),
    )
    const result = await createFactura(payload())
    expect(result.replay).toBe(true)
    expect(result.factura.id).toBe(mockFactura.id)
  })

  /**
   * Design.md D4 — the replay's response is built when answering, never
   * frozen. `estado` is FIFO-derived over every active invoice and payment
   * of that supplier (RN-FIFO), so if a payment landed between the attempt
   * and the retry, the replay legitimately reports a DIFFERENT estado than
   * the original attempt would have. The client must surface it verbatim
   * and never recompute (RN-FAC-09).
   */
  it('surfaces a replay estado verbatim even when it differs from the original (design.md D4, RN-FAC-09)', async () => {
    server.use(
      http.post('/api/facturas', () =>
        HttpResponse.json(
          { ...mockFactura, estado: 'PARCIAL' },
          { status: 200, headers: { 'Idempotent-Replay': 'true' } },
        ),
      ),
    )
    const result = await createFactura(payload())
    expect(result.replay).toBe(true)
    expect(result.factura.estado).toBe('PARCIAL')
  })

  it('discards the pending key after a 409 so a corrected payload is not stuck on the conflicting one', async () => {
    const keys: (string | null)[] = []
    server.use(
      http.post('/api/facturas', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        if (keys.length === 1) {
          return HttpResponse.json({ detail: { mensaje: 'Ya existe' } }, { status: 409 })
        }
        return HttpResponse.json(mockFactura, { status: 201 })
      }),
    )

    await expect(createFactura(payload())).rejects.toBeTruthy()
    await createFactura(payload())

    expect(keys[0]).not.toBe(keys[1])
  })
})

// ── updateFactura / deleteFactura (task 11.5) ────────────────────────────────

describe('updateFactura and deleteFactura — deliberately unprotected (task 11.5)', () => {
  it('neither sends an Idempotency-Key', async () => {
    let patchHeaderSeen: string | null = null
    let deleteHeaderSeen: string | null = null
    server.use(
      http.patch('/api/facturas/:id', ({ request }) => {
        patchHeaderSeen = request.headers.get('Idempotency-Key')
        return HttpResponse.json(mockFactura)
      }),
      http.delete('/api/facturas/:id', ({ request }) => {
        deleteHeaderSeen = request.headers.get('Idempotency-Key')
        return new HttpResponse(null, { status: 204 })
      }),
    )

    await updateFactura('factura-1', { monto_total: 4000 })
    await deleteFactura({ id: 'factura-1', proveedor_id: 'prov-1' })

    expect(patchHeaderSeen).toBeNull()
    expect(deleteHeaderSeen).toBeNull()
  })
})

// ── Namespace isolation (task 11.6) ──────────────────────────────────────────

describe('facturas owns its own idempotency namespace', () => {
  it('a pending factura key and a pending pago key never overwrite each other', async () => {
    const facturaKeys: (string | null)[] = []
    const pagoKeys: (string | null)[] = []
    server.use(
      http.post('/api/facturas', ({ request }) => {
        facturaKeys.push(request.headers.get('Idempotency-Key'))
        return HttpResponse.error()
      }),
      http.post('/api/pagos', ({ request }) => {
        pagoKeys.push(request.headers.get('Idempotency-Key'))
        return HttpResponse.error()
      }),
    )

    const pagoPayload = {
      proveedor_id: 'prov-1',
      monto: 1000,
      fecha: '2026-08-20',
      metodo: 'EFECTIVO' as const,
    }

    await expect(createFactura(payload())).rejects.toBeTruthy()
    await expect(createPago(pagoPayload)).rejects.toBeTruthy()
    await expect(createFactura(payload())).rejects.toBeTruthy()
    await expect(createPago(pagoPayload)).rejects.toBeTruthy()

    expect(facturaKeys[0]).toBe(facturaKeys[1])
    expect(pagoKeys[0]).toBe(pagoKeys[1])
    expect(facturaKeys[0]).not.toBe(pagoKeys[0])
  })
})
