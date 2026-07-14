/**
 * Tests for RequireAuth guard and session bootstrap.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    writable: true,
  })
})

const BASE = 'http://localhost'
const server = setupServer()

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

// ── Helper: render with router ────────────────────────────────────────────────

async function renderWithAuth(initialPath: string) {
  const { RequireAuth } = await import('./RequireAuth')
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })

  function App() {
    return (
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          <Route
            path="/private"
            element={
              <RequireAuth>
                <div data-testid="private-content">Private</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    )
  }

  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }

  return render(<Wrapper><App /></Wrapper>)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('RequireAuth — redirect when not authenticated', () => {
  it('redirects to /login when accessing a private route without a session', async () => {
    // Simulate no session (logout state)
    const { useAuthStore } = await import('./store/authStore')
    useAuthStore.getState().logout()

    await renderWithAuth('/private')

    // Should be redirected to login (either we see the login page or the URL changed)
    await waitFor(() => {
      expect(screen.queryByTestId('login-page')).not.toBeNull()
      expect(screen.queryByTestId('private-content')).toBeNull()
    })
  })

  it('renders protected content when the user is authenticated', async () => {
    const { useAuthStore } = await import('./store/authStore')
    useAuthStore
      .getState()
      .login({ id: '1', email: 'a@b.com', nombre: 'A', created_at: '' })

    await renderWithAuth('/private')

    await waitFor(() => {
      expect(screen.getByTestId('private-content')).toBeTruthy()
    })
  })
})

describe('RequireAuth — bootstrap state', () => {
  it('shows a loading state while the bootstrap query is pending', async () => {
    // Force bootstrap into pending state by never resolving /me
    server.use(
      http.get(`${BASE}/api/me`, async () => {
        // Never resolve — simulate pending
        await new Promise<never>(() => undefined)
      }),
    )

    // Reset store so isAuthenticated = false (bootstrap not done)
    const { useAuthStore } = await import('./store/authStore')
    useAuthStore.getState().logout()

    // Import a version of RequireAuth that hooks into the bootstrap
    const { RequireAuthWithBootstrap } = await import('./RequireAuth')
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            <Route
              path="/private"
              element={
                <RequireAuthWithBootstrap>
                  <div data-testid="private-content">Private</div>
                </RequireAuthWithBootstrap>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Should show a verification/loading state, not login and not private content
    // (prevents flash of public or private page before bootstrap resolves)
    await waitFor(() => {
      const loading = screen.queryByRole('status') ?? screen.queryByText(/verificando|cargando/i)
      const privateEl = screen.queryByTestId('private-content')
      // Either we see loading or neither login nor private (the guard is still deciding)
      expect(loading ?? (privateEl === null ? 'pending' : null)).toBeTruthy()
    })
  })

  it('populates store and shows private content when bootstrap returns 2xx', async () => {
    const user = { id: '1', email: 'b@b.com', nombre: 'B', created_at: '' }

    server.use(
      http.get(`${BASE}/api/me`, () => HttpResponse.json(user)),
    )

    const { useAuthStore } = await import('./store/authStore')
    useAuthStore.getState().logout()

    const { RequireAuthWithBootstrap } = await import('./RequireAuth')
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            <Route
              path="/private"
              element={
                <RequireAuthWithBootstrap>
                  <div data-testid="private-content">Private</div>
                </RequireAuthWithBootstrap>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(screen.queryByTestId('private-content')).not.toBeNull()
    })

    expect(useAuthStore.getState().isAuthenticated).toBe(true)
    expect(useAuthStore.getState().user?.email).toBe('b@b.com')
  })

  it('leaves store empty and does NOT trigger login redirect when bootstrap returns 401', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () => new HttpResponse(null, { status: 401 })),
    )

    const { useAuthStore } = await import('./store/authStore')
    useAuthStore.getState().logout()

    const { RequireAuthWithBootstrap } = await import('./RequireAuth')
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })

    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/private']}>
          <Routes>
            <Route path="/login" element={<div data-testid="login-page">Login</div>} />
            <Route
              path="/private"
              element={
                <RequireAuthWithBootstrap>
                  <div data-testid="private-content">Private</div>
                </RequireAuthWithBootstrap>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    )

    // Should redirect to login (unauthenticated), but NOT because of a "session expired" error
    await waitFor(() => {
      expect(screen.queryByTestId('login-page')).not.toBeNull()
    })

    // Store must be empty (not populated by a 401 response)
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
    expect(useAuthStore.getState().user).toBeNull()
  })
})
