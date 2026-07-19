/**
 * PagosList — paginated list of payments with PagoCard rows and delete confirmation.
 *
 * Redesigned to the new design system: a low-density row list inside a
 * single Card (mirrors FacturasList), never a grid of tiles.
 * Test contracts preserved:
 *  - MetodoBadge text visible (EFECTIVO / TRANSFERENCIA)
 *  - ARS formatting
 *  - empty state text matches /sin pagos|no hay|empty/i
 *  - delete buttons with name /eliminar/i
 *  - dialog role
 *  - confirm button with name /confirmar|sí|yes/i
 */
import { useMemo, useState } from 'react'
import { usePagos, useDeletePago } from '../api/pagosHooks'
import { useProveedores } from '@features/proveedores/api/proveedoresHooks'
import { PagoCard } from './PagoCard'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle animate-fade-in-up font-inter">
        <h3 className="mb-2 text-lg font-bold text-ink">¿Eliminar pago?</h3>
        <p className="mb-5 text-sm text-ink-soft">
          ¿Estás seguro de que querés eliminar este pago de{' '}
          <strong className="text-ink">{pago.fecha}</strong>? Esta acción no se puede deshacer.
        </p>
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} loading={isPending}>
            Confirmar
          </Button>
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
  const { data: proveedoresData } = useProveedores()

  const proveedorNombreById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of proveedoresData ?? []) map.set(p.id, p.nombre)
    return map
  }, [proveedoresData])

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
    <div className="flex flex-col gap-6 font-inter">
      {items.length === 0 ? (
        <EmptyState title="Listado vacío" description="No hay pagos para mostrar." />
      ) : (
        <Card noPadding hover={false} className="overflow-hidden px-5">
          <ul className="flex flex-col divide-y divide-border-subtle-2">
            {items.map((pago) => (
              <li key={pago.id}>
                <PagoCard
                  pago={pago}
                  proveedorNombre={proveedorNombreById.get(pago.proveedor_id)}
                  onEdit={onEditPago}
                  onDelete={handleDeleteClick}
                />
              </li>
            ))}
          </ul>
        </Card>
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
