/**
 * AppLayout — the app shell, rebuilt to the new design system.
 *
 * Per specs/design/LAYOUT.md ("una única definición de navegación") and
 * the Claude Design handoff (Home.dc.html):
 *  - Desktop (>=lg): fixed 232px sidebar — logo, 5 nav items, compact
 *    account footer (avatar link to /perfil + logout).
 *  - Mobile (<lg): slim top bar (logo + avatar link to /perfil) + a
 *    5-item bottom tab bar, sidebar hidden.
 *
 * Routing (`<Outlet/>`) and nav destinations (/, /ventas, /proveedores,
 * /facturas, /pagos, /perfil) are unchanged from the previous shell. The old
 * top-header ThemeToggle/UserMenu dropdown is removed — dark mode already
 * lives in PerfilPage's own toggle (`role="switch"`), and logout is now a
 * direct icon action here instead of a dropdown, matching the new
 * "silent nav" shell (BRAND.md: componentes livianos, sin ruido).
 */
import { Link, useLocation, Outlet } from 'react-router-dom'
import { Home, Users, Users2, FileText, CreditCard, ShoppingCart, UserCircle, LogOut } from 'lucide-react'
import { useAuthStore } from '@features/auth/store/authStore'
import { useLogout } from '@features/auth/api/authHooks'

const NAV_ITEMS = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart, end: false },
  { to: '/proveedores', label: 'Proveedores', icon: Users, end: false },
  { to: '/facturas', label: 'Facturas', icon: FileText, end: false },
  { to: '/pagos', label: 'Pagos', icon: CreditCard, end: false },
  { to: '/perfil', label: 'Perfil', icon: UserCircle, end: false },
]

// Offered only to admins. This is NOT access control — the backend answers
// 403 either way; it just avoids offering a path that ends in an error.
const NAV_ITEMS_ADMIN = [
  { to: '/equipo', label: 'Equipo', icon: Users2, end: false },
] as const

function useIsActive() {
  const location = useLocation()
  return (to: string, end: boolean) => (end ? location.pathname === to : location.pathname.startsWith(to))
}

function UserAvatar({ initial }: { initial: string }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-50 text-[13px] font-bold text-violet-500">
      {initial}
    </span>
  )
}

function LogoMark() {
  return (
    <span
      aria-hidden="true"
      className="h-7 w-7 shrink-0 rounded-full"
      style={{ background: 'linear-gradient(135deg,#7c3aed,#e0459b)' }}
    />
  )
}

export function AppLayout() {
  const isActive = useIsActive()
  const user = useAuthStore((s) => s.user)
  // Admins get one extra entry. The route itself and the API both still
  // enforce the privilege — this only decides what is offered.
  const navItems = user?.es_admin ? [...NAV_ITEMS, ...NAV_ITEMS_ADMIN] : NAV_ITEMS
  const logoutMutation = useLogout()
  const initial = user?.nombre?.charAt(0).toUpperCase() ?? 'U'

  return (
    <div className="flex min-h-[100dvh] flex-col bg-page font-inter lg:flex-row">
      {/* ── Desktop sidebar (>=lg) ──────────────────────────────────────── */}
      <aside className="hidden shrink-0 flex-col gap-7 border-r border-border-subtle bg-surface-alt px-4 py-7 lg:flex lg:w-[232px]">
        <div className="flex items-center gap-2.5 px-2">
          <LogoMark />
          <span className="text-[15px] font-bold tracking-tight text-ink">Finanzas</span>
        </div>

        <nav className="flex flex-col gap-0.5" aria-label="Navegación principal">
          {navItems.map(({ to, label, icon: Icon, end }) => {
            const active = isActive(to, end)
            return (
              <Link
                key={to}
                to={to}
                aria-current={active ? 'page' : undefined}
                className={`
                  flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm transition-colors duration-160 ease-[var(--ease-out)]
                  ${active ? 'bg-violet-50 font-semibold text-violet-900' : 'font-medium text-ink-soft-2 hover:bg-black/[0.03]'}
                `}
              >
                <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-violet-500' : 'text-ink-soft'}`} />
                {label}
              </Link>
            )
          })}
        </nav>

        <div className="mt-auto flex items-center gap-2 border-t border-border-subtle px-2 pt-4">
          <Link to="/perfil" className="flex min-w-0 flex-1 items-center gap-2.5">
            <UserAvatar initial={initial} />
            <span className="truncate text-sm font-medium text-ink-soft-2">
              {user?.nombre ?? 'Mi cuenta'}
            </span>
          </Link>
          <button
            type="button"
            onClick={() => logoutMutation.mutate()}
            aria-label="Cerrar sesión"
            className="rounded-lg p-2 text-ink-soft transition-colors hover:bg-black/[0.04] hover:text-danger"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* ── Mobile top bar (<lg) ────────────────────────────────────────── */}
      <header className="flex items-center justify-between border-b border-border-subtle bg-surface px-5 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <LogoMark />
          <span className="text-sm font-bold tracking-tight text-ink">Finanzas</span>
        </div>
        <Link to="/perfil" aria-label="Mi perfil">
          <UserAvatar initial={initial} />
        </Link>
      </header>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 overflow-y-auto p-4 pb-24 lg:p-10 lg:pb-10">
        <Outlet />
      </main>

      {/* ── Mobile bottom tab bar (<lg) ─────────────────────────────────── */}
      <nav
        aria-label="Navegación principal"
        className="fixed inset-x-0 bottom-0 z-30 flex justify-around border-t border-border-subtle bg-surface px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:hidden"
      >
        {navItems.map(({ to, label, icon: Icon, end }) => {
          const active = isActive(to, end)
          return (
            <Link
              key={to}
              to={to}
              aria-current={active ? 'page' : undefined}
              className="flex flex-col items-center gap-1 px-2 py-1"
            >
              <Icon className={`h-[18px] w-[18px] ${active ? 'text-violet-500' : 'text-ink-soft'}`} />
              <span className={`text-[10.5px] font-semibold ${active ? 'text-violet-900' : 'text-ink-soft'}`}>
                {label}
              </span>
            </Link>
          )
        })}
      </nav>
    </div>
  )
}

export default AppLayout
