/**
 * ProveedorDetailPage — supplier detail / cuenta-corriente integration (C-13, D7).
 *
 * Premium redesign with card layout and refined actions.
 * Preserves all test contracts:
 *  - data-testid="proveedor-detail-page"
 *  - 404 empty state text + link to /proveedores
 *  - "Reintentar" button on generic error
 *  - Action links: Cargar factura, Cargar pago, Editar proveedor
 */
import { useParams, Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useProveedor } from './api/proveedoresHooks'
import { useCuentaCorriente } from '@features/cuenta-corriente/api/cuentaCorrienteHooks'
import { CuentaCorrientePage } from '@features/cuenta-corriente/CuentaCorrientePage'
import { Card } from '@shared/components/Card/Card'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { FileText, CreditCard, Pencil, ArrowLeft, RefreshCw } from 'lucide-react'

function isNotFoundError(err: unknown): boolean {
  if (isAxiosError(err)) {
    return err.response?.status === 404
  }
  return false
}

export function ProveedorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const proveedorId = id ?? ''

  const proveedorQuery = useProveedor(proveedorId)
  const cuentaCorrienteQuery = useCuentaCorriente(proveedorId)

  if (proveedorQuery.isError || cuentaCorrienteQuery.isError) {
    if (
      isNotFoundError(proveedorQuery.error) ||
      isNotFoundError(cuentaCorrienteQuery.error)
    ) {
      return (
        <Card className="flex flex-col items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-danger-bg text-danger ring-1 ring-danger/10">
            <ArrowLeft className="h-5 w-5" />
          </div>
          <h2 className="font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
            Proveedor no encontrado
          </h2>
          <p className="text-sm text-navy-500 dark:text-zinc-400">
            No se encontró el proveedor solicitado. Es posible que haya
            sido eliminado o que no tengas permiso para verlo.
          </p>
          <Link
            to="/proveedores"
            className="text-sm font-semibold text-accent-500 transition-colors hover:text-accent-600 dark:text-accent-400"
          >
            Ir a proveedores
          </Link>
        </Card>
      )
    }
  }

  if (proveedorQuery.isLoading || cuentaCorrienteQuery.isLoading) {
    return <LoadingState label="Cargando proveedor…" />
  }

  if (cuentaCorrienteQuery.isError) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-warning-bg text-warning ring-1 ring-warning/10">
          <RefreshCw className="h-5 w-5" />
        </div>
        <h2 className="font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100">
          No se pudo cargar la cuenta corriente
        </h2>
        <p className="text-sm text-navy-500 dark:text-zinc-400">
          Hubo un error al obtener los movimientos. Reintentá en unos
          segundos.
        </p>
        <button
          type="button"
          onClick={() => void cuentaCorrienteQuery.refetch()}
          className="inline-flex items-center gap-2 rounded-full bg-navy-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all hover:bg-navy-600 active:scale-[0.98] dark:bg-accent-500 dark:hover:bg-accent-600"
        >
          <RefreshCw className="h-4 w-4" />
          Reintentar
        </button>
      </Card>
    )
  }

  if (!proveedorQuery.data) {
    return (
      <p role="alert" className="text-sm text-navy-500 dark:text-zinc-400">
        No se encontró el proveedor.
      </p>
    )
  }

  const proveedor = proveedorQuery.data

  return (
    <div data-testid="proveedor-detail-page" className="flex flex-col gap-6">
      {/* Header: supplier name + action row */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-navy-400 dark:text-zinc-500">
              Proveedor
            </p>
            <h1 className="mt-1 font-serif text-2xl font-semibold tracking-tight text-navy-800 dark:text-zinc-100">
              {proveedor.nombre}
            </h1>
            {proveedor.cuit && (
              <p className="mt-1 text-sm text-navy-400 dark:text-zinc-500">
                CUIT: {proveedor.cuit}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/facturas/nueva?proveedor_id=${proveedorId}`}
              className="inline-flex items-center gap-2 rounded-full bg-navy-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] dark:bg-accent-500 dark:hover:bg-accent-600"
            >
              <FileText className="h-4 w-4" />
              Cargar factura
            </Link>
            <Link
              to={`/pagos/nuevo?proveedor_id=${proveedorId}`}
              className="inline-flex items-center gap-2 rounded-full bg-navy-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(10,37,64,0.20)] transition-all duration-200 hover:bg-navy-600 hover:shadow-[0_6px_20px_rgba(10,37,64,0.28)] active:scale-[0.98] dark:bg-accent-500 dark:hover:bg-accent-600"
            >
              <CreditCard className="h-4 w-4" />
              Cargar pago
            </Link>
            <Link
              to={`/proveedores/${proveedorId}/editar`}
              className="inline-flex items-center gap-2 rounded-full bg-cream-dark px-4 py-2 text-sm font-semibold text-navy-600 transition-colors hover:bg-navy-100 dark:bg-white/[0.04] dark:text-zinc-300 dark:hover:bg-white/[0.08]"
            >
              <Pencil className="h-4 w-4" />
              Editar proveedor
            </Link>
          </div>
        </div>
      </Card>

      {/* Cuenta-corriente body */}
      {cuentaCorrienteQuery.data ? (
        <CuentaCorrientePage cuentaCorriente={cuentaCorrienteQuery.data} />
      ) : (
        <p role="status" className="text-sm text-navy-500 dark:text-zinc-400">
          Cargando cuenta corriente…
        </p>
      )}
    </div>
  )
}

export default ProveedorDetailPage
