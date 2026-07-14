/**
 * Auth store — session state for the UI (D-C04-1).
 *
 * Holds ONLY derived UI state:
 *  - user: the authenticated user profile (from GET /api/me or POST /api/auth/login)
 *  - isAuthenticated: derived from user !== null
 *
 * The store NEVER holds access_token or refresh_token.
 * Those live exclusively in HttpOnly cookies managed by the browser.
 *
 * Persistence: NONE. On every app load, the bootstrap (useAuthBootstrap) calls
 * GET /api/me to determine session validity. Storing session flags in storage
 * would create a stale trust signal that conflicts with the HttpOnly contract.
 */
import { create } from 'zustand'
import type { Usuario } from '@shared/api/api'

interface AuthState {
  /** Authenticated user profile. null = not authenticated. */
  user: Usuario | null
  /** Derived: true iff user !== null */
  isAuthenticated: boolean
  /** Set user after successful login or bootstrap */
  login: (user: Usuario) => void
  /** Clear user on explicit logout */
  logout: () => void
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isAuthenticated: false,

  login: (user: Usuario) =>
    set({
      user,
      isAuthenticated: true,
    }),

  logout: () =>
    set({
      user: null,
      isAuthenticated: false,
    }),
}))

/**
 * Standalone function for clearing session.
 * Used by the Axios interceptor (src/shared/api/client.ts) which lives
 * outside the React tree and cannot call hooks.
 * Registered via registerClearSession() at app startup.
 */
export function clearSession(): void {
  useAuthStore.getState().logout()
}
