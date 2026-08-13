/**
 * VentasList — sales list: totals, rows, edit and delete (C-34).
 *
 * Composes `TotalesDelDia` (fed the SAME `useVentas` result the rows render
 * — design.md D2, never a second request) and a row per sale (`VentaCard`),
 * with the customer id→name map resolved once via `useClientes` (design.md
 * D3) and shared by every row on account.
 *
 * Delete has TWO different confirmations (design.md D5):
 *  - a sale ON ACCOUNT opens `DeudaDesapareceDialog` (`mode="delete"`) —
 *    names the customer and the amount that stops being owed;
 *  - any OTHER sale opens a plain confirmation with no debt paragraph
 *    (spec "a cash sale is confirmed without the debt warning") — that
 *    dialog is NOT `DeudaDesapareceDialog` (task 8.8 scopes it to exactly
 *    the two on-account paths), so it is a small local component here,
 *    mirroring `DeletePagoDialog`/`DeleteFacturaDialog`.
 */
import { useMemo, useState } from 'react'
import { useVentas, useDeleteVenta } from '../api/ventasHooks'
import { useClientes } from '@features/clientes/api/clientesHooks'
import { VentaCard } from './VentaCard'
import { TotalesDelDia } from './TotalesDelDia'
import { DeudaDesapareceDialog } from './DeudaDesapareceDialog'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { formatMonto } from '@shared/utils/currency'
import type { VentaListItem, VentasFilters } from '@shared/api/api'

interface VentasListProps {
  filters: VentasFilters
  onEditVenta: (venta: VentaListItem) => void
}

// ── Plain delete confirmation — cash sales only (design.md D5, third copy) ──

interface ConfirmDeleteVentaDialogProps {
  open: boolean
  venta: VentaListItem | null
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
  /** Review fix (finding B) — mirrors `DeudaDesapareceDialog`'s error slot. */
  error?: string | null
}

function ConfirmDeleteVentaDialog({
  open,
  venta,
  onConfirm,
  onCancel,
  isPending,
  error,
}: ConfirmDeleteVentaDialogProps) {
  if (!open || !venta) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Confirmar eliminación"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle animate-fade-in-up font-inter">
        <h3 className="mb-2 text-lg font-bold text-ink">Eliminar venta</h3>
        <p className="mb-5 text-sm text-ink-soft">
          ¿Querés eliminar la venta de{' '}
          <strong className="text-ink">{formatMonto(venta.monto)}</strong> del{' '}
          <strong className="text-ink">{venta.fecha}</strong>?
        </p>
        {error && (
          <p role="alert" aria-live="assertive" className="mb-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-3">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={isPending}>
            Cancelar
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm} loading={isPending}>
            Eliminar
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── VentasList ────────────────────────────────────────────────────────────

export function VentasList({ filters, onEditVenta }: VentasListProps) {
  const [pendingDelete, setPendingDelete] = useState<VentaListItem | null>(null)
  // Review fix (finding B): a failed delete used to close nothing and say
  // nothing — the dialog just re-enabled its buttons. Now the error is kept
  // alongside the pending delete and surfaced in whichever dialog is open.
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const { data, isLoading, isError } = useVentas(filters)
  const deleteMutation = useDeleteVenta()
  const { data: clientesData } = useClientes()

  const clienteNombreById = useMemo(() => {
    const map = new Map<string, string>()
    for (const c of clientesData ?? []) map.set(c.id, c.nombre)
    return map
  }, [clientesData])

  // Newest first (spec "the sales list is filterable... newest first").
  // Ties on `fecha` break by `created_at` — the order sales were actually
  // recorded in, which the plain YYYY-MM-DD date can't express.
  const items = useMemo(() => {
    return [...(data ?? [])].sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? 1 : -1
      return a.created_at < b.created_at ? 1 : -1
    })
  }, [data])

  function handleDeleteClick(venta: VentaListItem) {
    setDeleteError(null)
    setPendingDelete(venta)
  }

  function handleCancelDelete() {
    setPendingDelete(null)
    setDeleteError(null)
  }

  function handleConfirmDelete() {
    if (!pendingDelete) return
    setDeleteError(null)
    deleteMutation.mutate(
      {
        id: pendingDelete.id,
        cliente_id: pendingDelete.cliente_id,
        forma_pago: pendingDelete.forma_pago,
      },
      {
        onSuccess: () => {
          setPendingDelete(null)
          setDeleteError(null)
        },
        onError: (err: unknown) => {
          setDeleteError(extractBackendError(err))
        },
      },
    )
  }

  if (isLoading) {
    return <LoadingState label="Cargando ventas…" />
  }

  if (isError) {
    return (
      <div role="alert" className="rounded-xl bg-danger-bg p-4 text-sm text-danger ring-1 ring-danger/10">
        Error al cargar las ventas.
      </div>
    )
  }

  const pendingIsOnAccount = pendingDelete?.forma_pago === 'CUENTA_CORRIENTE'

  return (
    <div className="flex flex-col gap-6 font-inter">
      <TotalesDelDia ventas={data} isLoading={isLoading} />

      {items.length === 0 ? (
        <EmptyState title="Listado vacío" description="No hay ventas para mostrar." />
      ) : (
        <Card noPadding hover={false} className="overflow-hidden px-5">
          <ul className="flex flex-col divide-y divide-border-subtle-2">
            {items.map((venta) => (
              <li key={venta.id}>
                <VentaCard
                  venta={venta}
                  clienteNombre={venta.cliente_id ? clienteNombreById.get(venta.cliente_id) : undefined}
                  onEdit={onEditVenta}
                  onDelete={handleDeleteClick}
                />
              </li>
            ))}
          </ul>
        </Card>
      )}

      {pendingIsOnAccount && pendingDelete ? (
        <DeudaDesapareceDialog
          open={true}
          mode="delete"
          clienteNombre={
            (pendingDelete.cliente_id && clienteNombreById.get(pendingDelete.cliente_id)) || 'Cliente'
          }
          monto={pendingDelete.monto}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          isPending={deleteMutation.isPending}
          error={deleteError}
        />
      ) : (
        <ConfirmDeleteVentaDialog
          open={pendingDelete !== null}
          venta={pendingDelete}
          onConfirm={handleConfirmDelete}
          onCancel={handleCancelDelete}
          isPending={deleteMutation.isPending}
          error={deleteError}
        />
      )}
    </div>
  )
}

function extractBackendError(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const e = err as { response?: { data?: { detail?: unknown } } }
    const detail = e.response?.data?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string }
      return first?.msg ?? 'Error de validación.'
    }
  }
  return 'Error al eliminar la venta. Intentá de nuevo.'
}

export default VentasList
