/**
 * ClientesPage — the customer list, "who owes me" (C-36, design.md D10).
 *
 * Renders `useClientes()` — the plain listing, the ONLY endpoint that
 * carries a balance (design.md D5) — sorted by balance descending by
 * default (largest debt first), toggleable to alphabetical. `Cliente.saldo`
 * is `string | null` on the wire (unlike `Proveedor.saldo: number`), so
 * ordering by it is a parse, not a bare comparison; a `null` sorts LAST,
 * never as `0` — "unknown" and "al día" are different facts.
 *
 * Never fetches a per-customer account: the backend computes every balance
 * in one aggregate query specifically so ordering by debt does not become
 * N+1 (design.md D10).
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpDown } from 'lucide-react'
import { useClientes } from './api/clientesHooks'
import { formatSaldo } from '@shared/utils/currency'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { Card } from '@shared/components/Card/Card'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import type { ClienteListItem } from '@shared/api/api'

type OrderBy = 'saldo' | 'nombre'

// Stable fallback for when the query has not resolved to an array yet — a
// module-level constant keeps `items` referentially stable across renders
// so the useMemo below does not invalidate every render (mirrors
// ProveedoresList's EMPTY_ITEMS).
const EMPTY_ITEMS: ClienteListItem[] = []

/** `null` → "unknown", never `0` — sorts after every parsed numeric saldo. */
function parseSaldo(value: string | null): number | null {
  if (value === null) return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

function saldoColorClass(saldo: number | null): string {
  if (saldo === null) return 'text-ink-soft'
  if (saldo > 0) return 'text-danger'
  if (saldo < 0) return 'text-success'
  return 'text-ink'
}

function sortClientes(items: ClienteListItem[], orderBy: OrderBy): ClienteListItem[] {
  const copy = [...items]
  if (orderBy === 'nombre') {
    return copy.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }
  // orderBy === 'saldo' — descending (largest debt first); null always last.
  return copy.sort((a, b) => {
    const sa = parseSaldo(a.saldo)
    const sb = parseSaldo(b.saldo)
    if (sa === null && sb === null) return 0
    if (sa === null) return 1
    if (sb === null) return -1
    return sb - sa
  })
}

export function ClientesPage() {
  const [orderBy, setOrderBy] = useState<OrderBy>('saldo')
  const { data, isLoading, isError } = useClientes()

  const items = Array.isArray(data) ? data : EMPTY_ITEMS
  const sorted = useMemo(() => sortClientes(items, orderBy), [items, orderBy])

  if (isLoading) {
    return <LoadingState label="Cargando clientes…" />
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-card-sm bg-danger-bg p-4 text-sm text-danger ring-1 ring-danger/10">
        Error al cargar los clientes.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Gestión" title="Clientes" />
      </div>

      {items.length > 0 && (
        <div className="flex items-center gap-2" role="group" aria-label="Ordenar por">
          <SortPill label="Saldo" active={orderBy === 'saldo'} onClick={() => setOrderBy('saldo')} />
          <SortPill label="Nombre" active={orderBy === 'nombre'} onClick={() => setOrderBy('nombre')} />
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState title="Sin clientes" description="No hay clientes cargados." />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => (
            <ClienteCard key={c.id} cliente={c} />
          ))}
        </div>
      )}
    </div>
  )
}

function SortPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 font-inter text-xs font-medium transition-all duration-200
        ${active ? 'bg-violet-500 text-white shadow-sm' : 'bg-page text-ink-soft-2 hover:bg-violet-50'}
      `}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  )
}

function ClienteCard({ cliente }: { cliente: ClienteListItem }) {
  const saldo = parseSaldo(cliente.saldo)
  const initial = cliente.nombre.charAt(0).toUpperCase()

  return (
    <Link to={`/clientes/${cliente.id}`} aria-label={cliente.nombre}>
      <Card noPadding className="flex flex-col gap-4 p-[18px]">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-chip bg-violet-50 text-[13px] font-bold text-violet-500">
            {initial}
          </span>
          <span
            data-testid={`cliente-nombre-${cliente.id}`}
            className="truncate font-inter text-sm font-semibold text-ink"
          >
            {cliente.nombre}
          </span>
        </div>

        <div>
          <p className="font-inter text-[10.5px] font-semibold uppercase tracking-[0.03em] text-ink-soft">
            Saldo
          </p>
          <p className={`mt-0.5 font-inter text-base font-bold ${saldoColorClass(saldo)}`}>
            {saldo === null ? '—' : formatSaldo(saldo)}
          </p>
        </div>
      </Card>
    </Link>
  )
}

export default ClientesPage
