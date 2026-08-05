/**
 * FacturaDetailDialog — read-only view of a single invoice (c-26,
 * factura-detail-view capability).
 *
 * Opened by activating a row in `FacturasList`. Reading an invoice is the
 * common case, and it must not put the user inside an editable form by
 * accident — easy to trigger on a phone. Editing is a further, explicit
 * action taken from here.
 *
 * IT FETCHES (revised D5). The first version deliberately did not, on the
 * assumption that the list row already carried every field. It does not:
 * `GET /api/facturas` returns a LEAN row — id, proveedor_id, numero,
 * fecha_emision, monto_total, estado — and the backend omits `archivo_url`,
 * `origen`, `fecha_vencimiento` and items on purpose to keep the payload
 * small. The frontend type claimed otherwise, so "Ver archivo" would never
 * have appeared here even for an invoice that has one. The lean row renders
 * the header instantly; the full invoice fills in the rest when it lands.
 *
 * Formatting is delegated to `EstadoBadge`, `formatMonto` and
 * `ArchivoPreviewDialog` so a figure or a badge can never drift into a
 * second shape here.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { FileText, Pencil, X } from 'lucide-react'
import type { FacturaListItem } from '@shared/api/api'
import { formatMonto } from '@shared/utils/currency'
import { ArchivoPreviewDialog } from '@shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog'
import { useFactura } from '../api/facturasHooks'
import { EstadoBadge } from './EstadoBadge'

interface FacturaDetailDialogProps {
  factura: FacturaListItem | null
  proveedorNombre?: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (factura: FacturaListItem) => void
}

function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-soft">
        {label}
      </span>
      <span className="text-sm text-ink">{children}</span>
    </div>
  )
}

export function FacturaDetailDialog({
  factura,
  proveedorNombre,
  open,
  onOpenChange,
  onEdit,
}: FacturaDetailDialogProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  // Only fetch while the dialog is actually open — the hook is disabled on an
  // empty id, so a closed dialog costs nothing.
  const { data: completa } = useFactura(open && factura ? factura.id : '')

  if (!factura) return null

  const items = completa?.items
  const archivoUrl = completa?.archivo_url ?? null

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/40" />
          <Dialog.Content
            // Radix derives the accessible name from Dialog.Title, so an
            // aria-label here would be ignored. The testid gives callers an
            // unambiguous handle that cannot silently stop matching.
            data-testid="factura-detail-dialog"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle focus:outline-none dark:bg-card-dark dark:ring-white/10"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <Dialog.Title className="font-inter text-lg font-semibold text-ink dark:text-zinc-100">
                  Factura N.° {factura.numero ?? '—'}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Vista de solo lectura de la factura.
                </Dialog.Description>
              </div>
              <button
                type="button"
                aria-label="Cerrar"
                onClick={() => onOpenChange(false)}
                className="shrink-0 rounded-full p-2 text-ink-soft-2 transition-colors hover:bg-danger-bg hover:text-danger"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              {/* No fallback to proveedor_id: a UUID is noise, not a name. */}
              <Campo label="Proveedor">{proveedorNombre ?? 'Proveedor sin nombre'}</Campo>
              <Campo label="Estado">
                <EstadoBadge estado={factura.estado} />
              </Campo>
              <Campo label="Emisión">{factura.fecha_emision}</Campo>
              <Campo label="Vencimiento">{completa?.fecha_vencimiento ?? '—'}</Campo>
              <Campo label="Total">
                <span className="font-bold tabular-nums">{formatMonto(factura.monto_total)}</span>
              </Campo>
              <Campo label="Origen">{completa?.origen ?? '—'}</Campo>
            </div>

            <div className="mt-5">
              <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-soft">
                Ítems
              </span>
              {items && items.length > 0 ? (
                <ul className="mt-1.5 flex flex-col divide-y divide-border-subtle-2">
                  {items.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {item.descripcion}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-ink-soft">
                        {item.cantidad} × {formatMonto(item.precio_unitario)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1.5 text-sm text-ink-soft">Sin ítems cargados.</p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              {archivoUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-violet-500 transition-colors hover:bg-violet-50 hover:text-violet-600"
                >
                  <FileText className="h-4 w-4" />
                  Ver archivo
                </button>
              )}
              <button
                type="button"
                onClick={() => onEdit(factura)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-page/60"
              >
                <Pencil className="h-4 w-4" />
                Editar
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ArchivoPreviewDialog
        url={archivoUrl}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title={`Factura N.° ${factura.numero ?? factura.id}`}
      />
    </>
  )
}

export default FacturaDetailDialog
