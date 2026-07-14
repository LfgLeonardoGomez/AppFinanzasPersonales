/**
 * Tests for RegisterPage.
 *
 * TDD: RED → GREEN → TRIANGULATE → REFACTOR
 *
 * Uses RTL + MSW + react-router for navigation assertions.
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

function renderRegisterPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/registro']}>
        <Routes>
          <Route path="/registro" element={<RegisterPageLazy />} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          <Route path="/" element={<div data-testid="home-page">Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

// Lazy import to allow RED phase
let RegisterPageLazy: React.ComponentType
beforeAll(async () => {
  const mod = await import('./RegisterPage')
  RegisterPageLazy = mod.default
})

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

describe('RegisterPage', () => {
  it('redirects after successful registration', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro`, () =>
        HttpResponse.json({ id: '1', email: 'new@t.com', nombre: 'New', created_at: '' }),
      ),
    )

    renderRegisterPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'new@t.com')
    await userEvent.type(screen.getByLabelText(/nombre/i), 'New User')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'securepassword')
    await userEvent.click(screen.getByRole('button', { name: /registrar/i }))

    // After successful registration, redirect to /login (or /)
    await waitFor(() => {
      const loginPage = screen.queryByTestId('login-page')
      const homePage = screen.queryByTestId('home-page')
      expect(loginPage ?? homePage).not.toBeNull()
    })
  })

  it('shows email-in-use message when backend returns duplicate error', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro`, () =>
        HttpResponse.json({ detail: 'email_already_exists' }, { status: 400 }),
      ),
    )

    renderRegisterPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'dup@t.com')
    await userEvent.type(screen.getByLabelText(/nombre/i), 'Dup')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'securepassword')
    await userEvent.click(screen.getByRole('button', { name: /registrar/i }))

    await waitFor(() => {
      expect(screen.getByText(/email.*uso|ya.*registrado|ya existe/i)).toBeTruthy()
    })
  })

  it('shows client-side validation error for short password WITHOUT sending request', async () => {
    let requestMade = false
    server.use(
      http.post(`${BASE}/api/auth/registro`, () => {
        requestMade = true
        return HttpResponse.json({})
      }),
    )

    renderRegisterPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@b.com')
    await userEvent.type(screen.getByLabelText(/nombre/i), 'A')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'short') // < 8 chars
    await userEvent.click(screen.getByRole('button', { name: /registrar/i }))

    // Should show client-side error
    await waitFor(() => {
      expect(screen.getByText(/mínimo 8|al menos 8|8 caracteres/i)).toBeTruthy()
    })

    // No backend request should have been made
    expect(requestMade).toBe(false)
  })

  it('renders 422 backend validation error and does not create a session', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro`, () =>
        HttpResponse.json(
          { detail: [{ loc: ['body', 'email'], msg: 'value is not a valid email', type: 'value_error' }] },
          { status: 422 },
        ),
      ),
    )

    renderRegisterPage()

    await userEvent.type(screen.getByLabelText(/email/i), 'notanemail')
    await userEvent.type(screen.getByLabelText(/nombre/i), 'Test')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /registrar/i }))

    await waitFor(() => {
      // Some error must be shown
      const errorEl = screen.queryByRole('alert') ?? screen.queryByText(/error|inválid/i)
      expect(errorEl).not.toBeNull()
    })

    const { useAuthStore } = await import('./store/authStore')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
