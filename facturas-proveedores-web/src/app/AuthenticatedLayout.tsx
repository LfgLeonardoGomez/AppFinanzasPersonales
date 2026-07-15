/**
 * AuthenticatedLayout — wraps private routes with auth bootstrap + AppLayout.
 *
 * All private routes are children of this layout in the router (Outlet).
 * The <Toaster /> is mounted here (C-20) so all authenticated routes can
 * fire toasts via `import { toast } from '@shared/components/Toaster/toast'`.
 * The useGlobalShortcuts hook is also mounted here (C-20) for the `n` shortcut
 * (new factura), and the `g+p` / `g+f` / `g+c` navigation sequences.
 */
import { useMemo } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { RequireAuthWithBootstrap } from '@features/auth/RequireAuth'
import { AppLayout } from '@shared/components/AppLayout/AppLayout'
import { Toaster } from '@shared/components/Toaster/Toaster'
import { useGlobalShortcuts } from '@shared/hooks/useGlobalShortcuts'

export function AuthenticatedLayout() {
  const navigate = useNavigate()
  const location = useLocation()

  const bindings = useMemo(
    () => [
      {
        keys: ['n'],
        description: 'Cargar factura',
        action: () => navigate('/facturas/nueva'),
        when: () => location.pathname !== '/facturas/nueva',
      },
      { keys: ['g', 'p'], description: 'Ir a proveedores', action: () => navigate('/proveedores') },
      { keys: ['g', 'f'], description: 'Ir a facturas', action: () => navigate('/facturas') },
      { keys: ['g', 'c'], description: 'Ir a pagos', action: () => navigate('/pagos') },
    ],
    [navigate, location.pathname],
  )

  useGlobalShortcuts(bindings)

  return (
    <RequireAuthWithBootstrap>
      <AppLayout />
      <Toaster />
    </RequireAuthWithBootstrap>
  )
}

export default AuthenticatedLayout
