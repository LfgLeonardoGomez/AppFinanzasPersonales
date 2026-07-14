/**
 * AuthenticatedLayout — wraps private routes with auth bootstrap + AppLayout.
 *
 * All private routes are children of this layout in the router (Outlet).
 */
import { RequireAuthWithBootstrap } from '@features/auth/RequireAuth'
import { AppLayout } from '@shared/components/AppLayout/AppLayout'

export function AuthenticatedLayout() {
  return (
    <RequireAuthWithBootstrap>
      <AppLayout />
    </RequireAuthWithBootstrap>
  )
}

export default AuthenticatedLayout
