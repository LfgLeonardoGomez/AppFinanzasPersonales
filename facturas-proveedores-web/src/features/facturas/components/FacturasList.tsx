/**
 * FacturasList — paginated list of invoices with estado badges and delete confirmation.
 *
 * Redesigned to the new design system (violet/beige/Inter tokens): a
 * low-density row list inside a single Card, never a table (LAYOUT.md —
 * "nunca convertir el resto de la app en tablas"). Test contracts preserved:
 *  - estado text visible (PENDIENTE / PAGADA)
 *  - ARS formatting
 *  - empty state text matches /sin facturas|no hay|empty/i
 *  - delete buttons with accessible name matching /eliminar/i
 *  - edit button with accessible name exactly "Editar"
 *  - dialog role
 *  - confirm button with name /confirmar|sí|yes/i
 *
 * The supplier name shown per row is a display-only lookup (existing
 * `useProveedores` hook — no new backend endpoint): `FacturaListItem` only
 * carries `proveedor_id`, so the row falls back to a generic label while the
 * lookup is loading or the supplier isn't in the (first-page) result.
 */
import { useMemo, useState } from 'react'
import { useFacturas, useDeleteFactura } from '../api/facturasHooks'
import { useProveedores } from '@features/proveedores/api/proveedoresHooks'
import { EstadoBadge } from './EstadoBadge'
import { formatMonto } from '@shared/utils/currency'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
import { EmptyState } from '@shared/components/EmptyState/EmptyState'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { FacturaDetailDialog } from './FacturaDetailDialog'
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-sm rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle animate-fade-in-up font-inter">
        <h3 className="mb-2 text-lg font-bold text-ink">¿Eliminar factura?</h3>
        <p className="mb-5 text-sm text-ink-soft">
          ¿Estás seguro de que querés eliminar la factura{' '}
          <strong className="text-ink">{factura.numero ?? factura.id}</strong>? Esta acción no se
          puede deshacer.
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

// ── Proveedor chip (display-only) ──────────────────────────────────────────

function getInitials(nombre: string): string {
  const parts = nombre.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]!.charAt(0) + parts[1]!.charAt(0)).toUpperCase()
}

function pickChipPalette(seed: string): { bg: string; text: string } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash + seed.charCodeAt(i)) % 2
  return hash === 0
    ? { bg: 'bg-violet-50', text: 'text-violet-500' }
    : { bg: 'bg-magenta-50', text: 'text-magenta-500' }
}

function ProveedorChip({ proveedorId, nombre }: { proveedorId: string; nombre?: string | undefined }) {
  const palette = pickChipPalette(proveedorId)
  return (
    <div
      aria-hidden="true"
      className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-chip text-xs font-bold ${palette.bg} ${palette.text}`}
    >
      {nombre ? getInitials(nombre) : '?'}
    </div>
  )
}

export function FacturasList({ filters, onEditFactura }: FacturasListProps) {
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<FacturaListItem | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [detalle, setDetalle] = useState<FacturaListItem | null>(null)

  const { data, isLoading, isError } = useFacturas({ ...filters, page })
  const deleteMutation = useDeleteFactura()
  const { data: proveedoresData } = useProveedores()

  const proveedorNombreById = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of proveedoresData ?? []) map.set(p.id, p.nombre)
    return map
  }, [proveedoresData])

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
    <div className="flex flex-col gap-6 font-inter">
      {items.length === 0 ? (
        <EmptyState title="Listado vacío" description="No hay facturas para mostrar." />
      ) : (
        <Card noPadding hover={false} className="overflow-hidden px-5">
          <div className="flex flex-col divide-y divide-border-subtle-2">
            {items.map((factura) => (
              <div key={factura.id} className="flex items-center gap-3.5 py-3.5">
                {/* c-26 (D4): the informational area is the clickable region and
                    the action buttons live OUTSIDE it. Nesting them inside a
                    clickable row would put interactive controls inside an
                    interactive control, and would leave correctness depending
                    on every future action remembering to stop propagation. */}
                <button
                  type="button"
                  onClick={() => setDetalle(factura)}
                  aria-label={`Ver detalle de la factura ${factura.numero ?? factura.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3.5 rounded-lg text-left transition-colors hover:bg-page/40"
                >
                  <ProveedorChip
                    proveedorId={factura.proveedor_id}
                    nombre={proveedorNombreById.get(factura.proveedor_id)}
                  />

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">
                      {proveedorNombreById.get(factura.proveedor_id) ?? 'Proveedor'}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      N.° {factura.numero ?? '—'} · {factura.fecha_emision}
                    </p>
                  </div>

                  <EstadoBadge estado={factura.estado} />

                  <p className="w-24 shrink-0 text-right text-sm font-bold tabular-nums text-ink">
                    {formatMonto(factura.monto_total)}
                  </p>
                </button>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onEditFactura(factura)}
                    aria-label="Editar"
                    className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-violet-50 hover:text-violet-500"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteClick(factura)}
                    disabled={deleteMutation.isPending}
                    aria-label={`Eliminar factura ${factura.numero ?? factura.id}`}
                    className="rounded-lg p-1.5 text-ink-soft transition-colors hover:bg-danger-bg hover:text-danger"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <FacturaDetailDialog
        factura={detalle}
        proveedorNombre={detalle ? proveedorNombreById.get(detalle.proveedor_id) : undefined}
        open={detalle !== null}
        onOpenChange={(next) => {
          if (!next) setDetalle(null)
        }}
        onEdit={(factura) => {
          setDetalle(null)
          onEditFactura(factura)
        }}
      />

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft-2 transition-colors hover:bg-surface-alt disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
            Anterior
          </button>
          <span className="text-sm text-ink-soft">Página {page}</span>
          <button
            type="button"
            disabled={!hasMore}
            onClick={() => setPage((p) => p + 1)}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium text-ink-soft-2 transition-colors hover:bg-surface-alt disabled:opacity-40"
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
