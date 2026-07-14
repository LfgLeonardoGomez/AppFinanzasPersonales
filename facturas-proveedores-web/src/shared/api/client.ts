/**
 * Axios client — single instance for the entire app.
 *
 * Configuration (D-C04-2):
 *  - baseURL: '/api'  → resolved by the Vite proxy in dev (→ :8000) and by
 *    the Vercel rewrite in prod. Same origin, no CORS, SameSite=Lax cookie.
 *  - withCredentials: true → browser attaches the HttpOnly session cookie
 *    automatically. The frontend NEVER reads or stores tokens.
 *
 * Interceptor (D-C04-3):
 *  401 on a protected route → attempt ONE silent POST /auth/refresh
 *    OK   → retry the original request once
 *    fail → clear authStore + navigate to /login
 *  Guards:
 *    - 401 from /auth/login or /auth/refresh itself → propagate immediately
 *    - _retry flag → prevent infinite loop on the retry
 *  Concurrency:
 *    - A single refreshPromise is shared; parallel 401s queue on it instead
 *      of triggering N parallel refreshes (which would rotate the token N
 *      times and invalidate previous ones — D-C04-3 risk).
 */

import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { navigateToLogin } from './navigateToLogin'

// Extend the Axios request config to carry our retry flag and skip flag.
declare module 'axios' {
  interface InternalAxiosRequestConfig {
    _retry?: boolean
    skipAuthRedirect?: boolean
  }
}

// Auth routes that must never trigger a refresh loop.
const AUTH_NO_RETRY_PATHS = ['/auth/login', '/auth/refresh']

function isAuthNoRetryPath(url: string | undefined): boolean {
  if (!url) return false
  return AUTH_NO_RETRY_PATHS.some((p) => url.startsWith(p))
}

// ── Session clear callback ────────────────────────────────────────────────
// Injected by the app bootstrap to avoid circular imports between
// the shared Axios client and the feature-level authStore.

type ClearSessionFn = () => void

let _clearSession: ClearSessionFn = () => {
  // Default no-op; replaced at app startup via registerClearSession()
}

/**
 * Register the function that clears the Zustand auth store.
 * Called once from the app bootstrap (App.tsx or router.tsx) after the store
 * is created — before any authenticated requests can fly.
 */
export function registerClearSession(fn: ClearSessionFn): void {
  _clearSession = fn
}

// ── Queue for concurrent 401s ─────────────────────────────────────────────

let refreshPromise: Promise<void> | null = null

function getOrStartRefresh(): Promise<void> {
  if (!refreshPromise) {
    refreshPromise = apiClient
      .post<unknown>('/auth/refresh')
      .then(() => {
        refreshPromise = null
      })
      .catch((err: unknown) => {
        refreshPromise = null
        throw err
      })
  }
  return refreshPromise
}

// ── Axios instance ────────────────────────────────────────────────────────

export const apiClient = axios.create({
  baseURL: '/api',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
})

// ── Response interceptor ──────────────────────────────────────────────────

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as InternalAxiosRequestConfig | undefined

    if (error.response?.status !== 401 || !config) {
      return Promise.reject(error)
    }

    // Guard 1: never retry auth routes themselves
    if (isAuthNoRetryPath(config.url)) {
      return Promise.reject(error)
    }

    // Guard 2: never retry more than once
    if (config._retry) {
      // This request already retried — session is truly dead
      _clearSession()
      navigateToLogin()
      return Promise.reject(error)
    }

    // Guard 3: skip redirect for bootstrap query (D-C04-4)
    if (config.skipAuthRedirect) {
      return Promise.reject(error)
    }

    config._retry = true

    try {
      // Wait for the shared refresh (queue all concurrent 401s on one promise)
      await getOrStartRefresh()
      // Retry the original request once
      return apiClient(config)
    } catch {
      // Refresh failed → clear session and redirect
      _clearSession()
      navigateToLogin()
      return Promise.reject(error)
    }
  },
)
