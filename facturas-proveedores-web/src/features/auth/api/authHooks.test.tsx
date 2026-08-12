/**
 * Tests for auth TanStack Query hooks.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Backend is mocked with MSW. Tokens must never appear in storage.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

// ── jsdom base URL ────────────────────────────────────────────────────────────
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    writable: true,
  })
})

const BASE = 'http://localhost'

// ── MSW server ────────────────────────────────────────────────────────────────

const server = setupServer()

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' })
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
})
afterEach(() => {
  server.resetHandlers()
  server.close()
})

// ── useMe ─────────────────────────────────────────────────────────────────────

describe('useMe — bootstrap query', () => {
  it('resolves with the user profile when the session cookie is valid', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () =>
        HttpResponse.json({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'me@test.com', nombre: 'Me', created_at: '' }),
      ),
    )

    const { useMe } = await import('./authHooks')
    const { result } = renderHook(() => useMe(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.status).toBe('success'))
    expect(result.current.data?.email).toBe('me@test.com')
  })

  it('settles into error on 401 instead of retrying or redirecting', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })),
    )

    const { useMe } = await import('./authHooks')
    const { result } = renderHook(() => useMe(), { wrapper: makeWrapper() })

    await waitFor(() => expect(result.current.status).toBe('error'))
    // skipAuthRedirect: a 401 here means "not logged in", not "session expired",
    // so the interceptor must not bounce the user anywhere.
    expect(window.location.assign).not.toHaveBeenCalled()
  })

  it('does NOT write to the authStore — syncing is the caller\'s job', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () =>
        HttpResponse.json({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'me@test.com', nombre: 'Me', created_at: '' }),
      ),
    )

    const { useAuthStore } = await import('../store/authStore')
    act(() => useAuthStore.getState().logout())

    const { useMe } = await import('./authHooks')
    const { result } = renderHook(() => useMe(), { wrapper: makeWrapper() })
    await waitFor(() => expect(result.current.status).toBe('success'))

    // The query only reports session validity. `RequireAuthWithBootstrap`
    // owns the store sync via useEffect (see RequireAuth.tsx, FE-BOOT-01).
    // Pinning this prevents re-adding a v4-style onSuccess callback, which
    // TanStack Query v5 removed and therefore never fires.
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

// ── useRegister ───────────────────────────────────────────────────────────────

describe('useRegister', () => {
  it('resolves on successful registration (2xx)', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro`, () =>
        HttpResponse.json({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'new@test.com', nombre: 'New', created_at: '' }),
      ),
    )

    const { useRegister } = await import('./authHooks')
    const { result } = renderHook(() => useRegister(), { wrapper: makeWrapper() })

    await act(async () => {
      result.current.mutate({ email: 'new@test.com', nombre: 'New', password: 'password123' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  it('surfaces an email-in-use error when backend signals duplicate email', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro`, () =>
        HttpResponse.json({ detail: 'email_already_exists' }, { status: 400 }),
      ),
    )

    const { useRegister } = await import('./authHooks')
    const { result } = renderHook(() => useRegister(), { wrapper: makeWrapper() })

    await act(async () => {
      result.current.mutate({ email: 'dup@test.com', nombre: 'Dup', password: 'password123' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeDefined()
  })

  it('surfaces a validation error on 422 without creating a session', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro`, () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'password'], msg: 'too short', type: 'value_error' }] },
          { status: 422 },
        ),
      ),
    )

    const { useRegister } = await import('./authHooks')
    const { result } = renderHook(() => useRegister(), { wrapper: makeWrapper() })

    await act(async () => {
      result.current.mutate({ email: 'a@b.com', nombre: 'A', password: '123' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    // No session must be created
    const { useAuthStore } = await import('../store/authStore')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

// ── useLogin ──────────────────────────────────────────────────────────────────

describe('useLogin', () => {
  it('populates authStore on successful login', async () => {
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ user: { id: '1', negocio_id: 'neg-1', es_admin: false, email: 'u@u.com', nombre: 'U', created_at: '' } }),
      ),
    )

    const { useLogin } = await import('./authHooks')
    const { useAuthStore } = await import('../store/authStore')
    // Reset store
    useAuthStore.getState().logout()

    const { result } = renderHook(() => useLogin(), { wrapper: makeWrapper() })

    await act(async () => {
      result.current.mutate({ email: 'u@u.com', password: 'password123' })
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user?.email).toBe('u@u.com')
  })

  it('returns a generic error message for invalid credentials', async () => {
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'invalid_credentials' }, { status: 401 }),
      ),
    )

    const { useLogin } = await import('./authHooks')
    const { result } = renderHook(() => useLogin(), { wrapper: makeWrapper() })

    await act(async () => {
      result.current.mutate({ email: 'x@x.com', password: 'wrongpassword' })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    // The error message must be the generic one (does not reveal which field failed)
    const { getLoginErrorMessage } = await import('./authHooks')
    const msg = getLoginErrorMessage(result.current.error)
    expect(msg).toBe('Credenciales inválidas')
  })

  it('returns the same generic message for both "email not found" and "wrong password" scenarios', async () => {
    // Scenario A — email not found (backend still returns 401 with same body)
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'user_not_found' }, { status: 401 }),
      ),
    )

    const { useLogin, getLoginErrorMessage } = await import('./authHooks')
    const { result: rA } = renderHook(() => useLogin(), { wrapper: makeWrapper() })

    await act(async () => {
      rA.current.mutate({ email: 'nonexistent@x.com', password: 'any' })
    })
    await waitFor(() => expect(rA.current.isError).toBe(true))
    expect(getLoginErrorMessage(rA.current.error)).toBe('Credenciales inválidas')

    // Scenario B — wrong password (same 401)
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'invalid_credentials' }, { status: 401 }),
      ),
    )

    const { result: rB } = renderHook(() => useLogin(), { wrapper: makeWrapper() })

    await act(async () => {
      rB.current.mutate({ email: 'real@x.com', password: 'wrongpassword' })
    })
    await waitFor(() => expect(rB.current.isError).toBe(true))
    expect(getLoginErrorMessage(rB.current.error)).toBe('Credenciales inválidas')
  })
})

// ── useLogout ─────────────────────────────────────────────────────────────────

describe('useLogout', () => {
  it('clears the authStore after successful logout', async () => {
    server.use(
      http.post(`${BASE}/api/auth/logout`, () => HttpResponse.json({ ok: true })),
    )

    const { useLogout } = await import('./authHooks')
    const { useAuthStore } = await import('../store/authStore')

    // Simulate logged-in state
    useAuthStore.getState().login({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'a@b.com', nombre: 'A', created_at: '' })

    const { result } = renderHook(() => useLogout(), { wrapper: makeWrapper() })

    await act(async () => {
      result.current.mutate()
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })

  it('removes the cached /me query so the bootstrap guard cannot keep rendering the app', async () => {
    server.use(
      http.post(`${BASE}/api/auth/logout`, () => HttpResponse.json({ ok: true })),
    )

    const { useLogout, AUTH_QUERY_KEYS } = await import('./authHooks')
    const { useAuthStore } = await import('../store/authStore')

    // Shared client so we can seed and inspect the /me cache.
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    // Seed a stale-but-successful /me result (the state after a prior login).
    qc.setQueryData(AUTH_QUERY_KEYS.me, { id: '1', negocio_id: 'neg-1', es_admin: false, email: 'a@b.com', nombre: 'A', created_at: '' })
    expect(qc.getQueryData(AUTH_QUERY_KEYS.me)).toBeDefined()

    useAuthStore.getState().login({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'a@b.com', nombre: 'A', created_at: '' })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useLogout(), { wrapper })

    await act(async () => {
      result.current.mutate()
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The cached /me success must be gone — otherwise RequireAuthWithBootstrap
    // would keep rendering children and never redirect to /login.
    expect(qc.getQueryData(AUTH_QUERY_KEYS.me)).toBeUndefined()
  })
})
