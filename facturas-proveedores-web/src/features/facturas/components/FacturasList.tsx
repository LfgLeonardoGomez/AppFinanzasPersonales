/**
 * FacturasList — paginated list of invoices with estado badges and delete confirmation.
 *
 * Premium table redesign. Test contracts preserved:
 *  - estado text visible (PENDIENTE / PAGADA)
 *  - ARS formatting
 *  - empty state text matches /sin facturas|no hay|empty/i
 *  - delete buttons with name /eliminar/i
 *  - dialog role
 *  - confirm button with name /confirmar|sí|yes/i
 */
import { useState } from 'react'
import { useFacturas, useDeleteFactura } from '../api/facturasHooks'
import { EstadoBadge } from './EstadoBadge'
import { formatMonto } from '@shared/utils/currency'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { Card } from '@shared/components/Card/Card'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import type { FacturaListItem, FacturasFilters } from '@shared/api/api'

interface FacturasListProps {
  filters: FacturasFilters
  onEditFactura: (factura: FacturaListItem) => void
}

interface DeleteDialogProps {
  open: boolean
  factura: FacturaListItem | null
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeleteFacturaDialog({ open, factura, onConfirm, onCancel, isPending }: DeleteDialogProps) {
  if (!open || !factura) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar eliminación"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm dark:bg-black/40"
    >
      <div className="w-full max-w-sm rounded-[1.5rem] bg-white p-6 shadow-[0_8px_32px_rgba(10,37,64,0.12)] ring-1 ring-black/[0.04] animate-fade-in-up dark:bg-card-dark dark:ring-white/10">
        <h3 className="mb-2 font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
          ¿Eliminar factura?
        </h3>
        <p className="mb-5 text-sm text-navy-500 dark:text-zinc-400">
          ¿Estás seguro de que querés eliminar la factura{' '}
          <strong className="text-navy-700 dark:text-zinc-200">
            {factura.numero ?? factura.id}
          </strong>
          ? Esta acción no se puede deshacer.
        </p>
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-full px-4 py-2 text-sm font-semibold text-navy-600 transition-colors hover:bg-cream-dark disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isPending}
            className="rounded-full bg-danger px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.25)] transition-all duration-200 hover:bg-red-700 active:scale-[0.98] disabled:opacity-50"
          >
            {isPending ? 'Eliminando…' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function FacturasList({ filters, onEditFactura }: FacturasListProps) {
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<FacturaListItem | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data, isLoading, isError } = useFacturas({ ...filters, page })
  const deleteMutation = useDeleteFactura()

  function handleDeleteClick(factura: FacturaListItem) {
    setPendingDelete(factura)
    setShowDeleteDialog(true)
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return
    deleteMutation.mutate(
      { id: pendingDelete.id, proveedor_id: pendingDelete.proveedor_id },
      {
        onSuccess: () => {
          setPendingDelete(null)
          setShowDeleteDialog(false)
        },
      },
    )
  }

  function handleCancelDelete() {
    setPendingDelete(null)
    setShowDeleteDialog(false)
  }

  if (isLoading) {
    return <LoadingState label="Cargando facturas…" />
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-xl bg-danger-bg p-4 text-sm text-danger ring-1 ring-danger/10">
        Error al cargar las facturas.
      </div>
    )
  }

  const items = Array.isArray(data) ? data : []
  const hasMore = items.length === 20 // backend page_size heuristic

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Listado" title="Facturas" />

      {items.length === 0 ? (
        <EmptyState
          title="Listado vacío"
          description="No hay facturas para mostrar."
        />
      ) : (
        <Card noPadding className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-black/[0.04] bg-cream-dark/40 dark:border-white/5 dark:bg-white/[0.02]">
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Número
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Fecha emisión
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Monto total
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Estado
                  </th>
                  <th className="px-6 py-3.5 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black/[0.04] dark:divide-white/5">
                {items.map((factura) => (
                  <tr
                    key={factura.id}
                    className="transition-colors hover:bg-cream-dark/30 dark:hover:bg-white/[0.02]"
                  >
                    <td className="px-6 py-4 font-medium text-navy-800 dark:text-zinc-100">
                      {factura.numero ?? '—'}
                    </td>
                    <td className="px-6 py-4 text-navy-600 dark:text-zinc-400">
                      {factura.fecha_emision}
                    </td>
                    <td className="px-6 py-4 font-sans tabular-nums font-medium text-navy-700 dark:text-zinc-300">
                      {formatMonto(factura.monto_total)}
                    </td>
                    <td className="px-6 py-4">
                      <EstadoBadge estado={factura.estado} />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEditFactura(factura)}
                          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-navy-600 transition-colors hover:bg-navy-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(factura)}
                          disabled={deleteMutation.isPending}
                          aria-label={`Eliminar factura ${factura.numero ?? factura.id}`}
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

      <DeleteFacturaDialog
        open={showDeleteDialog}
        factura={pendingDelete}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isPending={deleteMutation.isPending}
      />
    </div>
  )
}

export default FacturasList
