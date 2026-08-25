/**
 * Tests for the cobros API layer — the C-43 idempotency seam (C-36,
 * design.md D7, tasks 5.1-5.4, 5.7).
 *
 * `crearCobro` is the single function that owns `POST /api/cobros`. This
 * change implements NO idempotency (no `Idempotency-Key`, no
 * `@shared/api/idempotency` import) — these tests pin the RESULT SHAPE and
 * the replay-classification path so C-43 Fase B can wire idempotency in by
 * editing only this one function.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { crearCobro } from './cobrosApi'
import type { CobroClienteCreate } from '@shared/api/api'

let capturedBody: Record<string, unknown> | null = null
let capturedMethod = ''

const RAW_COBRO = {
  id: 'cobro-1',
  negocio_id: 'negocio-1',
  cliente_id: 'cliente-1',
  monto: '500.00',
  fecha: '2026-08-16',
  metodo: 'EFECTIVO',
  comprobante_url: null,
  created_at: '2026-08-16T10:00:00',
  updated_at: '2026-08-16T10:00:00',
}

const server = setupServer(
  http.post('/api/cobros', async ({ request }) => {
    capturedMethod = request.method
    capturedBody = (await request.json()) as Record<string, unknown>
    return HttpResponse.json(RAW_COBRO, { status: 201 })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => {
  server.resetHandlers()
  capturedBody = null
  capturedMethod = ''
  // C-43 Fase B — the pending-attempt slot is mirrored to sessionStorage,
  // so it must be cleared between tests or a minted key leaks forward.
  window.sessionStorage.clear()
})

const PAYLOAD: CobroClienteCreate = {
  cliente_id: 'cliente-1',
  monto: '500.00',
  fecha: '2026-08-16',
  metodo: 'EFECTIVO',
}

describe('crearCobro — payload shape (task 5.1)', () => {
  it('posts to /cobros with exactly cliente_id, monto, fecha, metodo — no venta_id/negocio_id/creado_por_usuario_id', async () => {
    await crearCobro(PAYLOAD)
    expect(capturedMethod).toBe('POST')
    expect(capturedBody).toEqual({
      cliente_id: 'cliente-1',
      monto: '500.00',
      fecha: '2026-08-16',
      metodo: 'EFECTIVO',
    })
  })

  it('includes comprobante_url when present (triangulation)', async () => {
    await crearCobro({ ...PAYLOAD, comprobante_url: 'https://res.cloudinary.com/demo/x.jpg' })
    expect(capturedBody?.comprobante_url).toBe('https://res.cloudinary.com/demo/x.jpg')
  })
})

describe('crearCobro — result shape (task 5.2)', () => {
  it('resolves to { cobro, replay } — never a bare response — with replay false on an ordinary 201', async () => {
    const result = await crearCobro(PAYLOAD)
    expect(result).toHaveProperty('cobro')
    expect(result).toHaveProperty('replay')
    expect(result.replay).toBe(false)
    expect(result.cobro.id).toBe('cobro-1')
  })
})

describe('crearCobro — replay classified via classifySuccess, not guessed (task 5.3)', () => {
  it('resolves replay=true given a 200 carrying Idempotent-Replay: true', async () => {
    server.use(
      http.post('/api/cobros', () =>
        HttpResponse.json(RAW_COBRO, { status: 200, headers: { 'Idempotent-Replay': 'true' } }),
      ),
    )
    const result = await crearCobro(PAYLOAD)
    expect(result.replay).toBe(true)
  })
})

describe('crearCobro — a rejection propagates (task 5.4)', () => {
  it('does not swallow a 422 error', async () => {
    server.use(
      http.post('/api/cobros', () =>
        HttpResponse.json({ detail: 'El monto supera el saldo pendiente.' }, { status: 422 }),
      ),
    )
    await expect(crearCobro(PAYLOAD)).rejects.toBeTruthy()
  })
})

// ── C-43 Fase B — Idempotency-Key (tasks 12.2, 12.3) ────────────────────────

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

describe('crearCobro — Idempotency-Key (C-43 Fase B)', () => {
  /** TASK 12.2 — the guard, same reasoning as `createPago`'s: a POST
   * without the header does NOT error, so this is the only signal that a
   * new call site went through `crearCobro`. */
  it('always sends an Idempotency-Key header with a valid UUID (task 12.2)', async () => {
    let capturedKey: string | null = null
    server.use(
      http.post('/api/cobros', ({ request }) => {
        capturedKey = request.headers.get('Idempotency-Key')
        return HttpResponse.json(RAW_COBRO, { status: 201 })
      }),
    )

    await crearCobro(PAYLOAD)

    expect(capturedKey).toMatch(UUID_V4)
  })

  it('reuses the same key on a retry of the same cobro after a response-less failure (task 12.3)', async () => {
    const keys: (string | null)[] = []
    server.use(
      http.post('/api/cobros', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        if (keys.length === 1) return HttpResponse.error()
        return HttpResponse.json(RAW_COBRO, { status: 201 })
      }),
    )

    await expect(crearCobro(PAYLOAD)).rejects.toBeTruthy()
    await crearCobro(PAYLOAD)

    expect(keys).toHaveLength(2)
    // Asserted BEFORE the equality: without this, `null === null` would
    // make this test pass against an implementation that sends no header
    // at all — the exact thing it exists to catch.
    expect(keys[0]).toMatch(UUID_V4)
    expect(keys[0]).toBe(keys[1])
  })

  it('mints a NEW key when the amount changes between attempts (task 12.3, triangulation)', async () => {
    const keys: (string | null)[] = []
    server.use(
      http.post('/api/cobros', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        if (keys.length === 1) return HttpResponse.error()
        return HttpResponse.json(RAW_COBRO, { status: 201 })
      }),
    )

    await expect(crearCobro(PAYLOAD)).rejects.toBeTruthy()
    await crearCobro({ ...PAYLOAD, monto: '250.00' })

    expect(keys[0]).not.toBe(keys[1])
  })

  it('uses a namespace of its own — a pending cobro key survives an unrelated confirmed write', async () => {
    const keys: (string | null)[] = []
    server.use(
      http.post('/api/cobros', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        // Both attempts fail ambiguously, so the pending key must persist.
        return HttpResponse.error()
      }),
    )

    await expect(crearCobro(PAYLOAD)).rejects.toBeTruthy()
    await expect(crearCobro(PAYLOAD)).rejects.toBeTruthy()

    expect(keys[0]).toMatch(UUID_V4)
    expect(keys[0]).toBe(keys[1])
  })

  /**
   * TASK 12.5 (API half) — the scenario that motivated design.md D2.
   * Paying off the WHOLE balance, losing the response, then retrying must
   * come back as an already-recorded success — never a 422 for
   * insufficient balance. On the backend that works because the lookup by
   * key runs BEFORE the stateful balance validation; from this layer, the
   * observable contract is: same key on the retry, and a 200 +
   * Idempotent-Replay classified as a replay, not an error.
   */
  it('a retry of a full-balance payoff reuses the key and reports a replay, never a rejection (task 12.5)', async () => {
    const keys: (string | null)[] = []
    server.use(
      http.post('/api/cobros', ({ request }) => {
        keys.push(request.headers.get('Idempotency-Key'))
        // 1st attempt: the request commits server-side but the response is
        // lost. 2nd attempt: the backend recognises the key and replays.
        if (keys.length === 1) return HttpResponse.error()
        return HttpResponse.json(RAW_COBRO, {
          status: 200,
          headers: { 'Idempotent-Replay': 'true' },
        })
      }),
    )

    const payoff: CobroClienteCreate = { ...PAYLOAD, monto: '500.00' }

    await expect(crearCobro(payoff)).rejects.toBeTruthy()
    const result = await crearCobro(payoff)

    expect(keys[0]).toMatch(UUID_V4)
    expect(keys[0]).toBe(keys[1])
    expect(result.replay).toBe(true)
    expect(result.cobro.id).toBe('cobro-1')
  })
})

// ── Guard (task 5.7) — mirrors C-42's "createVenta always sends the key"
// intent: no call site outside cobrosApi.ts may bypass the one function
// idempotency will live in. Scans the source tree (excluding tests and this
// module itself) for a reference to the `/cobros` path. ──────────────────────

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      collectSourceFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry) && !/\.test-d\.ts$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

describe('crearCobro — no other call site references /cobros (task 5.7)', () => {
  it('only cobrosApi.ts uses the /cobros path as a quoted string literal (a real call site, not a doc comment)', () => {
    const srcRoot = join(__dirname, '..', '..', '..')
    const files = collectSourceFiles(srcRoot).filter((f) => !f.endsWith(join('api', 'cobrosApi.ts')))
    // Matches '/cobros', "/cobros", `/cobros` — an actual string literal a
    // caller would pass to apiClient — not a prose mention like
    // "POST /api/cobros" inside a /** */ doc comment.
    const literalPattern = /['"`]\/cobros['"`]/
    const offenders = files.filter((f) => literalPattern.test(readFileSync(f, 'utf-8')))
    expect(offenders).toEqual([])
  })
})
