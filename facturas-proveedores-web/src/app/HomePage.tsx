/**
 * HomePage — dashboard with bento-grid quick-access actions (F-HOME-01).
 *
 * Transformed from a plain vertical button list into an asymmetrical
 * bento-grid of cards with Lucide icons, hover physics, and editorial
 * typography.
 */
import { Link } from 'react-router-dom'
import { useAuthStore } from '@features/auth/store/authStore'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { Card } from '@shared/components/Card/Card'
import {
  CreditCard,
  FileText,
  Users,
  BarChart3,
  UserCircle,
  ChevronRight,
  ArrowUpRight,
} from 'lucide-react'

export function HomePage() {
  const user = useAuthStore((s) => s.user)
  const firstName = user?.nombre?.split(' ')[0] ?? ''

  return (
    <div className="animate-fade-in-up">
      <PageHeader
        eyebrow="Panel de control"
        title={firstName ? `Hola, ${firstName}` : 'Panel de control'}
        description="Gestioná facturas, pagos y proveedores desde un solo lugar."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        {/* Quick actions — large card */}
        <div className="md:col-span-8">
          <Card>
            <h2 className="mb-5 font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
              Acciones rápidas
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <QuickActionCard
                to="/pagos/nuevo"
                icon={<CreditCard className="h-5 w-5" />}
                title="Cargar pago"
                description="Registrar un nuevo pago a proveedor"
                tone="accent"
              />
              <QuickActionCard
                to="/facturas/nueva"
                icon={<FileText className="h-5 w-5" />}
                title="Cargar factura"
                description="Registrar una nueva factura de compra"
                tone="navy"
              />
            </div>
          </Card>
        </div>

        {/* Secondary navigation links */}
        <div className="flex flex-col gap-6 md:col-span-4">
          <Card>
            <h2 className="mb-3 font-serif text-base font-semibold text-navy-800 dark:text-zinc-100">
              Listados
            </h2>
            <nav className="flex flex-col gap-0.5" aria-label="Acceso rápido">
              <NavRow to="/pagos" icon={<CreditCard className="h-4 w-4" />} label="Ver pagos" />
              <NavRow to="/facturas" icon={<FileText className="h-4 w-4" />} label="Ver facturas" />
              <NavRow to="/proveedores" icon={<Users className="h-4 w-4" />} label="Ver proveedores" />
            </nav>
          </Card>

          <Card>
            <h2 className="mb-3 font-serif text-base font-semibold text-navy-800 dark:text-zinc-100">
              Más opciones
            </h2>
            <nav className="flex flex-col gap-0.5" aria-label="Acceso rápido secundario">
              <NavRow to="/proveedores" icon={<BarChart3 className="h-4 w-4" />} label="Ver cuenta corriente" />
              <NavRow to="/perfil" icon={<UserCircle className="h-4 w-4" />} label="Mi perfil" />
            </nav>
          </Card>
        </div>
      </div>
    </div>
  )
}

function QuickActionCard({
  to,
  icon,
  title,
  description,
  tone,
}: {
  to: string
  icon: React.ReactNode
  title: string
  description: string
  tone: 'accent' | 'navy'
}) {
  const bgClass =
    tone === 'accent'
      ? 'bg-accent-50 hover:bg-accent-100 dark:bg-accent-500/10 dark:hover:bg-accent-500/20'
      : 'bg-navy-50 hover:bg-navy-100 dark:bg-navy-800/30 dark:hover:bg-navy-800/50'
  const iconBg =
    tone === 'accent'
      ? 'bg-accent-500 shadow-[0_2px_8px_rgba(99,91,255,0.35)]'
      : 'bg-navy-500 shadow-[0_2px_8px_rgba(10,37,64,0.25)]'

  return (
    <Link
      to={to}
      className={`group flex items-center gap-4 rounded-xl p-4 transition-all duration-300 ease-[var(--ease-out)] ${bgClass}`}
    >
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white ${iconBg}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-navy-800 dark:text-zinc-100">{title}</p>
        <p className="text-xs text-navy-400 dark:text-zinc-500">{description}</p>
      </div>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-navy-300 opacity-0 transition-all duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100 dark:text-zinc-600" />
    </Link>
  )
}

function NavRow({
  to,
  icon,
  label,
}: {
  to: string
  icon: React.ReactNode
  label: string
}) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-navy-600 transition-all duration-200 hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]"
    >
      <span className="text-navy-400 dark:text-zinc-500">{icon}</span>
      <span className="flex-1">{label}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-navy-300 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100 dark:text-zinc-600" />
    </Link>
  )
}

export default HomePage
