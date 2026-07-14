/**
 * PropuestaPagoFields — presentational field group for the
 * C-14 `PropuestaPago` proposal (C-15, section 5).
 *
 * Renders three inputs plus a visual chip for the detected metodo:
 *   - monto (number, ARS)
 *   - fecha (date)
 *   - metodo (select: EFECTIVO | TRANSFERENCIA | TARJETA | MERCADOPAGO | OTRO)
 *   - MetodoBadge (C-11) — a small visual chip that confirms the IA's
 *     read; rendered when `propuesta.metodo` is non-null.
 *
 * Every input is editable. The parent (PropuestaIAModal) owns the
 * state and passes it back via `onChange`. The component is purely
 * presentational — no business logic, no API calls, no local
 * persistence. This is the RN-IA-03 contract: null fields render
 * as empty inputs (never invent). The metodo select allows the
 * user to override the IA's pick (per OQ-6 in the design).
 *
 * Visual: same soft-structuralism language as the rest of the app
 * (D12). The MetodoBadge sits inline with the select — the chip
 * acts as a confirmation badge and disappears when the user picks
 * a different metodo (the chip re-renders with the new value).
 */
import { MetodoBadge } from '@features/pagos/components/MetodoBadge'
import type { PropuestaPago, MetodoPago } from '@shared/api/api'

export interface PropuestaPagoFieldsProps {
  propuesta: PropuestaPago
  onChange: (next: PropuestaPago) => void
}

const METODO_OPTIONS: { value: MetodoPago; label: string }[] = [
  { value: 'EFECTIVO', label: 'Efectivo' },
  { value: 'TRANSFERENCIA', label: 'Transferencia' },
  { value: 'TARJETA', label: 'Tarjeta' },
  { value: 'MERCADOPAGO', label: 'MercadoPago' },
  { value: 'OTRO', label: 'Otro' },
]

function isoDate(value: string | null): string {
  return value ?? ''
}

function montoString(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  return String(value)
}

export function PropuestaPagoFields({ propuesta, onChange }: PropuestaPagoFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="ia-propuesta-pago-monto" className="block text-xs font-medium text-slate-600 mb-1">
          Monto
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">ARS</span>
          <input
            id="ia-propuesta-pago-monto"
            type="number"
            step="0.01"
            min="0"
            value={montoString(propuesta.monto)}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                onChange({ ...propuesta, monto: null })
                return
              }
              const n = Number(raw)
              onChange({ ...propuesta, monto: Number.isFinite(n) ? n : null })
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
      </div>

      <div>
        <label htmlFor="ia-propuesta-pago-fecha" className="block text-xs font-medium text-slate-600 mb-1">
          Fecha
        </label>
        <input
          id="ia-propuesta-pago-fecha"
          type="date"
          value={isoDate(propuesta.fecha)}
          onChange={(e) => onChange({ ...propuesta, fecha: e.target.value || null })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      <div>
        <label htmlFor="ia-propuesta-pago-metodo" className="block text-xs font-medium text-slate-600 mb-1">
          Método
        </label>
        <div className="flex items-center gap-3">
          {propuesta.metodo ? <MetodoBadge metodo={propuesta.metodo} /> : null}
          <select
            id="ia-propuesta-pago-metodo"
            value={propuesta.metodo ?? ''}
            onChange={(e) =>
              onChange({
                ...propuesta,
                metodo: (e.target.value === '' ? null : (e.target.value as MetodoPago)),
              })
            }
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          >
            <option value="">—</option>
            {METODO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  )
}
