/**
 * CuentaCorrienteCliente — the customer's account panel (C-36, design.md
 * D1, D3, D4, D6).
 *
 * Composes `SaldoBadge` (imported as-is from the supplier feature, D3),
 * `TablaVentasFiadas` and the shared `HistorialTable` configured for the
 * `VENTA`/`COBRO` vocabulary — mirrors `CuentaCorrientePage`'s
 * Fiados/Historial toggle shape, one level down (customer instead of
 * supplier).
 *
 * D1 — zero client-side arithmetic: `saldo`, each fiado's `estado`, and
 * each history row's `saldo_acumulado` are rendered exactly as the response
 * carries them.
 *
 * ⚠️ Same C-24 invariant as `CuentaCorrientePage` ⚠️ `displayedHistorial`
 * below is ONLY EVER `[...historial]` optionally followed by `.reverse()` —
 * a pure structural flip. It must NEVER become a `.sort()` with a
 * comparator: that would decouple row order from the `saldo_acumulado`
 * computed for the backend's ASC walk.
 *
 * D6, task 9.4 — the "Registrar cobro" action is OFFERED only when
 * `saldo > 0`. It is ABSENT, not disabled, when there is nothing to
 * collect: `saldo <= 0` means either "al día" (0) or "a favor" (<0), and
 * `POST /api/cobros` rejects a payment for a customer with no live fiados
 * outright — a form that can only fail teaches the user the app is broken.
 */
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { SaldoBadge } from '@features/cuenta-corriente/components/SaldoBadge'
import { TablaVentasFiadas } from './TablaVentasFiadas'
import { CobroFormDialog } from './CobroFormDialog'
import { HistorialTable, type HistorialTipoConfig } from '@shared/components/HistorialTable/HistorialTable'
import { Card } from '@shared/components/Card/Card'
import { CLIENTE_KEYS } from '../api/clientesHooks'
import type { CuentaCorrienteClienteResponse } from '@shared/api/api'

type Tab = 'fiados' | 'historial'
type HistorialOrder = 'asc' | 'desc'

const TAB_LABELS: Record<Tab, string> = {
  fiados: 'Fiados',
  historial: 'Historial',
}

const PANEL_TITLES: Record<Tab, string> = {
  fiados: 'Fiados con estado',
  historial: 'Historial cronológico',
}

const HISTORIAL_CLIENTE_CONFIG: Record<string, HistorialTipoConfig> = {
  VENTA: { label: 'Debe', lado: 'debe', archivoTitulo: 'Comprobante de venta' },
  COBRO: { label: 'Haber', lado: 'haber', archivoTitulo: 'Comprobante de cobro' },
}

interface CuentaCorrienteClienteProps {
  cuentaCorriente: CuentaCorrienteClienteResponse
  /** Test-only override — production always starts on 'desc' (newest first). */
  historialOrderDefault?: HistorialOrder
}

function TabPill({ tab, active, onSelect }: { tab: Tab; active: boolean; onSelect: (tab: Tab) => void }) {
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

function OrderToggle({ order, onChange }: { order: HistorialOrder; onChange: (order: HistorialOrder) => void }) {
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

export function CuentaCorrienteCliente({
  cuentaCorriente,
  historialOrderDefault = 'desc',
}: CuentaCorrienteClienteProps) {
  const [tab, setTab] = useState<Tab>('fiados')
  const [historialOrder, setHistorialOrder] = useState<HistorialOrder>(historialOrderDefault)
  const [cobroDialogOpen, setCobroDialogOpen] = useState(false)
  const queryClient = useQueryClient()
  const hayAlgoParaCobrar = cuentaCorriente.saldo > 0

  function invalidateAccount() {
    void queryClient.invalidateQueries({
      queryKey: CLIENTE_KEYS.cuentaCorriente(cuentaCorriente.cliente_id),
    })
  }

  // Display-only reversal of a COPY. Never a value-based re-sort — see the
  // block comment above this component (C-24 critical invariant, inherited
  // from CuentaCorrientePage).
  const displayedHistorial = useMemo(
    () =>
      historialOrder === 'desc'
        ? [...cuentaCorriente.historial].reverse()
        : cuentaCorriente.historial,
    [cuentaCorriente.historial, historialOrder],
  )

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-12 md:items-start">
      <section aria-label="Saldo" className="md:col-span-4">
        <Card className="flex flex-col gap-2.5">
          <p className="font-inter text-xs font-semibold uppercase tracking-wider text-ink-soft">
            Saldo
          </p>
          <SaldoBadge saldo={cuentaCorriente.saldo} />
          <p className="text-xs leading-relaxed text-ink-soft">
            Calculado al momento a partir de fiados y cobros. Se actualiza
            automáticamente.
          </p>

          {hayAlgoParaCobrar ? (
            <button
              type="button"
              onClick={() => setCobroDialogOpen(true)}
              className="mt-2 inline-flex items-center justify-center gap-2 rounded-pill bg-violet-500 px-5 py-2.5 font-inter text-sm font-semibold text-white transition-all duration-200 hover:bg-violet-600 active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" />
              Registrar cobro
            </button>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-ink-soft">
              {cuentaCorriente.saldo === 0
                ? 'El cliente está al día — no hay nada para cobrar.'
                : 'El cliente tiene un saldo a favor — no hay nada para cobrar.'}
            </p>
          )}
        </Card>
      </section>

      <section aria-label={PANEL_TITLES[tab]} className="md:col-span-8">
        <Card>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-inter text-base font-semibold text-ink">
              {PANEL_TITLES[tab]}
            </h2>
            <div className="flex gap-0.5 rounded-pill bg-page p-[3px]">
              <TabPill tab="fiados" active={tab === 'fiados'} onSelect={setTab} />
              <TabPill tab="historial" active={tab === 'historial'} onSelect={setTab} />
            </div>
          </div>

          {tab === 'historial' && (
            <div className="mb-3 flex justify-end">
              <OrderToggle order={historialOrder} onChange={setHistorialOrder} />
            </div>
          )}

          {tab === 'fiados' && <TablaVentasFiadas fiados={cuentaCorriente.ventas_con_estado} />}
          {tab === 'historial' && (
            <HistorialTable historial={displayedHistorial} tipoConfig={HISTORIAL_CLIENTE_CONFIG} />
          )}
        </Card>
      </section>

      {hayAlgoParaCobrar && (
        <CobroFormDialog
          open={cobroDialogOpen}
          clienteId={cuentaCorriente.cliente_id}
          saldo={cuentaCorriente.saldo}
          onSuccess={() => {
            setCobroDialogOpen(false)
            invalidateAccount()
          }}
          onCancel={() => setCobroDialogOpen(false)}
          onAccountInvalidate={invalidateAccount}
        />
      )}
    </div>
  )
}

export default CuentaCorrienteCliente
