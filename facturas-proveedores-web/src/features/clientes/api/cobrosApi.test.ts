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
