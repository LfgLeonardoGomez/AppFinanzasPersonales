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
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'New User')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'securepassword')
    await userEvent.click(screen.getByRole('button', { name: /crear mi negocio/i }))

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
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'Dup')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'securepassword')
    await userEvent.click(screen.getByRole('button', { name: /crear mi negocio/i }))

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
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'A')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'short') // < 8 chars
    await userEvent.click(screen.getByRole('button', { name: /crear mi negocio/i }))

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
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'Test')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /crear mi negocio/i }))

    await waitFor(() => {
      // Some error must be shown
      const errorEl = screen.queryByRole('alert') ?? screen.queryByText(/error|inválid/i)
      expect(errorEl).not.toBeNull()
    })

    const { useAuthStore } = await import('./store/authStore')
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})

// ── C-30: dos caminos de alta ─────────────────────────────────────────────────

describe('RegisterPage — dos caminos', () => {
  it('el camino de invitación pide código y no pide nombre de negocio', async () => {
    renderRegisterPage()

    await userEvent.click(screen.getByRole('radio', { name: /sumarme a uno/i }))

    expect(screen.getByLabelText(/código de invitación/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/nombre del negocio/i)).not.toBeInTheDocument()
  })

  it('cada camino pega al endpoint que le corresponde', async () => {
    // El modo de falla que importa es silencioso: por el camino equivocado el
    // empleado no recibe error, se queda con un negocio propio y vacío.
    const golpeados: string[] = []
    server.use(
      http.post(`${BASE}/api/auth/registro`, async () => {
        golpeados.push('registro')
        return HttpResponse.json({ id: 'u1' }, { status: 201 })
      }),
      http.post(`${BASE}/api/auth/registro-empleado`, async () => {
        golpeados.push('registro-empleado')
        return HttpResponse.json({ id: 'u2' }, { status: 201 })
      }),
    )

    renderRegisterPage()
    await userEvent.click(screen.getByRole('radio', { name: /sumarme a uno/i }))
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'Empleado')
    await userEvent.type(screen.getByLabelText(/email/i), 'emp@test.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'password123')
    await userEvent.type(screen.getByLabelText(/código de invitación/i), 'A3F7K2QB')
    await userEvent.click(screen.getByRole('button', { name: /sumarme al negocio/i }))

    await waitFor(() => expect(golpeados).toEqual(['registro-empleado']))
  })

  it('sin código no envía nada', async () => {
    const golpeados: string[] = []
    server.use(
      http.post(`${BASE}/api/auth/registro-empleado`, async () => {
        golpeados.push('registro-empleado')
        return HttpResponse.json({ id: 'u2' }, { status: 201 })
      }),
    )

    renderRegisterPage()
    await userEvent.click(screen.getByRole('radio', { name: /sumarme a uno/i }))
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'Empleado')
    await userEvent.type(screen.getByLabelText(/email/i), 'emp@test.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'password123')
    await userEvent.click(screen.getByRole('button', { name: /sumarme al negocio/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/código/i)
    expect(golpeados).toHaveLength(0)
  })

  it('un código rechazado muestra un mensaje único, sin revelar el motivo', async () => {
    server.use(
      http.post(`${BASE}/api/auth/registro-empleado`, () =>
        HttpResponse.json({ detail: 'El código de invitación no es válido.' }, { status: 400 }),
      ),
    )

    renderRegisterPage()
    await userEvent.click(screen.getByRole('radio', { name: /sumarme a uno/i }))
    await userEvent.type(screen.getByLabelText('Nombre', { exact: true }), 'Empleado')
    await userEvent.type(screen.getByLabelText(/email/i), 'emp@test.com')
    await userEvent.type(screen.getByLabelText(/contraseña/i), 'password123')
    await userEvent.type(screen.getByLabelText(/código de invitación/i), 'ZZZZ2345')
    await userEvent.click(screen.getByRole('button', { name: /sumarme al negocio/i }))

    const alerta = await screen.findByRole('alert')
    // El backend no distingue inexistente / vencido / usado (D-41) y la UI
    // tampoco debe inventar precisión: orienta a la acción.
    expect(alerta).toHaveTextContent(/pedile uno nuevo a tu administrador/i)
    expect(alerta).not.toHaveTextContent(/vencid|usado|inexistente/i)
  })
})
