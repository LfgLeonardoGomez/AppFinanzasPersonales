/**
 * HistorialTable — shared chronological ledger table (C-36, design.md D2).
 *
 * Generalized extraction of the supplier's `HistorialCronologico` (C-13,
 * C-24): the columns, the running-balance column, the `ArchivoPreviewDialog`
 * wiring, and the empty state are identical between the supplier ledger
 * (`FACTURA`/`PAGO`) and the customer ledger (`VENTA`/`COBRO`) — only the
 * vocabulary differs. This component is generic over the row's `tipo`
 * string and takes that vocabulary as a config map from the caller, so it
 * hard-codes neither ledger's labels.
 *
 * ⚠️ CRITICAL — the row order / `saldo_acumulado` coupling ⚠️
 * The backend computes `saldo_acumulado` as a running sum in the SAME pass
 * that produces the response's chronological order. This component renders
 * `historial` EXACTLY as received — it never reorders, never recomputes.
 * The caller may hand it `[...historial].reverse()` (a pure structural
 * flip), but MUST NEVER pass a value-sorted array: that would silently
 * decouple a row's position from the `saldo_acumulado` the backend computed
 * for its original walk. See `CuentaCorrientePage.tsx` for the full
 * rationale (C-24) — this component inherits the same invariant, not a copy
 * of it.
 *
 * Preserves the exact test contracts the supplier suite
 * (`HistorialCronologico.test.tsx`) pins, so the supplier's thin wrapper
 * passes that suite unmodified:
 *  - data-testid={`historial-row-${row.id}`}
 *  - data-testid="historial-chip" + data-tipo={row.tipo}
 *  - data-testid="historial-saldo-acumulado"
 *  - "Sin movimientos registrados." text, role="status"
 */
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { formatMonto, formatSaldo } from '@shared/utils/currency'
import { ArchivoPreviewDialog } from '@shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog'

export interface HistorialTableRow {
  id: string
  tipo: string
  fecha: string
  monto: number
  saldo_acumulado: number
  archivo_url?: string | null
}

export interface HistorialTipoConfig {
  /** Chip text — e.g. "Debe" for a charge, "Haber" for a credit. */
  label: string
  /** Which side of the ledger, for the chip's colour tokens. */
  lado: 'debe' | 'haber'
  /** Title of the attachment preview dialog for rows of this tipo. */
  archivoTitulo: string
}

interface HistorialTableProps {
  historial: HistorialTableRow[]
  tipoConfig: Record<string, HistorialTipoConfig>
}

const LADO_CLASSES: Record<HistorialTipoConfig['lado'], string> = {
  debe: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-badge-parcial-bg text-badge-parcial-text',
  haber: 'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-badge-pagada-bg text-badge-pagada-text',
}

export function HistorialTable({ historial, tipoConfig }: HistorialTableProps) {
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null)

  if (historial.length === 0) {
    return (
      <p role="status" className="text-sm text-ink-soft">
        Sin movimientos registrados.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-card-sm border border-border-subtle">
      <table className="w-full text-left text-sm" aria-label="Historial cronológico">
        <thead>
          <tr className="border-b border-border-subtle bg-page/40">
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Fecha
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Tipo
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Monto
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Saldo acumulado
            </th>
            <th className="px-4 py-3 font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Archivo
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle-2">
          {historial.map((row) => {
            const config = tipoConfig[row.tipo]
            const label = config?.label ?? row.tipo
            const className = LADO_CLASSES[config?.lado ?? 'debe']
            return (
              <tr
                key={row.id}
                data-testid={`historial-row-${row.id}`}
                className="transition-colors hover:bg-page/30"
              >
                <td className="px-4 py-3 tabular-nums text-ink-soft-2">
                  {row.fecha}
                </td>
                <td className="px-4 py-3">
                  <span data-testid="historial-chip" data-tipo={row.tipo} className={className}>
                    {label}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums font-medium text-ink-soft-2">
                  {formatMonto(Math.abs(row.monto))}
                </td>
                <td
                  className="px-4 py-3 tabular-nums font-semibold text-ink"
                  data-testid="historial-saldo-acumulado"
                >
                  {formatSaldo(row.saldo_acumulado)}
                </td>
                <td className="px-4 py-3">
                  {row.archivo_url ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({
                          url: row.archivo_url!,
                          title: config?.archivoTitulo ?? 'Archivo',
                        })
                      }
                      className="inline-flex items-center gap-1 text-xs font-medium text-violet-500 transition-colors hover:text-violet-600"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Ver archivo
                    </button>
                  ) : (
                    <span className="text-ink-soft">—</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <ArchivoPreviewDialog
        url={preview?.url ?? null}
        open={preview !== null}
        onOpenChange={(next) => {
          if (!next) setPreview(null)
        }}
        title={preview?.title}
      />
    </div>
  )
}

export default HistorialTable
