/**
 * CuentaCorrientePage — saldo card + Facturas/Pagos/Historial toggle
 * (C-13, D7; redesign: design/screen-proveedores — Detalle Proveedor handoff).
 *
 * The Claude Design handoff replaces the previous "always visible" table +
 * historial layout with a single toggle (pills) that swaps the content of
 * one panel — there is no more a separate, always-rendered "Historial"
 * section. This matches LAYOUT.md ("cuenta corriente ... debe sentirse
 * liviana") and UX_PRINCIPLES.md #3 ("una pantalla, un objetivo").
 *
 * The "Pagos" tab is derived from the existing `historial` array (filtered
 * to `tipo === 'PAGO'`) instead of a new query — the component stays
 * presentational (no HTTP calls), reusing the C-12 response verbatim.
 *
 * Preserves all test contracts:
 *  - data-testid="cuenta-corriente-page"
 *  - section aria-label="Saldo", "Facturas con estado", "Historial cronológico"
 *  - "Sin movimientos registrados." text
 *  - Default tab is "Facturas" (facturas-con-estado rows render without
 *    any interaction); "Pagos" / "Historial" render after clicking their pill.
 *
 * C-24: historial display-order toggle (newest-first by default).
 *
 * ⚠️ CRITICAL — READ BEFORE TOUCHING `displayedHistorial` BELOW ⚠️
 * The backend (`_build_historial`, RN-HIST) sorts ASC by (fecha, created_at,
 * id) and computes `saldo_acumulado` as a running sum IN THAT SAME PASS. The
 * response order and each row's `saldo_acumulado` are therefore coupled —
 * the value at index i depends on having walked indices 0..i-1 in that exact
 * order. `displayedHistorial` below is ONLY EVER `[...historial]` optionally
 * followed by `.reverse()` — a pure structural flip that cannot touch any
 * row's own fields. It MUST NEVER become a `.sort()` with a comparator (e.g.
 * "sort by fecha descending"): that would silently decouple row order from
 * the saldo_acumulado the backend computed for the ASC walk, corrupting the
 * exact invariant this on-demand ledger exists to guarantee. See
 * `CuentaCorrientePage.test.tsx`'s "REGRESSION GUARD" test, which asserts
 * every row's rendered saldo_acumulado is identical between asc/desc modes.
 */
import { useMemo, useState } from 'react'
import { SaldoBadge } from './components/SaldoBadge'
import { TablaFacturasConEstado } from './components/TablaFacturasConEstado'
import { PagosRegistrados } from './components/PagosRegistrados'
import { HistorialCronologico } from './components/HistorialCronologico'
import { Card } from '@shared/components/Card/Card'
import type {
  CuentaCorrienteResponse,
  FiltrosFacturas as FiltrosFacturasType,
} from '@shared/api/api'

interface CuentaCorrientePageProps {
  cuentaCorriente: CuentaCorrienteResponse
}

type Tab = 'facturas' | 'pagos' | 'historial'
type HistorialOrder = 'asc' | 'desc'

const TAB_LABELS: Record<Tab, string> = {
  facturas: 'Facturas',
  pagos: 'Pagos',
  historial: 'Historial',
}

const PANEL_TITLES: Record<Tab, string> = {
  facturas: 'Facturas con estado',
  pagos: 'Pagos registrados',
  historial: 'Historial cronológico',
}

function isEmptyTriple(cc: CuentaCorrienteResponse): boolean {
  return (
    cc.saldo === 0 &&
    cc.facturas_con_estado.length === 0 &&
    cc.historial.length === 0
  )
}

function TabPill({
  tab,
  active,
  onSelect,
}: {
  tab: Tab
  active: boolean
  onSelect: (tab: Tab) => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={() => onSelect(tab)}
      className={`
        rounded-pill px-3.5 py-1.5 font-inter text-xs font-semibold transition-colors duration-160
        ${active ? 'bg-surface text-violet-900 shadow-sm' : 'bg-transparent text-ink-soft hover:text-ink-soft-2'}
      `}
    >
      {TAB_LABELS[tab]}
    </button>
  )
}

