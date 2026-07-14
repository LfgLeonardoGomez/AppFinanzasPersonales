/**
 * Application entry point.
 *
 * Mounts global providers and wires the Axios interceptor's clearSession
 * callback to the Zustand authStore (D-C04-3: avoids circular imports).
 *
 * Provider tree:
 *   QueryClientProvider
 *     └─ App (RouterProvider)
 *
 * Note: BrowserRouter is NOT used here — the router is created via
 * createBrowserRouter in router.tsx and mounted by RouterProvider in App.tsx.
 */
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { registerClearSession } from '@shared/api/client'
import { clearSession } from '@features/auth/store/authStore'
import { ThemeBootstrap } from './theme/ThemeBootstrap'
import './index.css'

// ── Wire the Axios interceptor's clearSession to the authStore ────────────────
// Must be called before any authenticated request can fire.
registerClearSession(clearSession)

// ── TanStack Query client ─────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 min default; auth bootstrap overrides this
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
})

// ── Mount ─────────────────────────────────────────────────────────────────────

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeBootstrap />
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
