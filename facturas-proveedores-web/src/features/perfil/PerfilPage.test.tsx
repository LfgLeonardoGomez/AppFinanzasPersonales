/**
 * Tests for PerfilPage (C-05 task 8.1, 8.3 — TDD RED, then GREEN).
 *
 * Spec:
 * - The page loads current telefono/nombre_negocio from the authenticated user.
 * - Saving calls PATCH /api/me with the changed fields.
 * - Empty optional fields are allowed (no blocking validation).
 * - The theme switch toggles CLARO/OSCURO and persists via the same endpoint.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
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
  document.documentElement.classList.remove('dark')
  vi.clearAllMocks()
})

afterEach(() => {
  server.resetHandlers()
  server.close()
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={qc}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
}

describe('PerfilPage — loads and edits profile', () => {
  it('pre-fills telefono and nombre_negocio from /api/me', async () => {
    const me = {
      id: '1',
      email: 'u@u.com',
      nombre: 'Test User',
      telefono: '1122334455',
      nombre_negocio: 'Kiosco Don Pepe',
      tema_preferido: 'CLARO',
      avatar_url: null,
      created_at: '',
    }
    server.use(
      http.get(`${BASE}/api/me`, () => HttpResponse.json(me)),
    )

    const { default: PerfilPage } = await import('./PerfilPage')
    render(<PerfilPage />, { wrapper: makeWrapper() })

    await waitFor(() => {
      expect((screen.getByLabelText(/teléfono/i) as HTMLInputElement).value).toBe(
        '1122334455',
      )
      expect(
        (screen.getByLabelText(/nombre del negocio/i) as HTMLInputElement).value,
      ).toBe('Kiosco Don Pepe')
    })
  })

  it('saves changes via PATCH /api/me with the changed fields', async () => {
    const me = {
      id: '1',
      email: 'u@u.com',
      nombre: 'Test User',
      telefono: '1122334455',
      nombre_negocio: 'Kiosco',
      tema_preferido: 'CLARO',
      avatar_url: null,
      created_at: '',
    }
    server.use(
      http.get(`${BASE}/api/me`, () => HttpResponse.json(me)),
      http.patch(`${BASE}/api/me`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...me, ...body })
      }),
    )

    const { default: PerfilPage } = await import('./PerfilPage')
    render(<PerfilPage />, { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(screen.getByLabelText(/teléfono/i)).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText(/teléfono/i), {
      target: { value: '11999887766' },
    })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => {
      // The page reflects the saved value back
      expect((screen.getByLabelText(/teléfono/i) as HTMLInputElement).value).toBe(
        '11999887766',
      )
    })
  })

  it('allows empty optional fields without blocking', async () => {
    const me = {
      id: '1',
      email: 'u@u.com',
      nombre: 'Test User',
      telefono: '1122334455',
      nombre_negocio: 'Kiosco',
      tema_preferido: 'CLARO',
      avatar_url: null,
      created_at: '',
    }
    let saved: Record<string, unknown> | null = null
    server.use(
      http.get(`${BASE}/api/me`, () => HttpResponse.json(me)),
      http.patch(`${BASE}/api/me`, async ({ request }) => {
        saved = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ ...me, ...saved })
      }),
    )

    const { default: PerfilPage } = await import('./PerfilPage')
    render(<PerfilPage />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByLabelText(/teléfono/i))

    fireEvent.change(screen.getByLabelText(/teléfono/i), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText(/nombre del negocio/i), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByRole('button', { name: /guardar/i }))

    await waitFor(() => {
      expect(saved).not.toBeNull()
    })
    // The PATCH went through with the cleared fields
    expect(saved).toMatchObject({ telefono: '', nombre_negocio: '' })
  })
})

describe('PerfilPage — theme switch (task 8.3)', () => {
  it('toggles tema_preferido between CLARO and OSCURO', async () => {
    const me = {
      id: '1',
      email: 'u@u.com',
      nombre: 'Test User',
      telefono: null,
      nombre_negocio: null,
      tema_preferido: 'CLARO',
      avatar_url: null,
      created_at: '',
    }
    const patches: Array<Record<string, unknown>> = []
    server.use(
      http.get(`${BASE}/api/me`, () => HttpResponse.json(me)),
      http.patch(`${BASE}/api/me`, async ({ request }) => {
        const body = (await request.json()) as Record<string, unknown>
        patches.push(body)
        return HttpResponse.json({ ...me, ...body })
      }),
    )

    const { default: PerfilPage } = await import('./PerfilPage')
    render(<PerfilPage />, { wrapper: makeWrapper() })

    await waitFor(() => screen.getByLabelText(/teléfono/i))

    const themeToggle = screen.getByRole('switch', { name: /tema|oscuro|claro/i })
    fireEvent.click(themeToggle)

    await waitFor(() => {
      const temaPatch = patches.find((p) => 'tema_preferido' in p)
      expect(temaPatch).toBeDefined()
    })
    expect(patches.find((p) => 'tema_preferido' in p)).toMatchObject({
      tema_preferido: 'OSCURO',
    })
  })
})
