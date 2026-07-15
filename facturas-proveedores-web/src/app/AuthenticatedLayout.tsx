/**
 * AuthenticatedLayout — wraps private routes with auth bootstrap + AppLayout.
 *
 * All private routes are children of this layout in the router (Outlet).
 * The <Toaster /> is mounted here (C-20) so all authenticated routes can
 * fire toasts via `import { toast } from '@shared/components/Toaster/toast'`.
 */
import { RequireAuthWithBootstrap } from '@features/auth/RequireAuth'
import { AppLayout } from '@shared/components/AppLayout/AppLayout'
import { Toaster } from '@shared/components/Toaster/Toaster'

export function AuthenticatedLayout() {
  return (
    <RequireAuthWithBootstrap>
      <AppLayout />
      <Toaster />
    </RequireAuthWithBootstrap>
  )
}

export default AuthenticatedLayout
