/**
 * Tests for the Zustand authStore.
 *
 * TDD cycle:
 *  RED  — test the store contract before implementation exists
 *  GREEN — implement the store
 *  TRIANGULATE — verify no tokens in storage after login
 */
import { describe, it, expect, beforeEach } from 'vitest'

// Dynamic import so we can reset between tests via act of re-importing.
// For Zustand stores, we just call the reset action directly.

describe('authStore — login action', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('populates user and sets isAuthenticated to true after login()', async () => {
    const { useAuthStore } = await import('./authStore')
    const store = useAuthStore.getState()
    store.login({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'test@test.com', nombre: 'Test', created_at: '2024-01-01' })

    const state = useAuthStore.getState()
    expect(state.user).toEqual({
      id: '1', negocio_id: 'neg-1', es_admin: false,
      email: 'test@test.com',
      nombre: 'Test',
      created_at: '2024-01-01',
    })
    expect(state.isAuthenticated).toBe(true)
  })

  it('derives isAuthenticated as false when user is null (initial state)', async () => {
    const { useAuthStore } = await import('./authStore')
    // After logout
    useAuthStore.getState().logout()
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
  })

  it('clears user and isAuthenticated after logout()', async () => {
    const { useAuthStore } = await import('./authStore')
    const store = useAuthStore.getState()
    // First login
    store.login({ id: '2', negocio_id: 'neg-1', es_admin: false, email: 'b@b.com', nombre: 'B', created_at: '' })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    // Then logout
    store.logout()
    const state = useAuthStore.getState()
    expect(state.user).toBeNull()
    expect(state.isAuthenticated).toBe(false)
  })
})

describe('authStore — no tokens in storage', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
  })

  it('does not place tokens in localStorage after login()', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore
      .getState()
      .login({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'a@b.com', nombre: 'A', created_at: '' })

    const tokenPattern = /token|access|refresh|jwt/i
    Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).forEach((k) =>
      expect(k ?? '').not.toMatch(tokenPattern),
    )
  })

  it('does not place tokens in sessionStorage after login()', async () => {
    const { useAuthStore } = await import('./authStore')
    useAuthStore
      .getState()
      .login({ id: '1', negocio_id: 'neg-1', es_admin: false, email: 'a@b.com', nombre: 'A', created_at: '' })

    const tokenPattern = /token|access|refresh|jwt/i
    Array.from({ length: sessionStorage.length }, (_, i) => sessionStorage.key(i)).forEach((k) =>
      expect(k ?? '').not.toMatch(tokenPattern),
    )
  })
})

describe('authStore — clearSession (used by Axios interceptor)', () => {
  it('clearSession() resets the store identical to logout()', async () => {
    const { useAuthStore, clearSession } = await import('./authStore')
    useAuthStore
      .getState()
      .login({ id: '3', negocio_id: 'neg-1', es_admin: false, email: 'c@c.com', nombre: 'C', created_at: '' })
    expect(useAuthStore.getState().isAuthenticated).toBe(true)

    clearSession()
    expect(useAuthStore.getState().user).toBeNull()
    expect(useAuthStore.getState().isAuthenticated).toBe(false)
  })
})
