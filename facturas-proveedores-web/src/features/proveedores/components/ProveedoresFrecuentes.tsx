/**
 * ProveedoresFrecuentes — panel of the suppliers with the most debt.
 *
 * Relocated from `HomePage.tsx` (C-44, D2) into `features/proveedores/`,
 * where it now has context. Consumes `useProveedores({ orderBy: 'saldo' })`
 * — this feature's OWN hook — and cuts to 6 in the component; there is no
 * second HTTP client against `/proveedores` (spec `proveedores-frontend`).
 *
 * `formatSaldo` and `saldoColorClass` are the SAME ones `ProveedoresList`
 * uses (D4): the two panels share `/proveedores`, and a supplier's saldo
 * cannot read as debt in one panel and credit in the other.
 */
import { Link } from 'react-router-dom'
import { FileText, CreditCard } from 'lucide-react'
import { useProveedores } from '../api/proveedoresHooks'
import { saldoColorClass } from './saldoColorClass'
import { formatSaldo } from '@shared/utils/currency'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import type { ProveedorListItem } from '@shared/api/api'

const LIMIT = 6

export function ProveedoresFrecuentes() {
  const { data, isLoading } = useProveedores({ orderBy: 'saldo' })
  const frecuentes = (data ?? []).slice(0, LIMIT)

  if (isLoading) {
    return <LoadingState label="Cargando proveedores frecuentes…" />
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-soft">
        Proveedores frecuentes
      </h2>
      {frecuentes.length === 0 ? (
        <EmptyState title="Sin proveedores" description="Todavía no cargaste proveedores." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {frecuentes.map((p) => (
            <ProveedorFrecuenteCard key={p.id} proveedor={p} />
          ))}
        </div>
      )}
    </section>
  )
}

function ProveedorFrecuenteCard({ proveedor }: { proveedor: ProveedorListItem }) {
  return (
    <div
      data-testid={`proveedor-frecuente-${proveedor.id}`}
      className="flex flex-col gap-3 rounded-card border border-border-subtle bg-surface p-5 shadow-card"
    >
      <div>
        <p className="truncate font-semibold text-ink">{proveedor.nombre}</p>
        <p className="mt-0.5 text-xs text-ink-soft">
          {proveedor.ultima_factura_fecha
            ? `Última factura: ${proveedor.ultima_factura_fecha}`
            : 'Sin facturas'}
        </p>
      </div>
      <p className={`text-lg font-bold ${saldoColorClass(proveedor.saldo)}`}>
        {formatSaldo(proveedor.saldo)}
      </p>
      <div className="flex gap-2">
        <Link
          to={`/facturas/nueva?proveedor_id=${proveedor.id}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-violet-50 px-3 py-2 text-xs font-semibold text-violet-600 hover:bg-violet-100"
        >
          <FileText className="h-3.5 w-3.5" />
          Factura
        </Link>
        <Link
          to={`/pagos/nuevo?proveedor_id=${proveedor.id}`}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-pill bg-magenta-50 px-3 py-2 text-xs font-semibold text-magenta-900 hover:opacity-80"
        >
          <CreditCard className="h-3.5 w-3.5" />
          Pago
        </Link>
      </div>
    </div>
  )
}

export default ProveedoresFrecuentes
