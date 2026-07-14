/**
 * Tests for the theme store (C-05 task 7.1, 7.3 — TDD RED).
 *
 * Spec:
 * - Theme is a Zustand UI slice holding the current TemaPreferido.
 * - Toggling applies the `dark` class to document.documentElement.
 * - Toggling persists via PATCH /api/me (tema_preferido).
 * - localStorage is NEVER used for theme.
 * - Theme survives reload by reading from the backend profile (D6).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { act } from '@testing-library/react'
import type { ReactNode } from 'react'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.documentElement.classList.remove('dark')
  document.documentElement.dataset.theme = ''
})

describe('themeStore — applies dark class to documentElement', () => {
  it('starts in CLARO and does not add the dark class on init', async () => {
    const { useThemeStore } = await import('./themeStore')
    // Set to a known state
    useThemeStore.getState().setTema('CLARO')
    expect(useThemeStore.getState().tema).toBe('CLARO')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })

  it('setTema("OSCURO") adds the dark class to documentElement', async () => {
    const { useThemeStore } = await import('./themeStore')

    act(() => {
      useThemeStore.getState().setTema('OSCURO')
    })

    expect(useThemeStore.getState().tema).toBe('OSCURO')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('setTema("CLARO") removes the dark class from documentElement', async () => {
    const { useThemeStore } = await import('./themeStore')

    act(() => {
      useThemeStore.getState().setTema('OSCURO')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(true)

    act(() => {
      useThemeStore.getState().setTema('CLARO')
    })
    expect(document.documentElement.classList.contains('dark')).toBe(false)
  })
})

describe('themeStore — does NOT use localStorage', () => {
  it('does not write any theme key to localStorage on toggle', async () => {
    const { useThemeStore } = await import('./themeStore')

    act(() => {
      useThemeStore.getState().setTema('OSCURO')
    })
    act(() => {
      useThemeStore.getState().setTema('CLARO')
    })

    const keys = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i),
    )
    // No theme-related key in localStorage (D6 — never persist there)
    for (const k of keys) {
      expect(k ?? '').not.toMatch(/theme|tema/i)
    }
  })

  it('does not read any theme key from localStorage on init', async () => {
    // Pre-populate a fake "theme" key in localStorage. The store must ignore it.
    localStorage.setItem('theme', 'OSCURO')
    localStorage.setItem('tema', 'OSCURO')

    const { useThemeStore } = await import('./themeStore')
    // Store is still CLARO by default — localStorage is ignored
    expect(useThemeStore.getState().tema).toBe('CLARO')
  })
})

describe('useUpdateTema hook — persists to backend', () => {
  it('calls PATCH /api/me with tema_preferido on toggle', async () => {
    const patchSpy = vi.fn().mockResolvedValue({
      id: '1',
      email: 'u@u.com',
      nombre: 'U',
      tema_preferido: 'OSCURO',
      created_at: '',
    })

    vi.doMock('@shared/api/perfilApi', () => ({
      patchMe: patchSpy,
      postMeAvatar: vi.fn(),
      getSignedPreset: vi.fn(),
    }))

    const { useUpdateTema } = await import('./useUpdateTema')
    const { renderHook, waitFor } = await import('@testing-library/react')
    const { QueryClient, QueryClientProvider } = await import(
      '@tanstack/react-query'
    )
    const { useThemeStore } = await import('./themeStore')

    const qc = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )

    const { result } = renderHook(() => useUpdateTema(), { wrapper })

    act(() => {
      useThemeStore.getState().setTema('OSCURO')
    })
    act(() => {
      result.current.mutate('OSCURO')
    })

    await waitFor(() => expect(patchSpy).toHaveBeenCalled())
    expect(patchSpy).toHaveBeenCalledWith({ tema_preferido: 'OSCURO' })
  })
})
