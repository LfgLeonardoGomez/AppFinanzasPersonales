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
import { http, HttpResponse, delay } from 'msw'
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

describe('apiClient — timeout (C-42, task 6.1/6.2, design.md D5)', () => {
  it('has a default timeout of 20000ms', () => {
    expect(apiClient.defaults.timeout).toBe(20000)
  })

  // NOTE on scope: jsdom's XMLHttpRequest shim does not implement the
  // `timeout` property (it never fires the abort), so a real 20s-vs-slow-
  // response race cannot be exercised through apiClient in this test
  // environment — verified empirically (a request configured with
  // `timeout: 50` against a 400ms-delayed MSW response resolved normally
  // instead of aborting). That is a jsdom gap, not a statement about real
  // browsers, where XHR/fetch timeout is a long-standing, independently
  // tested feature of the platform and of Axios itself.
  //
  // What we CAN and DO verify here, with a REAL MSW-triggered failure (not
  // a hand-built fake error): a timeout's defining trait from the
  // interceptor's point of view is "rejected with no `.response`" — exactly
  // what `error.response?.status !== 401` in client.ts's guard checks for.
  // MSW's `HttpResponse.error()` produces a genuine network-level failure
  // (ERR_NETWORK) with no `.response`, so this exercises the same guard
  // path a real ECONNABORTED timeout would take, without depending on
  // jsdom's broken timer.
  it('a request with no response (e.g. a timeout) does not trigger the refresh flow', async () => {
    let refreshCalled = false

    server.use(
      http.get(`${BASE}/api/unreachable`, () => HttpResponse.error()),
      http.post(`${BASE}/api/auth/refresh`, () => {
        refreshCalled = true
        return HttpResponse.json({ ok: true })
      }),
    )

    const error = await apiClient.get('/unreachable').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    const axiosLikeError = error as { response?: unknown }
    expect(axiosLikeError.response).toBeUndefined()
    expect(refreshCalled).toBe(false)
  })

  it('adding a client timeout does not break an ordinary request that resolves quickly (triangulation)', async () => {
    server.use(
      http.get(`${BASE}/api/fast`, async () => {
        await delay(5)
        return HttpResponse.json({ ok: true })
      }),
    )

    const response = await apiClient.get('/fast', { timeout: 500 })
    expect(response.data).toEqual({ ok: true })
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
