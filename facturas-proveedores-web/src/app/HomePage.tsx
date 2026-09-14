/**
 * HomePage — surface of ACTION, not a dashboard (C-44, spec
 * `home-y-navegacion`, design.md D1).
 *
 * The app is a shop-counter sales system: the operation that generates
 * revenue is the sale, not the supplier bookkeeping. The home offers
 * exactly two actions — "Vender ahora" (primary, → /ventas/nueva) and
 * "Cargar con IA" (secondary, unchanged destination) — and NOTHING ELSE:
 * no totals, no counters, no charts, no movement lists, no API requests.
 *
 * "Proveedores frecuentes" and "Actividad reciente" moved to `/proveedores`
 * (task groups 4-5), where they have context. Replicating them — or any
 * other data — here would repeat the exact mistake that demoted
 * Estadísticas in the navigation: showing information the user already
 * sees somewhere else.
 *
 * Renders inside AppLayout (sidebar/bottom-tab live there), so this is only
 * the main content column.
 */
import { Link, useNavigate } from 'react-router-dom'
import { Sparkles, ImageUp, Pencil, ShoppingCart } from 'lucide-react'
import { useAuthStore } from '@features/auth/store/authStore'

const IA_GRADIENT = 'linear-gradient(135deg, #7c3aed 0%, #9333ea 55%, #d6409f 100%)'

export function HomePage() {
  const user = useAuthStore((s) => s.user)
  const firstName = user?.nombre?.split(' ')[0] ?? ''
  const navigate = useNavigate()

  const abrirCarga = () => navigate('/facturas/nueva')

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-10 font-inter text-ink">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-ink">
          {firstName ? `Hola, ${firstName}` : 'Hola'}
        </h1>
        <p className="mt-1 text-sm text-ink-soft">¿Qué querés registrar hoy?</p>
      </header>

      {/* Vender ahora — primary action, first in DOM order (spec
          `home-y-navegacion`, "La acción de venta es la primera del
          contenido principal"). */}
      <Link
        to="/ventas/nueva"
        className="inline-flex items-center justify-center gap-2 rounded-card bg-violet-600 px-6 py-4 text-base font-semibold text-white shadow-card transition-transform active:scale-[0.98] hover:bg-violet-700"
      >
        <ShoppingCart className="h-5 w-5" />
        Vender ahora
      </Link>

      {/* Cargar con IA — secondary action, conserved (spec
          `home-y-navegacion`). */}
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
    </div>
  )
}

export default HomePage
