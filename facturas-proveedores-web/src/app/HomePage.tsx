/**
 * HomePage — redesigned entry point (specs/design/HOME.md).
 *
 * NOT a dashboard. A calm entry point: greeting + AI-carga hero (the
 * protagonist) + proveedores frecuentes + actividad reciente. No metrics,
 * no tables (LAYOUT.md / UX_PRINCIPLES.md Regla 4 & 11).
 *
 * Renders inside AppLayout (sidebar/bottom-tab live there), so this is only
 * the main content column.
 */
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, ImageUp, Pencil, FileText, CreditCard, ArrowUpRight } from 'lucide-react'
import { useAuthStore } from '@features/auth/store/authStore'
import { useProveedoresFrecuentes, useActividadReciente } from '@features/home/api/homeHooks'
import type { ProveedorFrecuente, ActividadRecienteItem } from '@features/home/api/homeApi'

const IA_GRADIENT = 'linear-gradient(135deg, #7c3aed 0%, #9333ea 55%, #d6409f 100%)'

function formatARS(value: string | number): string {
  const n = typeof value === 'string' ? Number(value) : value
  return new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 2,
  }).format(Number.isFinite(n) ? n : 0)
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'recién'
  if (min < 60) return `hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `hace ${h} h`
  const d = Math.floor(h / 24)
  if (d < 30) return `hace ${d} d`
  const mo = Math.floor(d / 30)
  return `hace ${mo} mes${mo > 1 ? 'es' : ''}`
}

export function HomePage() {
  const user = useAuthStore((s) => s.user)
  const firstName = user?.nombre?.split(' ')[0] ?? ''
  const navigate = useNavigate()

  const { data: frecuentes = [] } = useProveedoresFrecuentes()
  const { data: actividad = [] } = useActividadReciente()

  // TODO(redesign): replace navigation with the unified carga modal once it lands.
  const abrirCarga = () => navigate('/facturas/nueva')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 font-inter text-ink">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {firstName ? `Hola, ${firstName}` : 'Hola'}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">¿Qué querés registrar hoy?</p>
      </header>

      {/* IA carga — protagonist */}
      <section
        className="relative overflow-hidden rounded-card p-7 text-white shadow-ia"
        style={{ background: IA_GRADIENT }}
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-chip bg-white/15 backdrop-blur">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Cargar con IA</h2>
            <p className="mt-1 max-w-md text-sm text-white/85">
              Subí una imagen de la factura o el comprobante. La IA lee los datos y
              vos solo confirmás.
            </p>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={abrirCarga}
            className="inline-flex items-center gap-2 rounded-pill bg-white px-5 py-2.5 text-sm font-semibold text-violet-600 transition-transform active:scale-[0.98]"
          >
            <ImageUp className="h-4 w-4" />
            Subir imagen
          </button>
          <button
            type="button"
            onClick={abrirCarga}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-white/90 hover:text-white"
          >
            <Pencil className="h-3.5 w-3.5" />
            Cargar manual
          </button>
        </div>
      </section>

      {/* Proveedores frecuentes */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
            Proveedores frecuentes
          </h2>
          <Link to="/proveedores" className="text-sm font-medium text-violet-600 hover:text-violet-900">
            Ver todos
          </Link>
        </div>
        {frecuentes.length === 0 ? (
          <p className="rounded-card border border-border-subtle bg-surface p-6 text-sm text-ink-soft">
            Todavía no cargaste proveedores.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {frecuentes.map((p) => (
              <ProveedorFrecuenteCard key={p.id} proveedor={p} />
            ))}
          </div>
        )}
      </section>

      {/* Actividad reciente */}
      <section className="flex flex-col gap-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
          Actividad reciente
        </h2>
        {actividad.length === 0 ? (
          <p className="rounded-card border border-border-subtle bg-surface p-6 text-sm text-ink-soft">
            Sin movimientos recientes.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-card border border-border-subtle bg-surface">
            {actividad.map((item) => (
              <ActividadRow key={`${item.tipo}-${item.id}`} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function ProveedorFrecuenteCard({ proveedor }: { proveedor: ProveedorFrecuente }) {
  const saldo = Number(proveedor.saldo)
  const hasDebt = saldo > 0
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5 shadow-card">
      <div>
        <p className="truncate font-semibold text-ink">{proveedor.nombre}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {proveedor.ultima_factura_fecha
            ? `Última factura: ${proveedor.ultima_factura_fecha}`
            : 'Sin facturas'}
        </p>
      </div>
      <p className={`text-lg font-bold ${hasDebt ? 'text-red-600' : 'text-ink'}`}>
        {formatARS(saldo)}
      </p>
      <div className="flex gap-2">
        <Link
          to="/facturas/nueva"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-600 hover:bg-violet-100"
        >
          <FileText className="h-3.5 w-3.5" />
          Factura
        </Link>
        <Link
          to="/pagos/nuevo"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-magenta-50 px-3 py-2 text-xs font-semibold text-magenta-900 hover:opacity-80"
        >
          <CreditCard className="h-3.5 w-3.5" />
          Pago
        </Link>
      </div>
    </div>
  )
}

function ActividadRow({ item }: { item: ActividadRecienteItem }) {
  const isFactura = item.tipo === 'factura'
  return (
    <li className="flex items-center gap-3 px-5 py-3.5">
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${isFactura ? 'bg-violet-500' : 'bg-magenta-500'}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {isFactura ? 'Factura' : 'Pago'}
          {item.proveedor_nombre ? ` · ${item.proveedor_nombre}` : ''}
        </p>
        <p className="text-xs text-ink-soft">{relativeTime(item.created_at)}</p>
      </div>
      <span className={`shrink-0 text-sm font-semibold ${isFactura ? 'text-ink' : 'text-emerald-600'}`}>
        {isFactura ? '' : '- '}
        {formatARS(item.monto)}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
    </li>
  )
}

export default HomePage
