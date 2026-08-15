/**
 * Tests for the raw IA vision API calls (C-42, task 6.3) — specifically the
 * `timeout: 120000` override on `postExtraerIA` (design.md D5).
 *
 * Why a config-assertion test and not a real slow-response race: jsdom's
 * XMLHttpRequest shim does not implement `timeout` (verified empirically
 * while writing `client.test.ts` — a request configured with a small
 * timeout against a slow MSW response resolved instead of aborting), so a
 * genuine "120s survives, 20s would have cut it" race cannot be exercised
 * in this test environment. What CAN be pinned, deterministically and
 * against the real production code path (not a mock of this module): the
 * exact config object `postExtraerIA` hands to `apiClient.post`. We spy on
 * `apiClient.post` — the spy calls through, so MSW still answers the
 * request normally — and assert the `timeout` it was given. This is the
 * same style already used for "createVenta always sends the header"
 * (ventasApi.test.ts): asserting on what the real call site actually sent.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { apiClient } from '@shared/api/client'
import { extraerFacturaIA, extraerPagoIA } from './iaVisionApi'

// ── Fixtures ──────────────────────────────────────────────────────────────────

const minimalFile = new File([new Uint8Array([1, 2, 3])], 'foto.jpg', { type: 'image/jpeg' })

const emptyPropuestaFactura = {
  proveedor_nombre: null,
  numero: null,
  fecha_emision: null,
  monto_total: null,
  error: false,
  error_message: null,
}

const emptyPropuestaPago = {
  proveedor_nombre: null,
  monto: null,
  fecha: null,
  metodo: null,
  error: false,
  error_message: null,
}

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.post('/api/facturas/extraer-ia', () => HttpResponse.json(emptyPropuestaFactura)),
  http.post('/api/pagos/extraer-ia', () => HttpResponse.json(emptyPropuestaPago)),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Tests ────────────────────────────────────────────────────────────────────

describe('extraerFacturaIA / extraerPagoIA — timeout override (C-42, task 6.3, design.md D5)', () => {
  it('extraerFacturaIA sends an explicit 120000ms timeout, overriding the 20s client default', async () => {
    const postSpy = vi.spyOn(apiClient, 'post')
    await extraerFacturaIA(minimalFile)
    expect(postSpy).toHaveBeenCalledTimes(1)
    const config = postSpy.mock.calls[0]?.[2] as { timeout?: number } | undefined
    expect(config?.timeout).toBe(120_000)
    postSpy.mockRestore()
  })

  it('extraerPagoIA sends the same 120000ms override (triangulation — the other IA endpoint)', async () => {
    const postSpy = vi.spyOn(apiClient, 'post')
    await extraerPagoIA(minimalFile)
    expect(postSpy).toHaveBeenCalledTimes(1)
    const config = postSpy.mock.calls[0]?.[2] as { timeout?: number } | undefined
    expect(config?.timeout).toBe(120_000)
    postSpy.mockRestore()
  })

  it('the override (120000) is strictly greater than the client default (20000) — the invariant D5 depends on', () => {
    expect(120_000).toBeGreaterThan(apiClient.defaults.timeout as number)
  })
})
