/**
 * Tests for the recovery screens (C-31).
 *
 * The assertion that carries the most weight is the boring-looking one: the
 * request screen must show the SAME thing whether or not the email has an
 * account. The backend goes out of its way to refuse that information (D2);
 * a UI that said "no encontramos esa cuenta" would hand it straight back.
 *
 * The rest: the token comes from the query string, a rejected link says one
 * thing without guessing why, and a successful reset does NOT leave a session.
 */
import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import RecuperarPage from './RecuperarPage'
import ResetPasswordPage from './ResetPasswordPage'

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'bypass' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function renderRecuperar() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/recuperar']}>
        <Routes>
          <Route path="/recuperar" element={<RecuperarPage />} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function renderReset(query = '?token=untoken') {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/reset${query}`]}>
        <Routes>
          <Route path="/reset" element={<ResetPasswordPage />} />
          <Route path="/login" element={<div data-testid="login-page">Login</div>} />
          <Route path="/recuperar" element={<div data-testid="recuperar-page">Pedir</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('RecuperarPage — no delata quién tiene cuenta', () => {
  it('muestra la misma confirmación exista o no la cuenta', async () => {
    // El backend responde 202 en ambos casos; la pantalla tampoco puede
    // distinguirlos, porque sería devolver lo que el endpoint oculta.
    server.use(
      http.post('/api/auth/recuperar', () =>
        HttpResponse.json({ mensaje: 'ok' }, { status: 202 }),
      ),
    )

    const vistas: string[] = []
    for (const email of ['existe@test.com', 'no_existe@test.com']) {
      const { unmount } = renderRecuperar()
      await userEvent.type(screen.getByLabelText(/email/i), email)
      await userEvent.click(screen.getByRole('button', { name: /enviarme el enlace/i }))
      vistas.push((await screen.findByText(/revisá tu correo/i)).textContent ?? '')
      unmount()
    }

    expect(vistas[0]).toBe(vistas[1])
  })

  it('la confirmación no afirma que el correo salió', async () => {
    server.use(
      http.post('/api/auth/recuperar', () =>
        HttpResponse.json({ mensaje: 'ok' }, { status: 202 }),
      ),
    )
    renderRecuperar()

    await userEvent.type(screen.getByLabelText(/email/i), 'alguien@test.com')
    await userEvent.click(screen.getByRole('button', { name: /enviarme el enlace/i }))

    // "Si ese email tiene una cuenta" — condicional a propósito.
    expect(await screen.findByText(/si ese email tiene una cuenta/i)).toBeInTheDocument()
  })

  it('un email mal formado no llega a enviarse', async () => {
    const golpeados: string[] = []
    server.use(
      http.post('/api/auth/recuperar', () => {
        golpeados.push('recuperar')
        return HttpResponse.json({ mensaje: 'ok' }, { status: 202 })
      }),
    )
    renderRecuperar()

    await userEvent.type(screen.getByLabelText(/email/i), 'esto-no-es-un-email')
    await userEvent.click(screen.getByRole('button', { name: /enviarme el enlace/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/email válido/i)
    expect(golpeados).toHaveLength(0)
  })
})

describe('ResetPasswordPage', () => {
  it('sin token en la URL no ofrece el formulario', () => {
    renderReset('')
    expect(screen.getByText(/enlace incompleto/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/contraseña nueva/i)).not.toBeInTheDocument()
  })

  it('valida el mínimo de ocho antes de enviar', async () => {
    const golpeados: string[] = []
    server.use(
      http.post('/api/auth/reset', () => {
        golpeados.push('reset')
        return HttpResponse.json({ mensaje: 'ok' })
      }),
    )
    renderReset()

    await userEvent.type(screen.getByLabelText(/contraseña nueva/i), 'corta')
    await userEvent.type(screen.getByLabelText(/repetila/i), 'corta')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/mínimo 8 caracteres/i)
    expect(golpeados).toHaveLength(0)
  })

  it('exige que las dos coincidan', async () => {
    renderReset()

    await userEvent.type(screen.getByLabelText(/contraseña nueva/i), 'unacontrasena1')
    await userEvent.type(screen.getByLabelText(/repetila/i), 'otradistinta12')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/no coinciden/i)
  })

  it('un token rechazado muestra un mensaje único, sin adivinar el motivo', async () => {
    server.use(
      http.post('/api/auth/reset', () =>
        HttpResponse.json({ detail: 'invalido' }, { status: 400 }),
      ),
    )
    renderReset()

    await userEvent.type(screen.getByLabelText(/contraseña nueva/i), 'unacontrasena1')
    await userEvent.type(screen.getByLabelText(/repetila/i), 'unacontrasena1')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    const alerta = await screen.findByRole('alert')
    expect(alerta).toHaveTextContent(/no es válido o ya venció/i)
    expect(alerta).not.toHaveTextContent(/vencid[oa] hace|ya fue usado|no existe/i)
  })

  it('tras el reset lleva al login, no a la app', async () => {
    server.use(http.post('/api/auth/reset', () => HttpResponse.json({ mensaje: 'ok' })))
    renderReset()

    await userEvent.type(screen.getByLabelText(/contraseña nueva/i), 'unacontrasena1')
    await userEvent.type(screen.getByLabelText(/repetila/i), 'unacontrasena1')
    await userEvent.click(screen.getByRole('button', { name: /guardar/i }))

    // D7: no se inicia sesión sola — el enlace del correo no es una sesión.
    await waitFor(() => expect(screen.getByTestId('login-page')).toBeInTheDocument())
  })

  it('avisa que el cambio cierra las sesiones abiertas', () => {
    renderReset()
    expect(screen.getByText(/se cierran todas las sesiones abiertas/i)).toBeInTheDocument()
  })
})
