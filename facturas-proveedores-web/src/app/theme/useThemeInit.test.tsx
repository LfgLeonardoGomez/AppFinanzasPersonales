/**
 * Tests for useThemeInit (C-05 task 7.3 — TRIANGULATE).
 *
 * Spec: theme survives reload by reading from the backend profile, not
 * localStorage. The init effect must apply the tema_preferido from the
 * authenticated user's profile to the documentElement.
 */
import { describe, it, expect, beforeEach, beforeAll, afterEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

describe('useThemeInit — applies theme from /me on load', () => {
  it('applies the dark class when /me returns tema_preferido=OSCURO', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () =>
        HttpResponse.json({
          id: '1',
          email: 'u@u.com',
          nombre: 'U',
          tema_preferido: 'OSCURO',
          created_at: '',
        }),
      ),
    )

    const { useThemeInit } = await import('./useThemeInit')

    function Harness() {
      useThemeInit()
      return null
    }

    render(<Harness />, { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true)
    })
  })

  it('does NOT apply the dark class when /me returns tema_preferido=CLARO', async () => {
    server.use(
      http.get(`${BASE}/api/me`, () =>
        HttpResponse.json({
          id: '1',
          email: 'u@u.com',
          nombre: 'U',
          tema_preferido: 'CLARO',
          created_at: '',
        }),
      ),
    )

    const { useThemeInit } = await import('./useThemeInit')
    const { useThemeStore } = await import('./themeStore')

    function Harness() {
      useThemeInit()
      return null
    }

    render(<Harness />, { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(useThemeStore.getState().tema).toBe('CLARO')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('does not read theme from localStorage even if a stale value exists', async () => {
    // Pre-populate a stale theme value in localStorage
    localStorage.setItem('theme', 'OSCURO')

    server.use(
      http.get(`${BASE}/api/me`, () =>
        HttpResponse.json({
          id: '1',
          email: 'u@u.com',
          nombre: 'U',
          tema_preferido: 'CLARO',
          created_at: '',
        }),
      ),
    )

    const { useThemeInit } = await import('./useThemeInit')

    function Harness() {
      useThemeInit()
      return null
    }

    render(<Harness />, { wrapper: makeWrapper() })

    // Wait for the /me call to settle
    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(false)
    })
    // localStorage value was ignored
    expect(localStorage.getItem('theme')).toBe('OSCURO')
  })
})
