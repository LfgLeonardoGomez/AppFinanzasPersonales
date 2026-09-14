/**
 * PagoDetailDialog — read-only view of a single payment.
 *
 * Opened by activating a row in `PagosList`, mirroring
 * `FacturaDetailDialog` (c-26, factura-detail-view capability): reading a
 * pago is the common case and it must not put the user inside an editable
 * form by accident. Editing is a further, explicit action taken from here.
 *
 * IT FETCHES, for the same reason `FacturaDetailDialog` does: `GET
 * /api/pagos` returns the LEAN `PagoListItem` row and the backend omits
 * `comprobante_url` on purpose to keep the list payload small
 * (api.generated.d.ts: "Omits comprobante_url and updated_at"). Every other
 * field this dialog shows (fecha, monto, metodo, origen) is already on the
 * list row, so the dialog paints instantly; only the comprobante action
 * waits on `GET /api/pagos/{id}`.
 *
 * RN-PAG-01: a pago is NEVER linked to a factura — there is no
 * `factura_id` anywhere here, and the "Pago al proveedor" label (mirrored
 * from `PagoCard`) reinforces that a payment settles with the supplier,
 * never against one specific invoice.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { useState } from 'react'
import { ExternalLink, Pencil, X } from 'lucide-react'
import type { PagoListItem } from '@shared/api/api'
import { formatMonto } from '@shared/utils/currency'
import { ArchivoPreviewDialog } from '@shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog'
import { usePago } from '../api/pagosHooks'
import { MetodoBadge } from './MetodoBadge'

interface PagoDetailDialogProps {
  pago: PagoListItem | null
  proveedorNombre?: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (pago: PagoListItem) => void
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

export function PagoDetailDialog({
  pago,
  proveedorNombre,
  open,
  onOpenChange,
  onEdit,
}: PagoDetailDialogProps) {
  const [previewOpen, setPreviewOpen] = useState(false)
  // Only fetch while the dialog is actually open — the hook is disabled on
  // an empty id, so a closed dialog costs nothing.
  const { data: completa } = usePago(open && pago ? pago.id : '')

  if (!pago) return null

  const comprobanteUrl = completa?.comprobante_url ?? null

  return (
    <>
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/40" />
          <Dialog.Content
            // Radix derives the accessible name from Dialog.Title, so an
            // aria-label here would be ignored. The testid gives callers an
            // unambiguous handle that cannot silently stop matching.
            data-testid="pago-detail-dialog"
            aria-modal="true"
            className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle focus:outline-none dark:bg-card-dark dark:ring-white/10"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                {/* RN-PAG-01 reinforcement, mirrored from PagoCard: a pago
                    settles with the supplier, never a specific factura. */}
                <span className="text-[10.5px] font-bold uppercase tracking-wide text-ink-soft">
                  Pago al proveedor
                </span>
                <Dialog.Title className="font-inter text-lg font-semibold text-ink dark:text-zinc-100">
                  {proveedorNombre ?? 'Proveedor sin nombre'}
                </Dialog.Title>
                <Dialog.Description className="sr-only">
                  Vista de solo lectura del pago.
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
              <Campo label="Fecha">{pago.fecha}</Campo>
              <Campo label="Método">
                <MetodoBadge metodo={pago.metodo} />
              </Campo>
              <Campo label="Monto">
                <span className="font-bold tabular-nums">{formatMonto(pago.monto)}</span>
              </Campo>
              <Campo label="Origen">{pago.origen}</Campo>
            </div>

            <div className="mt-6 flex items-center justify-end gap-2">
              {comprobanteUrl && (
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  aria-label="Ver comprobante"
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-violet-500 transition-colors hover:bg-violet-50 hover:text-violet-600"
                >
                  <ExternalLink className="h-4 w-4" />
                  Ver comprobante
                </button>
              )}
              <button
                type="button"
                onClick={() => onEdit(pago)}
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
        url={comprobanteUrl}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        title="Comprobante de pago"
      />
    </>
  )
}

export default PagoDetailDialog
