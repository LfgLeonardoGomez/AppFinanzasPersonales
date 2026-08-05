/**
 * HistorialCronologico — premium chronological table for cuenta-corriente.
 *
 * Preserves all test contracts:
 *  - data-testid={`historial-row-${h.id}`}
 *  - data-testid="historial-chip" + data-tipo={h.tipo}
 *  - data-testid="historial-saldo-acumulado"
 *  - "Sin movimientos registrados." text
 */
import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { EntradaHistorial } from '@shared/api/api'
import { formatMonto, formatSaldo } from '@shared/utils/currency'
import { ArchivoPreviewDialog } from '@shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog'

interface HistorialCronologicoProps {
  historial: EntradaHistorial[]
}

function chipFor(tipo: EntradaHistorial['tipo']) {
  if (tipo === 'FACTURA') {
    return {
      label: 'Debe',
      className:
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-badge-parcial-bg text-badge-parcial-text',
    }
  }
  return {
    label: 'Haber',
    className:
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-badge-pagada-bg text-badge-pagada-text',
  }
}

export function HistorialCronologico({ historial }: HistorialCronologicoProps) {
  // c-27: local UI state only — no fetching, and the array is still rendered
  // exactly in the order received (the C-24 saldo_acumulado invariant).
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
          {historial.map((h) => {
            const chip = chipFor(h.tipo)
            return (
              <tr
                key={h.id}
                data-testid={`historial-row-${h.id}`}
                className="transition-colors hover:bg-page/30"
              >
                <td className="px-4 py-3 tabular-nums text-ink-soft-2">
                  {h.fecha}
                </td>
                <td className="px-4 py-3">
                  <span
                    data-testid="historial-chip"
                    data-tipo={h.tipo}
                    className={chip.className}
                  >
                    {chip.label}
                  </span>
                </td>
                <td className="px-4 py-3 tabular-nums font-medium text-ink-soft-2">
                  {formatMonto(Math.abs(h.monto))}
                </td>
                <td
                  className="px-4 py-3 tabular-nums font-semibold text-ink"
                  data-testid="historial-saldo-acumulado"
                >
                  {formatSaldo(h.saldo_acumulado)}
                </td>
                <td className="px-4 py-3">
                  {h.archivo_url ? (
                    <button
                      type="button"
                      onClick={() =>
                        setPreview({
                          url: h.archivo_url!,
                          title: h.tipo === 'PAGO' ? 'Comprobante de pago' : 'Archivo de factura',
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

export default HistorialCronologico
