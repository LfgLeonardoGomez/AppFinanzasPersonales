/**
 * ProveedoresList — paginated, sortable list of suppliers.
 *
 * Redesigned with premium table styling, category badges, and icon actions.
 * All original test contracts preserved (button/link names, dialog roles).
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useProveedores, useDeleteProveedor } from '../api/proveedoresHooks'
import { DeleteProveedorDialog } from './DeleteProveedorDialog'
import { formatSaldo } from '@shared/utils/currency'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { Card } from '@shared/components/Card/Card'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { Pencil, Trash2, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react'
import type { Proveedor, ProveedorListItem } from '@shared/api/api'

type OrderBy = 'nombre' | 'saldo'

interface ProveedoresListProps {
  onNewProveedor: () => void
  onEditProveedor: (proveedor: ProveedorListItem) => void
}

export function ProveedoresList({ onNewProveedor, onEditProveedor }: ProveedoresListProps) {
  const [orderBy, setOrderBy] = useState<OrderBy>('nombre')
  const [page, setPage] = useState(1)

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

  if (isLoading) {
    return <LoadingState label="Cargando proveedores…" />
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-xl bg-danger-bg p-4 text-sm text-danger ring-1 ring-danger/10">
        Error al cargar los proveedores.
      </div>
    )
  }

  const items = Array.isArray(data) ? data : []
  const hasMore = items.length === 20 // backend page_size heuristic

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader eyebrow="Gestión" title="Proveedores" />
        <button
          type="button"
          onClick={onNewProveedor}
          className="inline-flex items-center gap-2 rounded-full bg-navy-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] dark:bg-accent-500 dark:hover:bg-accent-600"
        >
          Nuevo proveedor
        </button>
      </div>

      {/* Sort controls */}
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

      {/* List */}
      {items.length === 0 ? (
        <EmptyState
          title="Sin proveedores"
          description="No hay proveedores cargados."
        />
      ) : (
        <Card noPadding className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/[0.04] bg-cream-dark/40 dark:border-white/5 dark:bg-white/[0.02]">
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Nombre
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Categoría
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Saldo
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/5">
                {items.map((p) => (
                  <tr
                    key={p.id}
                    className="transition-colors hover:bg-cream-dark/30 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-6 py-4 font-medium text-navy-800 dark:text-zinc-100">
                      {p.nombre}
                    </td>
                    <td className="px-6 py-4">
                      <CategoryBadge categoria={p.categoria} />
                    </td>
                    <td className="px-6 py-4 font-sans tabular-nums text-navy-700 dark:text-zinc-300">
                      {formatSaldo(p.saldo)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <Link
                          to={`/proveedores/${p.id}`}
                          className="text-xs font-medium text-navy-500 underline-offset-2 transition-colors hover:text-navy-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
                        >
                          Ver cuenta corriente
                        </Link>
                        <button
                          type="button"
                          onClick={() => onEditProveedor(p)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-600 transition-colors hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(p)}
                          disabled={deleteMutation.isPending}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger-bg dark:hover:bg-danger/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Pagination */}
      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-navy-600 transition-colors hover:bg-cream-dark disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <span className="text-sm text-navy-400 dark:text-zinc-500">
            Página {page}
          </span>
          <button
            type="button"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-navy-600 transition-colors hover:bg-cream-dark disabled:opacity-40 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
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
        inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all duration-200
        ${active
          ? 'bg-navy-500 text-white shadow-sm dark:bg-accent-500'
          : 'bg-cream-dark text-navy-600 hover:bg-navy-100 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08]'
        }
      `}
    >
      {label}
      <ArrowUpDown className="h-3 w-3 opacity-60" />
    </button>
  )
}

function CategoryBadge({ categoria }: { categoria: string }) {
  const isServicio = categoria === 'SERVICIO'
  return (
    <span
      className={`
        inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide
        ${isServicio
          ? 'bg-accent-50 text-accent-700 ring-1 ring-accent-200 dark:bg-accent-500/10 dark:text-accent-300 dark:ring-accent-500/20'
          : 'bg-navy-50 text-navy-600 ring-1 ring-navy-200 dark:bg-navy-800/30 dark:text-navy-300 dark:ring-navy-700/30'
        }
      `}
    >
      {categoria}
    </span>
  )
}

export default ProveedoresList
