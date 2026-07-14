/**
 * PagosList — paginated list of payments with PagoCard and delete confirmation.
 *
 * Premium card list redesign. Test contracts preserved:
 *  - MetodoBadge text visible (EFECTIVO / TRANSFERENCIA)
 *  - ARS formatting
 *  - empty state text matches /sin pagos|no hay|empty/i
 *  - delete buttons with name /eliminar/i
 *  - dialog role
 *  - confirm button with name /confirmar|sí|yes/i
 */
import { useState } from 'react'
import { usePagos, useDeletePago } from '../api/pagosHooks'
import { PagoCard } from './PagoCard'
import { PageHeader } from '@shared/components/PageHeader/PageHeader'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'

import type { PagoListItem, PagosFilters } from '@shared/api/api'

interface PagosListProps {
  filters: PagosFilters
  onEditPago: (pago: PagoListItem) => void
}

interface DeleteDialogProps {
  open: boolean
  pago: PagoListItem | null
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function DeletePagoDialog({ open, pago, onConfirm, onCancel, isPending }: DeleteDialogProps) {
  if (!open || !pago) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar eliminación"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm dark:bg-black/40"
    >
      <div className="w-full max-w-sm rounded-[1.5rem] bg-white p-6 shadow-[0_8px_32px_rgba(10,37,64,0.12)] ring-1 ring-black/[0.04] animate-fade-in-up dark:bg-card-dark dark:ring-white/10">
        <h3 className="mb-2 font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
          ¿Eliminar pago?
        </h3>
        <p className="mb-5 text-sm text-navy-500 dark:text-zinc-400">
          ¿Estás seguro de que querés eliminar este pago de{' '}
          <strong className="text-navy-700 dark:text-zinc-200">{pago.fecha}</strong>?
          Esta acción no se puede deshacer.
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

export function PagosList({ filters, onEditPago }: PagosListProps) {
  const [pendingDelete, setPendingDelete] = useState<PagoListItem | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const { data, isLoading, isError } = usePagos(filters)
  const deleteMutation = useDeletePago()

  function handleDeleteClick(pago: PagoListItem) {
    setPendingDelete(pago)
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
    return <LoadingState label="Cargando pagos…" />
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-xl bg-danger-bg p-4 text-sm text-danger ring-1 ring-danger/10">
        Error al cargar los pagos.
      </div>
    )
  }

  const items = data?.items ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Listado" title="Pagos" />

      {items.length === 0 ? (
        <EmptyState
          title="Listado vacío"
          description="No hay pagos para mostrar."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((pago) => (
            <li key={pago.id}>
              <PagoCard
                pago={pago}
                onEdit={onEditPago}
                onDelete={handleDeleteClick}
              />
            </li>
          ))}
        </ul>
      )}

      <DeletePagoDialog
        open={showDeleteDialog}
        pago={pendingDelete}
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        isPending={deleteMutation.isPending}
      />
    </div>
  )
}

export default PagosList
