/**
 * CuentaCorrientePage — premium composition of the three blocks (C-13, D7).
 *
 * Preserves all test contracts:
 *  - data-testid="cuenta-corriente-page"
 *  - grid layout md:grid-cols-12
 *  - section aria-label="Saldo", "Facturas con estado", "Historial cronológico"
 *  - "Sin movimientos registrados." text
 */
import { useState } from 'react'
import { SaldoBadge } from './components/SaldoBadge'
import { TablaFacturasConEstado } from './components/TablaFacturasConEstado'
import { HistorialCronologico } from './components/HistorialCronologico'
import { Card } from '@shared/components/Card/Card'
import type {
  CuentaCorrienteResponse,
  FiltrosFacturas as FiltrosFacturasType,
} from '@shared/api/api'

interface CuentaCorrientePageProps {
  cuentaCorriente: CuentaCorrienteResponse
}

function isEmptyTriple(cc: CuentaCorrienteResponse): boolean {
  return (
    cc.saldo === 0 &&
    cc.facturas_con_estado.length === 0 &&
    cc.historial.length === 0
  )
}

export function CuentaCorrientePage({ cuentaCorriente }: CuentaCorrientePageProps) {
  const [filters, setFilters] = useState<FiltrosFacturasType>({})

  if (isEmptyTriple(cuentaCorriente)) {
    return (
      <div
        data-testid="cuenta-corriente-page"
        className="flex flex-col gap-6"
      >
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
            Saldo
          </p>
          <div className="mt-2">
            <SaldoBadge saldo={cuentaCorriente.saldo} />
          </div>
        </Card>

        <Card>
          <p role="status" className="text-sm text-navy-500 dark:text-zinc-400">
            Sin movimientos registrados.
          </p>
        </Card>
      </div>
    )
  }

  return (
    <div
      data-testid="cuenta-corriente-page"
      className="grid grid-cols-1 gap-6 md:grid-cols-12"
    >
      <section
        aria-label="Saldo"
        className="md:col-span-4 md:row-span-2"
      >
        <Card className="h-full">
          <p className="text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
            Saldo
          </p>
          <div className="mt-3">
            <SaldoBadge saldo={cuentaCorriente.saldo} />
          </div>
          <p className="mt-3 text-xs leading-relaxed text-navy-400 dark:text-zinc-500">
            Calculado al momento. Se actualiza automáticamente al cargar
            facturas o pagos.
          </p>
        </Card>
      </section>

      <section
        aria-label="Facturas con estado"
        className="md:col-span-8"
      >
        <Card>
          <h2 className="mb-4 font-serif text-base font-semibold text-navy-800 dark:text-zinc-100">
            Facturas con estado
          </h2>
          <TablaFacturasConEstado
            facturas={cuentaCorriente.facturas_con_estado}
            filters={filters}
            onChangeFilters={setFilters}
          />
        </Card>
      </section>

      <section
        aria-label="Historial cronológico"
        className="md:col-span-8"
      >
        <Card>
          <h2 className="mb-4 font-serif text-base font-semibold text-navy-800 dark:text-zinc-100">
            Historial cronológico
          </h2>
          <HistorialCronologico historial={cuentaCorriente.historial} />
        </Card>
      </section>
    </div>
  )
}

export default CuentaCorrientePage
