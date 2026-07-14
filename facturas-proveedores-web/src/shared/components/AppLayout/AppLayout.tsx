/**
 * AppLayout — premium sidebar + header layout for authenticated pages.
 *
 * Architecture:
 *  - Fixed sidebar (desktop) / overlay drawer (mobile)
 *  - Top header with user menu + theme toggle
 *  - Main scrollable area
 *
 * Responsive:
 *  - >=1024px: sidebar always visible, main has left margin
 *  - <1024px: sidebar hidden, hamburger toggles overlay
 */
import { useState } from 'react'
import { Link, useLocation, Outlet } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  FileText,
  CreditCard,
  BarChart3,
  UserCircle,
  Menu,
  X,
  LogOut,
  Sun,
  Moon,
  ChevronDown,
} from 'lucide-react'
import { useAuthStore } from '@features/auth/store/authStore'
import { useLogout } from '@features/auth/api/authHooks'
import { useThemeStore } from '@app/theme/themeStore'
import { useUpdateTema } from '@app/theme/useUpdateTema'
import type { TemaPreferido } from '@shared/api/api'

const NAV_ITEMS = [
  { to: '/', label: 'Inicio', icon: LayoutDashboard },
  { to: '/proveedores', label: 'Proveedores', icon: Users },
  { to: '/facturas', label: 'Facturas', icon: FileText },
  { to: '/pagos', label: 'Pagos', icon: CreditCard },
  { to: '/proveedores', label: 'Cuenta corriente', icon: BarChart3 },
  { to: '/perfil', label: 'Perfil', icon: UserCircle },
]

function ThemeToggle() {
  const runtimeTema = useThemeStore((s) => s.tema)
  const updateTema = useUpdateTema()

  const next: TemaPreferido = runtimeTema === 'OSCURO' ? 'CLARO' : 'OSCURO'
  const isDark = runtimeTema === 'OSCURO'

  return (
    <button
      type="button"
      aria-label={isDark ? 'Cambiar a tema claro' : 'Cambiar a tema oscuro'}
      onClick={() => updateTema.mutate(next)}
      className="relative h-7 w-12 rounded-full bg-navy-200 transition-colors duration-300 ease-[var(--ease-out)] dark:bg-accent-700"
    >
      <span
        className="absolute top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-sm transition-all duration-300 ease-[var(--ease-drawer)]"
        style={{ left: isDark ? 'calc(100% - 1.625rem)' : '2px' }}
      >
        {isDark ? (
          <Moon className="h-3.5 w-3.5 text-navy-500" />
        ) : (
          <Sun className="h-3.5 w-3.5 text-navy-500" />
        )}
      </span>
    </button>
  )
}

function UserMenu() {
  const user = useAuthStore((s) => s.user)
  const logoutMutation = useLogout()
  const [open, setOpen] = useState(false)

  if (!user) return null

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full px-2 py-1 transition-colors hover:bg-black/[0.04] dark:hover:bg-white/[0.04]"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent-500 text-[11px] font-bold text-white">
          {user.nombre?.charAt(0).toUpperCase() ?? 'U'}
        </div>
        <span className="hidden text-sm font-medium text-navy-700 dark:text-zinc-300 md:inline">
          {user.nombre}
        </span>
        <ChevronDown className="h-3.5 w-3.5 text-navy-400 dark:text-zinc-500" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-[1rem] bg-card p-2 shadow-[0_8px_32px_rgba(0,0,0,0.12)] ring-1 ring-black/[0.04] dark:bg-card-dark dark:ring-white/10 animate-fade-in-up">
            <div className="px-3 py-2">
              <p className="text-sm font-semibold text-navy-800 dark:text-zinc-100">
                {user.nombre}
              </p>
              <p className="text-xs text-navy-400 dark:text-zinc-500">
                {user.email}
              </p>
            </div>
            <div className="my-1 h-px bg-black/[0.04] dark:bg-white/10" />
            <Link
              to="/perfil"
              onClick={() => setOpen(false)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-navy-700 transition-colors hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]"
            >
              <UserCircle className="h-4 w-4" />
              Mi perfil
            </Link>
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                logoutMutation.mutate()
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-danger transition-colors hover:bg-danger-bg dark:hover:bg-danger/10"
            >
              <LogOut className="h-4 w-4" />
              Cerrar sesión
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <div className="flex min-h-[100dvh]">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-black/[0.04] bg-card
          transition-transform duration-500 ease-[var(--ease-drawer)]
          dark:border-white/10 dark:bg-card-dark
          lg:translate-x-0 lg:static
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Brand */}
        <div className="flex h-16 items-center gap-3 px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy-500 text-white">
            <BarChart3 className="h-5 w-5" />
          </div>
          <span className="font-serif text-lg font-semibold tracking-tight text-navy-800 dark:text-zinc-100">
            Facturas
          </span>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden"
            aria-label="Cerrar menú"
          >
            <X className="h-5 w-5 text-navy-500 dark:text-zinc-400" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-4 py-4" aria-label="Navegación principal">
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.to)
              const Icon = item.icon
              return (
                <li key={item.to + item.label}>
                  <Link
                    to={item.to}
                    onClick={() => setSidebarOpen(false)}
                    className={`
                      flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 ease-[var(--ease-out)]
                      ${active
                        ? 'bg-navy-50 text-navy-700 shadow-[inset_0_1px_1px_rgba(255,255,255,0.8)] ring-1 ring-black/[0.04] dark:bg-navy-800/40 dark:text-zinc-100 dark:shadow-none dark:ring-white/10'
                        : 'text-navy-500 hover:bg-black/[0.03] hover:text-navy-700 dark:text-zinc-400 dark:hover:bg-white/[0.03] dark:hover:text-zinc-200'
                      }
                    `}
                  >
                    <Icon className={`h-[18px] w-[18px] ${active ? 'text-accent-500' : 'text-navy-400 dark:text-zinc-500'}`} />
                    {item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Footer brand */}
        <div className="px-6 py-4 text-[10px] uppercase tracking-[0.15em] text-navy-300 dark:text-zinc-600">
          v0.1.0
        </div>
      </aside>

      {/* Main area */}
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-black/[0.04] bg-cream/80 px-4 backdrop-blur-xl dark:border-white/10 dark:bg-espresso/80 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="rounded-lg p-2 text-navy-500 transition-colors hover:bg-black/[0.04] dark:text-zinc-400 dark:hover:bg-white/[0.04] lg:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="h-5 w-px bg-black/[0.06] dark:bg-white/10" />
            <UserMenu />
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}

export default AppLayout
