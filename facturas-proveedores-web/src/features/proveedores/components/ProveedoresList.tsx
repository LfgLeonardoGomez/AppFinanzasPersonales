/**
 * ProveedoresList — low-density card grid of suppliers (redesign:
 * design/screen-proveedores — "Listado Proveedores" handoff).
 *
 * LAYOUT.md: outside of the cuenta-corriente ledger, the app never shows
 * tables — cards and simple lists only. This replaces the previous
 * premium-table layout with a grid of cards (search on top, saldo +
 * quick actions per card), matching the Claude Design handoff.
 *
 * All original test contracts preserved (button/link names, dialog roles,
 * empty-state copy, "Ver cuenta corriente" href per row).
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useProveedores, useDeleteProveedor } from '../api/proveedoresHooks'
import { DeleteProveedorDialog } from './DeleteProveedorDialog'
import { formatSaldo } from '@shared/utils/currency'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { Pencil, Trash2, ArrowUpDown, ChevronLeft, ChevronRight, Search } from 'lucide-react'
import type { Proveedor, ProveedorListItem } from '@shared/api/api'

type OrderBy = 'nombre' | 'saldo'

interface ProveedoresListProps {
  onNewProveedor: () => void
  onEditProveedor: (proveedor: ProveedorListItem) => void
}

function matchesSearch(p: ProveedorListItem, term: string): boolean {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  return (
    p.nombre.toLowerCase().includes(needle) ||
    Boolean(p.cuit?.toLowerCase().includes(needle))
  )
}

function saldoColorClass(saldo: number): string {
  if (saldo > 0) return 'text-danger'
  if (saldo < 0) return 'text-success'
  return 'text-ink'
}

export function ProveedoresList({ onNewProveedor, onEditProveedor }: ProveedoresListProps) {
  const [orderBy, setOrderBy] = useState<OrderBy>('nombre')
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')

  const [pendingDelete, setPendingDelete] = useState<Proveedor | null>(null)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)

  const { data, isLoading, isError } = useProveedores({ orderBy, page })
  const deleteMutation = useDeleteProveedor()

  function handleDeleteClick(proveedor: ProveedorListItem) {
    setPendingDelete(proveedor)
    setShowConfirmDialog(true)
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return
    deleteMutation.mutate(pendingDelete.id, {
      onSuccess: () => {
        setPendingDelete(null)
        setShowConfirmDialog(false)
      },
    })
  }

  function handleCancelDelete() {
    setPendingDelete(null)
    setShowConfirmDialog(false)
  }

  const items = Array.isArray(data) ? data : []
  const filteredItems = useMemo(
    () => items.filter((p) => matchesSearch(p, search)),
    [items, search],
  )
  const hasMore = items.length === 20 // backend page_size heuristic

  if (isLoading) {
    return <LoadingState label="Cargando proveedores…" />
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-card-sm bg-danger-bg p-4 text-sm text-danger ring-1 ring-danger/10">
        Error al cargar los proveedores.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Gestión" title="Proveedores" />
        <Button onClick={onNewProveedor}>+ Nuevo proveedor</Button>
      </div>

      {/* Search + sort row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative flex w-full items-center gap-2 rounded-card-sm border border-border-subtle bg-surface px-4 py-1 sm:max-w-sm">
          <Search className="h-4 w-4 shrink-0 text-ink-soft" aria-hidden="true" />
          <span className="sr-only">Buscar proveedor</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar proveedor por nombre o CUIT"
            className="w-full border-none bg-transparent py-2.5 text-sm text-ink placeholder:text-ink-soft focus:outline-none"
          />
        </label>

        <div className="flex items-center gap-2" role="group" aria-label="Ordenar por">
          <SortPill
            label="Nombre"
            active={orderBy === 'nombre'}
            onClick={() => { setOrderBy('nombre'); setPage(1) }}
          />
          <SortPill
            label="Saldo"
            active={orderBy === 'saldo'}
            onClick={() => { setOrderBy('saldo'); setPage(1) }}
          />
        </div>
      </div>

      {/* Grid */}
      {items.length === 0 ? (
        <EmptyState
          title="Sin proveedores"
          description="No hay proveedores cargados."
        />
      ) : filteredItems.length === 0 ? (
        <EmptyState
          title="Sin resultados"
          description="Ningún proveedor coincide con la búsqueda."
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredItems.map((p) => (
            <ProveedorCard
              key={p.id}
              proveedor={p}
              onEdit={() => onEditProveedor(p)}
              onDelete={() => handleDeleteClick(p)}
              deleting={deleteMutation.isPending}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft-2 transition-colors hover:bg-page disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <span className="text-sm text-ink-soft">
            Página {page}
          </span>
          <button
            type="button"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft-2 transition-colors hover:bg-page disabled:opacity-40"
          >
            Siguiente
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}

      <DeleteProveedorDialog
        open={showConfirmDialog}
        proveedor={pendingDelete}
        hasDependencies={false}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
      />
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
        ${active
          ? 'bg-violet-500 text-white shadow-sm'
          : 'bg-page text-ink-soft-2 hover:bg-violet-50'
        }
      `}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  )
}

interface ProveedorCardProps {
  proveedor: ProveedorListItem
  onEdit: () => void
  onDelete: () => void
  deleting: boolean
}

function ProveedorCard({ proveedor, onEdit, onDelete, deleting }: ProveedorCardProps) {
  const initial = proveedor.nombre.charAt(0).toUpperCase()

  return (
    <Card noPadding className="flex flex-col gap-4 p-[18px]">
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/proveedores/${proveedor.id}`}
          aria-label="Ver cuenta corriente"
          className="flex min-w-0 items-center gap-2.5"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-chip bg-violet-50 text-[13px] font-bold text-violet-500">
            {initial}
          </span>
          <span className="min-w-0">
            <span className="block truncate font-inter text-sm font-semibold text-ink">
              {proveedor.nombre}
            </span>
            {proveedor.cuit && (
              <span className="block truncate font-inter text-[11.5px] text-ink-soft">
                {proveedor.cuit}
              </span>
            )}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onEdit}
            className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-violet-50 hover:text-violet-900"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Editar</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-danger-bg hover:text-danger"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Eliminar</span>
          </button>
        </div>
      </div>

      <div>
        <p className="font-inter text-[10.5px] font-semibold uppercase tracking-[0.03em] text-ink-soft">
          Saldo
        </p>
        <p className={`mt-0.5 font-inter text-base font-bold ${saldoColorClass(proveedor.saldo)}`}>
          {formatSaldo(proveedor.saldo)}
        </p>
      </div>

      {/* TODO(carga-unificada): once the unified IA/manual carga modal (C-21)
          lands, these should open it pre-set to tipo=factura|pago and
          proveedor_id={proveedor.id} instead of navigating away. */}
      <div className="flex gap-2">
        <Link
          to={`/facturas/nueva?proveedor_id=${proveedor.id}`}
          className="flex-1 rounded-pill border border-border-violet-soft bg-surface-soft px-0 py-2 text-center font-inter text-xs font-semibold text-violet-900 transition-colors hover:bg-violet-50"
        >
          Factura
        </Link>
        <Link
          to={`/pagos/nuevo?proveedor_id=${proveedor.id}`}
          className="flex-1 rounded-pill border border-border-violet-soft bg-surface-soft px-0 py-2 text-center font-inter text-xs font-semibold text-violet-900 transition-colors hover:bg-violet-50"
        >
          Pago
        </Link>
      </div>
    </Card>
  )
}

export default ProveedoresList
