/**
 * Tests for LoginPage.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Critical: error message must be IDENTICAL for all invalid credential scenarios.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    writable: true,
  })
})

const BASE = 'http://localhost'
const server = setupServer()

let LoginPageComponent: React.ComponentType
beforeAll(async () => {
  const mod = await import('./LoginPage')
  LoginPageComponent = mod.default
})

function renderLoginPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper() {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/login']}>
          <Routes>
            <Route path="/login" element={<LoginPageComponent />} />
            <Route path="/" element={<div data-testid="home-page">Home</div>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<Wrapper />)
}

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' })
  localStorage.clear()
  sessionStorage.clear()
  vi.clearAllMocks()
  // Reset auth store
})
afterEach(() => {
  server.resetHandlers()
  server.close()
})

describe('LoginPage', () => {
  it('populates authStore and redirects to / on successful login', async () => {
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ user: { id: '1', email: 'u@u.com', nombre: 'U', created_at: '' } }),
      ),
    )

    renderLoginPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'u@u.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }))

    await waitFor(() => {
      expect(screen.getByTestId('home-page')).toBeTruthy()
    })

    const { useAuthStore } = await import('./store/authStore')
    expect(useAuthStore.getState().isAuthenticated).toBe(true)
  })

  it('shows the generic error "Credenciales inválidas" on failed login', async () => {
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'invalid_credentials' }, { status: 401 }),
      ),
    )

    renderLoginPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'x@x.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'wrongpassword')
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }))

    await waitFor(() => {
      expect(screen.getByText('Credenciales inválidas')).toBeTruthy()
    })
  })

  it('shows the SAME generic message for "email not found" and "wrong password" scenarios', async () => {
    // Scenario A: email not found → still 401, same message
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'user_not_found' }, { status: 401 }),
      ),
    )

    const { unmount } = renderLoginPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'noexist@x.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'anypassword')
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }))

    await waitFor(() => {
      expect(screen.getByText('Credenciales inválidas')).toBeTruthy()
    })

    unmount()

    // Scenario B: wrong password → same 401, same message
    server.use(
      http.post(`${BASE}/api/auth/login`, () =>
        HttpResponse.json({ detail: 'invalid_credentials' }, { status: 401 }),
      ),
    )

    renderLoginPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'real@x.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'wrongpassword')
    await userEvent.click(screen.getByRole('button', { name: /iniciar sesión/i }))

    await waitFor(() => {
      expect(screen.getByText('Credenciales inválidas')).toBeTruthy()
    })
  })
})
