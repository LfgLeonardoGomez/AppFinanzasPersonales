/**
 * HistorialCronologico — premium chronological table for cuenta-corriente.
 *
 * Preserves all test contracts:
 *  - data-testid={`historial-row-${h.id}`}
 *  - data-testid="historial-chip" + data-tipo={h.tipo}
 *  - data-testid="historial-saldo-acumulado"
 *  - "Sin movimientos registrados." text
 */
import type { EntradaHistorial } from '@shared/api/api'
import { formatMonto, formatSaldo } from '@shared/utils/currency'

interface HistorialCronologicoProps {
  historial: EntradaHistorial[]
}

function chipFor(tipo: EntradaHistorial['tipo']) {
  if (tipo === 'FACTURA') {
    return {
      label: 'Debe',
      className:
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/20',
    }
  }
  return {
    label: 'Haber',
    className:
      'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide bg-blue-50 text-blue-700 ring-1 ring-blue-200 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20',
  }
}

export function HistorialCronologico({ historial }: HistorialCronologicoProps) {
  if (historial.length === 0) {
    return (
      <p role="status" className="text-sm text-navy-500 dark:text-zinc-400">
        Sin movimientos registrados.
      </p>
    )
  }

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.04] dark:border-white/5">
      <table className="w-full text-left text-sm" aria-label="Historial cronológico">
        <thead>
          <tr className="border-b border-black/[0.04] bg-cream-dark/40 dark:border-white/5 dark:bg-white/[0.02]">
            <th className="px-4 py-3 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
              Fecha
            </th>
            <th className="px-4 py-3 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
              Tipo
            </th>
            <th className="px-4 py-3 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
              Monto
            </th>
            <th className="px-4 py-3 font-sans text-xs font-semibold uppercase tracking-wider text-navy-500 dark:text-zinc-400">
              Saldo acumulado
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/[0.04] dark:divide-white/5">
          {historial.map((h) => {
            const chip = chipFor(h.tipo)
            return (
              <tr
                key={h.id}
                data-testid={`historial-row-${h.id}`}
                className="transition-colors hover:bg-cream-dark/30 dark:hover:bg-white/[0.02]"
              >
                <td className="px-4 py-3 tabular-nums text-navy-600 dark:text-zinc-400">
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
                <td className="px-4 py-3 tabular-nums font-medium text-navy-700 dark:text-zinc-300">
                  {formatMonto(Math.abs(h.monto))}
                </td>
                <td
                  className="px-4 py-3 tabular-nums font-semibold text-navy-800 dark:text-zinc-100"
                  data-testid="historial-saldo-acumulado"
                >
                  {formatSaldo(h.saldo_acumulado)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default HistorialCronologico
