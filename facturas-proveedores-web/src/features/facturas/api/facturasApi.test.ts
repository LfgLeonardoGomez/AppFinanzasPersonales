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
import { createFactura, updateFactura, deleteFactura, getFactura, listFacturas } from './facturasApi'
import { createPago } from '@features/pagos/api/pagosApi'
import type { FacturaCreate } from '@shared/api/api'

// ── Fixtures ──────────────────────────────────────────────────────────────────
//
// Wire shape (C-41, D9): every field the backend serializes as a Pydantic-v2
// Decimal STRING is a string here — `monto_total`, and each item's
// `cantidad` / `precio_unitario`. `parseFactura` / `parseFacturaListItem`
// (`facturasApi.ts`) are the boundary that converts them to the `number`
// the public `FacturaResponse` / `FacturaListItem` types promise. A fixture
// that already returns a JS number is a test that passes without exercising
// that conversion.

const mockFactura = {
  id: 'factura-1',
  negocio_id: 'negocio-1',
  proveedor_id: 'prov-1',
  numero: 'A-0001',
  fecha_emision: '2026-08-20',
  fecha_vencimiento: null,
  monto_total: '3000.00',
  archivo_url: null,
  origen: 'MANUAL',
  estado: 'PENDIENTE',
  items: [] as { id: string; factura_id: string; descripcion: string; cantidad: string; precio_unitario: string }[],
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

// ── Wire → public parsing boundary (C-41, D3, D9) ────────────────────────────
//
// `monto_total` (header) and `cantidad` / `precio_unitario` (each line item)
// are Pydantic-v2 Decimal strings on the wire. These tests exercise the
// conversion at every entry point that returns a `FacturaResponse` /
// `FacturaListItem` — `getFactura`, `listFacturas`, `createFactura`,
// `updateFactura` — mirroring `proveedoresApi.test.ts` (task group 3).

describe('getFactura / listFacturas — parse boundary', () => {
  it('converts monto_total and each item’s cantidad/precio_unitario to number', async () => {
    server.use(
      http.get('/api/facturas/:id', () =>
        HttpResponse.json({
          ...mockFactura,
          items: [
            { id: 'item-1', factura_id: 'factura-1', descripcion: 'Harina', cantidad: '2.50', precio_unitario: '1500.00' },
          ],
        }),
      ),
    )

    const factura = await getFactura('factura-1')

    expect(factura.monto_total).toBe(3000)
    expect(factura.items[0]?.cantidad).toBe(2.5)
    expect(factura.items[0]?.precio_unitario).toBe(1500)
  })

  it('converts monto_total to number on each row of the paginated list (triangulation)', async () => {
    server.use(
      http.get('/api/facturas', () =>
        HttpResponse.json([
          { id: 'factura-1', proveedor_id: 'prov-1', numero: 'A-0001', fecha_emision: '2026-08-20', monto_total: '3000.00', estado: 'PENDIENTE' },
          { id: 'factura-2', proveedor_id: 'prov-1', numero: 'A-0002', fecha_emision: '2026-08-21', monto_total: '4250.75', estado: 'PAGADA' },
        ]),
      ),
    )

    const facturas = await listFacturas()

    expect(facturas[0]?.monto_total).toBe(3000)
    expect(facturas[1]?.monto_total).toBe(4250.75)
  })

  it('the invoice numero — a digit-heavy string like "0001-00012345" — is never touched by the money conversion (D3)', async () => {
    server.use(
      http.get('/api/facturas/:id', () =>
        HttpResponse.json({ ...mockFactura, numero: '0001-00012345' }),
      ),
    )

    const factura = await getFactura('factura-1')

    expect(factura.numero).toBe('0001-00012345')
    expect(typeof factura.numero).toBe('string')
  })
})

describe('getFactura / listFacturas — malformed decimal throws (D4, D-88)', () => {
  it('throws instead of returning 0 when monto_total is malformed', async () => {
    server.use(
      http.get('/api/facturas/:id', () =>
        HttpResponse.json({ ...mockFactura, monto_total: 'not-a-number' }),
      ),
    )

    await expect(getFactura('factura-1')).rejects.toThrow(/monto_total/)
  })

  it('throws instead of returning 0 when an item’s precio_unitario is malformed (triangulation)', async () => {
    server.use(
      http.get('/api/facturas/:id', () =>
        HttpResponse.json({
          ...mockFactura,
          items: [
            { id: 'item-1', factura_id: 'factura-1', descripcion: 'Harina', cantidad: '2', precio_unitario: 'garbage' },
          ],
        }),
      ),
    )

    await expect(getFactura('factura-1')).rejects.toThrow(/precio_unitario/)
  })
})

describe('createFactura / updateFactura — parse boundary (triangulation)', () => {
  it('createFactura converts the response monto_total to number', async () => {
    server.use(
      http.post('/api/facturas', () => HttpResponse.json(mockFactura, { status: 201 })),
    )
    const result = await createFactura(payload())
    expect(result.factura.monto_total).toBe(3000)
  })

  it('updateFactura converts the response monto_total to number', async () => {
    server.use(
      http.patch('/api/facturas/:id', () => HttpResponse.json({ ...mockFactura, monto_total: '5000.50' })),
    )
    const factura = await updateFactura('factura-1', { monto_total: 5000.5 })
    expect(factura.monto_total).toBe(5000.5)
  })
})
