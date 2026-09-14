/**
 * ActividadReciente — recent-activity panel (mixed facturas + pagos feed).
 *
 * Relocated from `HomePage.tsx` (C-44, D2) into `features/proveedores/`,
 * where it now has context. Fetches its own data via `useActividadReciente`
 * — no data is passed down from `ProveedoresPage` (D2: a dataset with a
 * single consumer belongs to that consumer's feature, not to a shared
 * layer).
 *
 * Rows render in the order the backend returns them — never re-sorted
 * (spec `proveedores-frontend`, "El panel de actividad reciente"). A row
 * whose `proveedor_nombre` is `null` (a deactivated supplier) still renders
 * — it is not omitted.
 */
import { ArrowUpRight } from 'lucide-react'
import { useActividadReciente } from '../api/actividadRecienteHooks'
import { relativeTime } from './relativeTime'
import { formatMonto } from '@shared/utils/currency'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import type { ActividadRecienteItem } from '@shared/api/api'

export function ActividadReciente() {
  const { data: actividad = [], isLoading } = useActividadReciente()

  if (isLoading) {
    return <LoadingState label="Cargando actividad reciente…" />
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
        Actividad reciente
      </h2>
      {actividad.length === 0 ? (
        <EmptyState title="Sin movimientos" description="Sin movimientos recientes." />
      ) : (
        <ul className="flex flex-col divide-y divide-border-subtle rounded-card border border-border-subtle bg-surface">
          {actividad.map((item) => (
            <ActividadRow key={`${item.tipo}-${item.id}`} item={item} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ActividadRow({ item }: { item: ActividadRecienteItem }) {
  const isFactura = item.tipo === 'factura'
  const tipoLabel = isFactura ? 'Factura' : 'Pago'
  const label = item.proveedor_nombre ? `${tipoLabel} · ${item.proveedor_nombre}` : tipoLabel
  const montoLabel = isFactura ? formatMonto(item.monto) : `- ${formatMonto(item.monto)}`

  return (
    <li
      data-testid={`actividad-row-${item.id}`}
      className="flex items-center gap-3 px-5 py-3.5"
    >
      <span
        className={`h-2 w-2 shrink-0 rounded-full ${isFactura ? 'bg-violet-500' : 'bg-magenta-500'}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{label}</p>
        <p className="text-xs text-ink-soft">{relativeTime(item.created_at)}</p>
      </div>
      <span className={`shrink-0 text-sm font-semibold ${isFactura ? 'text-ink' : 'text-emerald-600'}`}>
        {montoLabel}
      </span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden />
    </li>
  )
}

export default ActividadReciente