function OrderToggle({
  order,
  onChange,
}: {
  order: HistorialOrder
  onChange: (order: HistorialOrder) => void
}) {
  return (
    <div className="flex gap-0.5 rounded-pill bg-page p-[3px]">
      <button
        type="button"
        aria-pressed={order === 'desc'}
        onClick={() => onChange('desc')}
        className={`
          rounded-pill px-3 py-1 font-inter text-xs font-medium transition-colors duration-160
          ${order === 'desc' ? 'bg-surface text-violet-900 shadow-sm' : 'bg-transparent text-ink-soft hover:text-ink-soft-2'}
        `}
      >
        Más reciente primero
      </button>
      <button
        type="button"
        aria-pressed={order === 'asc'}
        onClick={() => onChange('asc')}
        className={`
          rounded-pill px-3 py-1 font-inter text-xs font-medium transition-colors duration-160
          ${order === 'asc' ? 'bg-surface text-violet-900 shadow-sm' : 'bg-transparent text-ink-soft hover:text-ink-soft-2'}
        `}
      >
        Más antiguo primero
      </button>
    </div>
  )
}

export function CuentaCorrientePage({ cuentaCorriente }: CuentaCorrientePageProps) {
  const [filters, setFilters] = useState<FiltrosFacturasType>({})
  const [tab, setTab] = useState<Tab>('facturas')
  // Default 'desc' (newest first) per the user's explicit request. The
  // backend's own order (RN-HIST) is 'asc' — see the block comment above
  // this component for why the reversal MUST stay a pure `.reverse()`.
  const [historialOrder, setHistorialOrder] = useState<HistorialOrder>('desc')

  const pagos = useMemo(
    () => cuentaCorriente.historial.filter((h) => h.tipo === 'PAGO'),
    [cuentaCorriente.historial],
  )

  // Display-only reversal of a COPY. Never a value-based re-sort — see the
  // block comment above this component (C-24 critical invariant).
  const displayedHistorial = useMemo(
    () =>
      historialOrder === 'desc'
        ? [...cuentaCorriente.historial].reverse()
        : cuentaCorriente.historial,
    [cuentaCorriente.historial, historialOrder],
  )

  if (isEmptyTriple(cuentaCorriente)) {
    return (
      <div data-testid="cuenta-corriente-page" className="flex flex-col gap-6">
        <Card>
          <p className="font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Saldo
          </p>
          <div className="mt-2">
            <SaldoBadge saldo={cuentaCorriente.saldo} />
          </div>
        </Card>

        <Card>
          <p role="status" className="text-sm text-ink-soft">
            Sin movimientos registrados.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div
      data-testid="cuenta-corriente-page"
      className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-start"
    >
      <section aria-label="Saldo" className="md:col-span-4">
        <Card className="flex flex-col gap-2.5">
          <p className="font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Saldo
          </p>
          <SaldoBadge saldo={cuentaCorriente.saldo} />
          <p className="text-xs leading-relaxed text-ink-soft">
            Calculado al momento a partir de facturas y pagos. Se actualiza
            automáticamente.
          </p>
        </Card>
      </section>

      <section aria-label={PANEL_TITLES[tab]} className="md:col-span-8">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-inter text-base font-semibold text-ink">
              {PANEL_TITLES[tab]}
            </h2>
            <div className="flex gap-0.5 rounded-pill bg-page p-[3px]">
              <TabPill tab="facturas" active={tab === 'facturas'} onSelect={setTab} />
              <TabPill tab="pagos" active={tab === 'pagos'} onSelect={setTab} />
              <TabPill tab="historial" active={tab === 'historial'} onSelect={setTab} />
            </div>
          </div>

          {tab === 'historial' && (
            <div className="mb-3 flex justify-end">
              <OrderToggle order={historialOrder} onChange={setHistorialOrder} />
            </div>
          )}

          {tab === 'facturas' && (
            <TablaFacturasConEstado
              facturas={cuentaCorriente.facturas_con_estado}
              filters={filters}
              onChangeFilters={setFilters}
            />
          )}
          {tab === 'pagos' && <PagosRegistrados pagos={pagos} />}
          {tab === 'historial' && <HistorialCronologico historial={displayedHistorial} />}
        </Card>
      </section>
    </div>
  )
}

export default CuentaCorrientePage
