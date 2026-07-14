/**
 * Tests for the Axios client and its 401 interceptor.
 *
 * TDD cycle — RED → GREEN → TRIANGULATE → REFACTOR
 *
 * External dependencies (backend) are mocked with MSW.
 * Tokens MUST NOT appear in localStorage or sessionStorage.
 *
 * NOTE: MSW in jsdom/node requires absolute URLs. Axios baseURL '/api' resolves
 * relative to the jsdom base (http://localhost), so MSW handlers use
 * 'http://localhost/api/...'.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import { apiClient, registerClearSession } from './client'

// ── jsdom base URL fix ────────────────────────────────────────────────────────
// Axios uses XHR in jsdom which resolves relative to window.location.
// Set it so /api/* resolves to http://localhost/api/*
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: {
      assign: vi.fn(),
      href: 'http://localhost/',
      origin: 'http://localhost',
      pathname: '/',
    },
    writable: true,
  })
})

const BASE = 'http://localhost'

// ── MSW server ───────────────────────────────────────────────────────────────

const server = setupServer()

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' })
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  registerClearSession(() => undefined)
})

afterEach(() => {
  server.resetHandlers()
  server.close()
})

// ── Tests ────────────────────────────────────────────────────────────────────

describe('apiClient — baseURL and credentials', () => {
  it('has baseURL /api and withCredentials true', () => {
    expect(apiClient.defaults.baseURL).toBe('/api')
    expect(apiClient.defaults.withCredentials).toBe(true)
  })
})

describe('apiClient — 401 interceptor: refresh and retry', () => {
  it('retries the original request after a successful refresh', async () => {
    let refreshCalled = false
    let firstCall = true

    server.use(
      http.get(`${BASE}/api/protected`, () => {
        if (firstCall) {
          firstCall = false
          return new HttpResponse(null, { status: 401 })
        }
        return HttpResponse.json({ data: 'ok' })
      }),
      http.post(`${BASE}/api/auth/refresh`, () => {
        refreshCalled = true
        return HttpResponse.json({ ok: true })
      }),
    )

    const response = await apiClient.get<{ data: string }>('/protected')
    expect(response.data).toEqual({ data: 'ok' })
    expect(refreshCalled).toBe(true)
  })

  it('clears session when refresh fails', async () => {
    const clearMock = vi.fn()
    registerClearSession(clearMock)

    server.use(
      http.get(`${BASE}/api/protected-fail`, () => {
        return new HttpResponse(null, { status: 401 })
      }),
      http.post(`${BASE}/api/auth/refresh`, () => {
        return new HttpResponse(null, { status: 401 })
      }),
    )

    await expect(apiClient.get('/protected-fail')).rejects.toThrow()
    expect(clearMock).toHaveBeenCalledTimes(1)
  })
})

describe('apiClient — 401 interceptor: no-loop guards', () => {
  it('does NOT call /auth/refresh when the 401 comes from /auth/refresh itself', async () => {
    let refreshCallCount = 0

    server.use(
      http.post(`${BASE}/api/auth/refresh`, () => {
        refreshCallCount++
        return new HttpResponse(null, { status: 401 })
      }),
    )

    await expect(apiClient.post('/auth/refresh')).rejects.toThrow()

    // Only 1 call (the one we made directly — interceptor must NOT add another)
    expect(refreshCallCount).toBe(1)
  })

  it('does NOT call /auth/refresh when the 401 comes from /auth/login', async () => {
    let refreshCallCount = 0

    server.use(
      http.post(`${BASE}/api/auth/login`, () => {
        return new HttpResponse(null, { status: 401 })
      }),
      http.post(`${BASE}/api/auth/refresh`, () => {
        refreshCallCount++
        return HttpResponse.json({ ok: true })
      }),
    )

    await expect(apiClient.post('/auth/login', {})).rejects.toThrow()
    expect(refreshCallCount).toBe(0)
  })
})

describe('apiClient — 401 interceptor: single refresh in-flight (concurrency)', () => {
  it('executes only one /auth/refresh when multiple requests fail 401 simultaneously', async () => {
    let refreshCallCount = 0
    let firstCall1 = true
    let firstCall2 = true

    server.use(
      http.get(`${BASE}/api/concurrent1`, () => {
        if (firstCall1) {
          firstCall1 = false
          return new HttpResponse(null, { status: 401 })
        }
        return HttpResponse.json({ id: 1 })
      }),
      http.get(`${BASE}/api/concurrent2`, () => {
        if (firstCall2) {
          firstCall2 = false
          return new HttpResponse(null, { status: 401 })
        }
        return HttpResponse.json({ id: 2 })
      }),
      http.post(`${BASE}/api/auth/refresh`, async () => {
        refreshCallCount++
        await new Promise<void>((resolve) => setTimeout(resolve, 20))
        return HttpResponse.json({ ok: true })
      }),
    )

    const [r1, r2] = await Promise.all([
      apiClient.get('/concurrent1'),
      apiClient.get('/concurrent2'),
    ])

    expect(r1.status).toBe(200)
    expect(r2.status).toBe(200)
    // KEY: only ONE refresh despite two parallel 401s
    expect(refreshCallCount).toBe(1)
  })
})

describe('apiClient — 401 with skipAuthRedirect (bootstrap)', () => {
  it('does not clear session when skipAuthRedirect is true', async () => {
    const clearMock = vi.fn()
    registerClearSession(clearMock)

    server.use(
      http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })),
    )

    await expect(
      apiClient.get('/me', { skipAuthRedirect: true } as Parameters<typeof apiClient.get>[1]),
    ).rejects.toThrow()

    // clearSession must NOT have been called for a bootstrap 401
    expect(clearMock).not.toHaveBeenCalled()
  })
})

describe('apiClient — no tokens in storage', () => {
  it('does not write tokens to localStorage or sessionStorage after login', async () => {
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({
          user: { id: '1', email: 'a@b.com', nombre: 'Test', created_at: '' },
        }),
      ),
    )

    await apiClient.post('/auth/login', { email: 'a@b.com', password: 'password123' })

    const localKeys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i))
    const sessionKeys = Array.from(
      { length: sessionStorage.length },
      (_, i) => sessionStorage.key(i),
    )

    const tokenPattern = /token|access|refresh|jwt/i
    localKeys.forEach((k) => expect(k ?? '').not.toMatch(tokenPattern))
    sessionKeys.forEach((k) => expect(k ?? '').not.toMatch(tokenPattern))
  })
})
