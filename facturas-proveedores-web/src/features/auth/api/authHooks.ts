/**
 * TanStack Query hooks for authentication.
 *
 * All requests go through the shared Axios client (with credentials + interceptor).
 * Tokens are NEVER read from responses — they live in HttpOnly cookies.
 * The store is updated with user-profile data only.
 */
import { useMutation, useQuery } from '@tanstack/react-query'
import { apiClient } from '@shared/api/client'
import { useAuthStore } from '../store/authStore'
import type {
  RegistroBody,
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
 */
export function useMe() {
  const login = useAuthStore((s) => s.login)
  const logout = useAuthStore((s) => s.logout)

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
    onSuccess: (data: Usuario) => {
      login(data)
    },
    onError: () => {
      logout()
    },
  } as Parameters<typeof useQuery<Usuario>>[0])
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

  return useMutation({
    mutationFn: async () => {
      await apiClient.post('/auth/logout')
    },
    onSuccess: () => {
      logout()
    },
    onError: () => {
      // Even if the backend call fails, clear local session
      logout()
    },
  })
}
