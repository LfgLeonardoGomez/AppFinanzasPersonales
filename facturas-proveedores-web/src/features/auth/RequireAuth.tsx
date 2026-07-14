/**
 * RequireAuth — route guard for authenticated routes.
 *
 * Two variants:
 *
 * 1. `RequireAuth`: simple guard reading from the authStore.
 *    Use inside the app tree when the bootstrap has already run.
 *
 * 2. `RequireAuthWithBootstrap`: calls GET /api/me (D-C04-4) to determine
 *    session validity, shows a loading state while pending, then guards.
 *    The bootstrap 401 is expected (= not logged in), NOT treated as a
 *    "session expired" error, so it does NOT trigger the interceptor redirect.
 *
 * Design (D-C04-4):
 *  - While bootstrap is pending → show verification spinner (avoids public↔private flash)
 *  - 200 → populate store → render children
 *  - 401 → leave store empty → redirect to /login
 */
import { type ReactNode, useEffect } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from './store/authStore'
import { useMe } from './api/authHooks'

// ── Simple guard (no bootstrap) ───────────────────────────────────────────────

interface RequireAuthProps {
  children: ReactNode
}

/**
 * Guards routes using the current Zustand auth state.
 * Does NOT call /api/me — assumes the bootstrap has already run.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// ── Guard with bootstrap ──────────────────────────────────────────────────────

/**
 * Guards routes AND runs the session bootstrap (`GET /api/me`).
 *
 * Lifecycle:
 *  - pending: renders a verification placeholder (no flash)
 *  - success: populates store, renders children
 *  - error (401): store stays empty, renders redirect to /login
 *
 * Use this as the root guard in the app router to establish session state
 * on first load. Nested routes can then use the simpler `RequireAuth`.
 */
export function RequireAuthWithBootstrap({ children }: RequireAuthProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)

  const { data, status } = useMe()

  // Sync bootstrap result to store
  useEffect(() => {
    if (status === 'success' && data) {
      login(data)
    } else if (status === 'error') {
      logout()
    }
  }, [status, data, login, logout])

  // Bootstrap confirmed active session → render children immediately.
  // We check data directly (not just isAuthenticated) because the store
  // resets to false on page reload, but useMe() may already have resolved.
  // Without this guard, the render below would return <Navigate> before
  // the useEffect syncs the store, causing an unwanted redirect (FE-BOOT-01).
  if (status === 'success' && data) {
    return <>{children}</>
  }

  // Pending: show verification state (prevents flash)
  if (status === 'pending') {
    return (
      <div
        role="status"
        aria-label="Verificando sesión"
        className="flex min-h-screen items-center justify-center"
      >
        <span className="sr-only">Verificando sesión…</span>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
      </div>
    )
  }

  // Bootstrap resolved with error (401) → not authenticated
  if (status === 'error' || !isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}

// Default export for backward compatibility
export default RequireAuth
