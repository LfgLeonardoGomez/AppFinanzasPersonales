/**
 * App router — public and private route tree.
 *
 * Uses createBrowserRouter (D-C04-3) so the router object can be imported
 * by the Axios interceptor to navigate imperatively (router.navigate('/login'))
 * without a full page reload.
 *
 * Route map:
 *  Public  → /login, /registro
 *  Private → / (home), /proveedores (C-07), /proveedores/:id (C-13),
 *            /facturas (C-09), /pagos (C-11), /perfil (C-05)
 *
 * Post-login redirect → /
 * Post-logout redirect → /login (handled by authStore + RequireAuth)
 */
import { createBrowserRouter, Navigate } from 'react-router-dom'
import LoginPage from '@features/auth/LoginPage'
import RegisterPage from '@features/auth/RegisterPage'
import { setNavigate } from '@shared/api/navigateToLogin'
import { HomePage } from './HomePage'
import { AuthenticatedLayout } from './AuthenticatedLayout'
import ProveedoresPage from '@features/proveedores/ProveedoresPage'
import ProveedorDetailPage from '@features/proveedores/ProveedorDetailPage'
import FacturasPage from '@features/facturas/FacturasPage'
import FacturaFormPage from '@features/facturas/FacturaFormPage'
import PagosPage from '@features/pagos/PagosPage'
import PagoFormPage from '@features/pagos/PagoFormPage'
import PerfilPage from '@features/perfil/PerfilPage'

// ── Router ────────────────────────────────────────────────────────────────────

export const router = createBrowserRouter([
  // ── Public routes ──────────────────────────────────────────────────────────
  { path: '/login', element: <LoginPage /> },
  { path: '/registro', element: <RegisterPage /> },

  // ── Private routes (bootstrap guard + AppLayout) ───────────────────────────
  {
    element: <AuthenticatedLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/proveedores', element: <ProveedoresPage /> },
      // C-13 — supplier detail page (cuenta-corriente integration).
      { path: '/proveedores/:id', element: <ProveedorDetailPage /> },

      // ── Facturas routes (C-09) ─────────────────────────────────────────────
      { path: '/facturas', element: <FacturasPage /> },
      { path: '/facturas/nueva', element: <FacturaFormPage /> },
      { path: '/facturas/:id/editar', element: <FacturaFormPage /> },

      // ── Pagos routes (C-11) ────────────────────────────────────────────────
      { path: '/pagos', element: <PagosPage /> },
      { path: '/pagos/nuevo', element: <PagoFormPage /> },
      { path: '/pagos/:id/editar', element: <PagoFormPage /> },

      // ── Perfil route (C-05) ─────────────────────────────────────────────────
      { path: '/perfil', element: <PerfilPage /> },
    ],
  },

  // Catch-all → redirect to home (RequireAuth handles auth check)
  { path: '*', element: <Navigate to="/" replace /> },
])

// Wire the router's navigate function into the Axios interceptor (D-C04-3).
// This runs once when the module is imported (at app startup).
setNavigate((path) => void router.navigate(path))
