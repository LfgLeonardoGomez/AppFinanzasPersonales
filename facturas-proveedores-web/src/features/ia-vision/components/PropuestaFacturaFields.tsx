/**
 * PropuestaFacturaFields — presentational field group for the
 * C-14 `PropuestaFactura` proposal (C-15, section 4).
 *
 * Renders four inputs:
 *   - numero (text)
 *   - fecha_emision (date)
 *   - monto_total (number, ARS)
 *   - SupplierSearch (C-07) for proveedor matching
 *
 * Every input is editable. The parent (PropuestaIAModal) owns the
 * state and passes it back via `onChange`. The component is purely
 * presentational — no business logic, no API calls, no local
 * persistence. This is the D-3 / RN-IA-03 / RN-IA-06 contract:
 *   - null proposal fields render as empty inputs (never invent)
 *   - the SupplierSearch value is null even when the proposal has a
 *     non-null `proveedor_nombre` (the IA never pre-selects)
 *
 * Visual: same soft-structuralism language as the rest of the app
 * (D12). Inputs are stack-aligned with subtle ring focus rings,
 * labels above. The monto_total input is right-aligned for
 * numerics; the ARS suffix is a small text-xs text-slate-500 span
 * next to the input (mirrors the C-09 / C-11 form pages).
 */
import { SupplierSearch } from '@shared/components/SupplierSearch/SupplierSearch'
import type { PropuestaFactura, ProveedorListItem } from '@shared/api/api'

export interface PropuestaFacturaFieldsProps {
  propuesta: PropuestaFactura
  onChange: (next: PropuestaFactura) => void
  /** Controlled supplier (selected by the user via SupplierSearch). */
  selectedProveedor?: ProveedorListItem | null
  onProveedorChange?: (proveedor: ProveedorListItem | null) => void
}

function isoDate(value: string | null): string {
  return value ?? ''
}

function montoString(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return ''
  return String(value)
}

export function PropuestaFacturaFields({
  propuesta,
  onChange,
  selectedProveedor = null,
  onProveedorChange,
}: PropuestaFacturaFieldsProps) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label htmlFor="ia-propuesta-numero" className="block text-xs font-medium text-slate-600 mb-1">
          Número
        </label>
        <input
          id="ia-propuesta-numero"
          type="text"
          value={propuesta.numero ?? ''}
          onChange={(e) => onChange({ ...propuesta, numero: e.target.value || null })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      <div>
        <label htmlFor="ia-propuesta-fecha" className="block text-xs font-medium text-slate-600 mb-1">
          Fecha de emisión
        </label>
        <input
          id="ia-propuesta-fecha"
          type="date"
          value={isoDate(propuesta.fecha_emision)}
          onChange={(e) => onChange({ ...propuesta, fecha_emision: e.target.value || null })}
          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        />
      </div>

      <div>
        <label htmlFor="ia-propuesta-monto" className="block text-xs font-medium text-slate-600 mb-1">
          Monto total
        </label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">ARS</span>
          <input
            id="ia-propuesta-monto"
            type="number"
            step="0.01"
            min="0"
            value={montoString(propuesta.monto_total)}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                onChange({ ...propuesta, monto_total: null })
                return
              }
              const n = Number(raw)
              onChange({ ...propuesta, monto_total: Number.isFinite(n) ? n : null })
            }}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor</label>
        <SupplierSearch
          value={selectedProveedor}
          onChange={onProveedorChange ?? (() => {})}
          placeholder="Buscar proveedor…"
        />
        {propuesta.proveedor_nombre ? (
          <p className="text-xs text-slate-500 mt-1">
            Detectado por IA: <span className="font-medium">{propuesta.proveedor_nombre}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}
