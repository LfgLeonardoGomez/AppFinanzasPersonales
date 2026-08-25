/**
 * ExportarCuentaCorriente — the export action for both cuenta-corriente
 * views (C-39, design.md D7, spec `exportacion-cuenta-corriente-frontend`).
 *
 * Shared between `CuentaCorrientePage` (supplier) and
 * `CuentaCorrienteCliente` (customer): both pass their own `exportFn` bound
 * to the right endpoint (`exportarCuentaCorrienteProveedor` /
 * `exportarCuentaCorrienteCliente`) — this component knows nothing about
 * which account type it is exporting.
 *
 * D7 — this component computes NOTHING about the document: it collects the
 * format/range choice, calls `exportFn`, and hands the returned Blob to
 * `onDescargar` (default: the real browser download, injectable for tests).
 *
 * Behavior contract (frontend spec):
 * - The rango controls (`desde`/`hasta`) only exist while `incluirHistorial`
 *   is checked — not merely disabled, not rendered at all.
 * - An inverted range (`desde` after `hasta`) is caught client-side and
 *   never sent.
 * - While pending, the trigger cannot be pressed again.
 * - On a rejection, the backend's own `detail` message is shown verbatim
 *   (the 422 "too many movements" case is WRITTEN to be acted on — a
 *   generic "export failed" would throw that away).
 * - After a failure, every chosen option is left exactly as it was — the
 *   person should not have to redo the range they already picked.
 */
import { useState, type FormEvent } from 'react'
import {
  extraerDetalleErrorExport,
  type ArchivoExportado,
  type ExportarCuentaCorrienteParams,
  type FormatoExport,
} from '../api/exportacionApi'
import { descargarBlob } from '@shared/utils/downloadBlob'

interface ExportarCuentaCorrienteProps {
  exportFn: (params: ExportarCuentaCorrienteParams) => Promise<ArchivoExportado>
  /** Test-only override — production uses the real browser download. */
  onDescargar?: (archivo: ArchivoExportado) => void
}

export function ExportarCuentaCorriente({ exportFn, onDescargar }: ExportarCuentaCorrienteProps) {
  const [open, setOpen] = useState(false)
  const [formato, setFormato] = useState<FormatoExport>('pdf')
  const [incluirHistorial, setIncluirHistorial] = useState(false)
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [rangoInvertidoError, setRangoInvertidoError] = useState(false)
  const [backendError, setBackendError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  function handleIncluirHistorialChange(next: boolean) {
    setIncluirHistorial(next)
    if (!next) {
      // Sin historial no hay rango que elegir (spec) — se limpia junto con
      // los controles que desaparecen, así una reactivación arranca vacía.
      setDesde('')
      setHasta('')
      setRangoInvertidoError(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setBackendError(null)

    if (incluirHistorial && desde && hasta && desde > hasta) {
      setRangoInvertidoError(true)
      return
    }
    setRangoInvertidoError(false)
    setIsPending(true)

    try {
      // `exactOptionalPropertyTypes` — the key must be ABSENT, not present
      // with an `undefined` value, so this is built conditionally rather
      // than assigning `desde: value ?? undefined` (task 8.3's contract:
      // omitted params never travel as empty/undefined query values).
      const params: ExportarCuentaCorrienteParams = { formato, incluirHistorial }
      if (incluirHistorial && desde) params.desde = desde
      if (incluirHistorial && hasta) params.hasta = hasta

      const archivo = await exportFn(params)
      ;(onDescargar ?? _descargarPorDefecto)(archivo)
      setOpen(false)
    } catch (err) {
      const detalle = await extraerDetalleErrorExport(err)
      setBackendError(detalle?.mensaje ?? 'No se pudo exportar la cuenta corriente.')
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-pill border border-border-subtle px-4 py-2 font-inter text-sm font-semibold text-ink transition-colors hover:bg-page disabled:opacity-50"
      >
        Exportar
      </button>

      {open && (
        <form
          onSubmit={handleSubmit}
          aria-label="Exportar cuenta corriente"
          className="mt-3 flex flex-col gap-3 rounded-card-sm border border-border-subtle bg-page/20 p-3"
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="export-formato" className="text-xs font-medium text-ink-soft">
              Formato
            </label>
            <select
              id="export-formato"
              value={formato}
              onChange={(e) => setFormato(e.target.value as FormatoExport)}
              className="rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink"
            >
              <option value="pdf">PDF</option>
              <option value="xlsx">Excel (XLSX)</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={incluirHistorial}
              onChange={(e) => handleIncluirHistorialChange(e.target.checked)}
            />
            Incluir historial de movimientos
          </label>

          {incluirHistorial && (
            <div className="flex flex-wrap gap-3">
              <div className="flex flex-col gap-1">
                <label htmlFor="export-desde" className="text-xs font-medium text-ink-soft">
                  Desde
                </label>
                <input
                  id="export-desde"
                  type="date"
                  value={desde}
                  onChange={(e) => {
                    setDesde(e.target.value)
                    setRangoInvertidoError(false)
                  }}
                  className="rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="export-hasta" className="text-xs font-medium text-ink-soft">
                  Hasta
                </label>
                <input
                  id="export-hasta"
                  type="date"
                  value={hasta}
                  onChange={(e) => {
                    setHasta(e.target.value)
                    setRangoInvertidoError(false)
                  }}
                  className="rounded-lg border border-border-subtle bg-surface px-2 py-1.5 text-sm text-ink"
                />
              </div>
            </div>
          )}

          {rangoInvertidoError && (
            <p role="alert" className="text-sm text-danger">
              La fecha desde no puede ser posterior a la fecha hasta.
            </p>
          )}

          {backendError && (
            <p role="alert" aria-live="assertive" className="text-sm text-danger">
              {backendError}
            </p>
          )}

          {isPending && (
            <p role="status" aria-live="polite" className="text-sm text-ink-soft">
              Generando el documento…
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-pill bg-violet-500 px-4 py-2 text-sm font-semibold text-white transition-all hover:bg-violet-600 disabled:opacity-50"
            >
              {isPending ? 'Generando…' : 'Descargar'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function _descargarPorDefecto(archivo: ArchivoExportado): void {
  descargarBlob(archivo.blob, archivo.filename)
}

export default ExportarCuentaCorriente
