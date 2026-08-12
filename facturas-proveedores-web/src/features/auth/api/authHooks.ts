/**
 * TanStack Query hooks for authentication.
 *
 * All requests go through the shared Axios client (with credentials + interceptor).
 * Tokens are NEVER read from responses — they live in HttpOnly cookies.
 * The store is updated with user-profile data only.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiClient } from '@shared/api/client'
import { useAuthStore } from '../store/authStore'
import type {
  RegistroBody,
  RegistroEmpleadoBody,
  LoginBody,
  LoginResponse,
  MeResponse,
  Usuario,
} from '@shared/api/api'

// ── Query keys ────────────────────────────────────────────────────────────────

export const AUTH_QUERY_KEYS = {
  me: ['me'] as const,
}

// ── useMe (bootstrap query) ───────────────────────────────────────────────────

/**
 * Bootstrap query: called once at app load to determine if the session cookie
 * is valid. Uses skipAuthRedirect so a 401 here does NOT trigger the interceptor
 * redirect (a 401 from /me means "not logged in", not "session expired").
 *
 * This hook reports session validity only — it does NOT write to the authStore.
 * `RequireAuthWithBootstrap` owns that sync via useEffect (see RequireAuth.tsx).
 * Do NOT re-add `onSuccess` / `onError` here: TanStack Query v5 removed those
 * query callbacks, so they are silently never called.
 */
export function useMe() {
  return useQuery<Usuario>({
    queryKey: AUTH_QUERY_KEYS.me,
    queryFn: async () => {
      const res = await apiClient.get<MeResponse>('/me', {
        skipAuthRedirect: true,
      } as Parameters<typeof apiClient.get>[1])
      return res.data
    },
    retry: false,
    staleTime: 1000 * 60 * 5, // 5 min — amortizes the bootstrap round-trip
  })
}

// ── useRegister ───────────────────────────────────────────────────────────────

export function useRegister() {
  return useMutation({
    mutationFn: async (body: RegistroBody) => {
      const res = await apiClient.post<Usuario>('/auth/registro', body)
      return res.data
    },
  })
}

/**
 * Join an EXISTING negocio with an invitation code (C-29).
 *
 * Deliberately a separate hook from useRegister, hitting a separate endpoint.
 * Routing both through one call would mean an employee who mistypes something
 * silently ends up with their own empty business instead of an error.
 */
export function useRegisterEmpleado() {
  return useMutation({
    mutationFn: async (body: RegistroEmpleadoBody) => {
      const res = await apiClient.post<Usuario>('/auth/registro-empleado', body)
      return res.data
    },
  })
}

/**
 * The message for a rejected invitation code.
 *
 * The backend answers identically for unknown, expired and already-used codes
 * so the endpoint cannot be used to probe which shops exist (D-41). The UI must
 * not invent precision it does not have — it points at the action instead.
 */
export function getCodigoErrorMessage(_error: unknown): string {
  return 'El código no es válido o ya venció. Pedile uno nuevo a tu administrador.'
}

// ── useLogin ──────────────────────────────────────────────────────────────────

export function useLogin() {
  const login = useAuthStore((s) => s.login)

  return useMutation({
    mutationFn: async (body: LoginBody) => {
      const res = await apiClient.post<LoginResponse>('/auth/login', body)
      return res.data
    },
    onSuccess: (data: LoginResponse) => {
      login(data.user)
    },
  })
}

/**
 * Map any login error to the single generic message required by the spec.
 * The message must NOT reveal whether the email or the password was wrong.
 */
export function getLoginErrorMessage(_error: unknown): string {
  return 'Credenciales inválidas'
}

// ── useLogout ─────────────────────────────────────────────────────────────────

export function useLogout() {
  const logout = useAuthStore((s) => s.logout)
  const queryClient = useQueryClient()

  // Clearing the store alone is NOT enough: the `/me` bootstrap query stays
  // cached as `success` (staleTime 5 min), and `RequireAuthWithBootstrap`
  // renders children whenever that query is a cached success — so the guard
  // would keep showing the app after logout. Removing the query forces a
  // re-verification against the backend (whose cookie is now cleared → 401),
  // which drives the redirect to /login.
  const clearSession = () => {
    logout()
    queryClient.removeQueries({ queryKey: AUTH_QUERY_KEYS.me })
  }

  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout')
    },
    onSuccess: clearSession,
    // Even if the backend call fails, clear local session
    onError: clearSession,
  })
}
