/**
 * ProveedorDetailPage — supplier detail / cuenta-corriente integration
 * (C-13, D7; redesign: design/screen-proveedores — "Detalle Proveedor"
 * handoff).
 *
 * Header card: nombre/CUIT + actions (Cargar factura, Cargar pago, Editar).
 * "Editar" opens the existing ProveedorDialog in edit mode instead of
 * navigating to `/proveedores/:id/editar` (that route does not exist in
 * the router — this was a dead link in the previous version; edit has
 * always been modal-only elsewhere in the app, so this aligns the detail
 * page with the rest of the product instead of adding a new route).
 *
 * Preserves all test contracts:
 *  - data-testid="proveedor-detail-page"
 *  - 404 empty state text + link to /proveedores
 *  - "Reintentar" button on generic error
 *  - Action links: Cargar factura, Cargar pago
 *
 * TODO(carga-unificada): once the unified IA/manual carga modal (C-21)
 * lands, "Cargar factura" / "Cargar pago" should open it pre-set to
 * proveedor_id={proveedorId} instead of navigating to /facturas/nueva
 * and /pagos/nuevo.
 */
import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useProveedor } from './api/proveedoresHooks'
import { useCuentaCorriente } from '@features/cuenta-corriente/api/cuentaCorrienteHooks'
import { CuentaCorrientePage } from '@features/cuenta-corriente/CuentaCorrientePage'
import { ProveedorDialog } from './components/ProveedorDialog'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
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
  const [editOpen, setEditOpen] = useState(false)

  const proveedorQuery = useProveedor(proveedorId)
  const cuentaCorrienteQuery = useCuentaCorriente(proveedorId)

  if (proveedorQuery.isError || cuentaCorrienteQuery.isError) {
    if (
      isNotFoundError(proveedorQuery.error) ||
      isNotFoundError(cuentaCorrienteQuery.error)
    ) {
      return (
        <Card className="flex flex-col items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-card-sm bg-danger-bg text-danger ring-1 ring-danger/10">
            <ArrowLeft className="h-5 w-5" />
          </div>
          <h2 className="font-inter text-lg font-semibold text-ink dark:text-zinc-100">
            Proveedor no encontrado
          </h2>
          <p className="text-sm text-ink-soft dark:text-zinc-400">
            No se encontró el proveedor solicitado. Es posible que haya
            sido eliminado o que no tengas permiso para verlo.
          </p>
          <Link
            to="/proveedores"
            className="text-sm font-semibold text-violet-500 transition-colors hover:text-violet-600"
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
        <div className="flex h-10 w-10 items-center justify-center rounded-card-sm bg-warning-bg text-warning ring-1 ring-warning/10">
          <RefreshCw className="h-5 w-5" />
        </div>
        <h2 className="font-inter text-lg font-semibold text-ink dark:text-zinc-100">
          No se pudo cargar la cuenta corriente
        </h2>
        <p className="text-sm text-ink-soft dark:text-zinc-400">
          Hubo un error al obtener los movimientos. Reintentá en unos
          segundos.
        </p>
        <Button variant="primary" icon={<RefreshCw className="h-4 w-4" />} onClick={() => void cuentaCorrienteQuery.refetch()}>
          Reintentar
        </Button>
      </Card>
    )
  }

  if (!proveedorQuery.data) {
    return (
      <p role="alert" className="text-sm text-ink-soft dark:text-zinc-400">
        No se encontró el proveedor.
      </p>
    )
  }

  const proveedor = proveedorQuery.data

  return (
    <div data-testid="proveedor-detail-page" className="flex flex-col gap-5">
      {/* Header: supplier name + action row */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/proveedores" className="text-xs font-semibold text-ink-soft transition-colors hover:text-ink-soft-2">
              ← Proveedores
            </Link>
            <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">
              Proveedor
            </p>
            <h1 className="mt-1 font-inter text-2xl font-bold tracking-tight text-ink dark:text-zinc-100">
              {proveedor.nombre}
            </h1>
            {proveedor.cuit && (
              <p className="mt-1 text-sm text-ink-soft dark:text-zinc-400">
                CUIT {proveedor.cuit}
              </p>
            )}
          </div>
          {/* TODO(carga-unificada): once the unified IA/manual carga modal
              (C-21) lands, these should open it pre-set to
              tipo=factura|pago and proveedor_id={proveedorId} instead of
              navigating to /facturas/nueva and /pagos/nuevo. */}
          <div className="flex flex-wrap gap-2">
            <Link
              to={`/facturas/nueva?proveedor_id=${proveedorId}`}
              className="inline-flex items-center gap-2 rounded-pill bg-violet-500 px-5 py-2.5 font-inter text-sm font-semibold text-white transition-all duration-200 hover:bg-violet-600 active:scale-[0.98]"
            >
              <FileText className="h-4 w-4" />
              Cargar factura
            </Link>
            <Link
              to={`/pagos/nuevo?proveedor_id=${proveedorId}`}
              className="inline-flex items-center gap-2 rounded-pill border border-border-violet-soft bg-surface px-5 py-2.5 font-inter text-sm font-semibold text-violet-900 transition-colors hover:bg-violet-50"
            >
              <CreditCard className="h-4 w-4" />
              Cargar pago
            </Link>
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="inline-flex items-center gap-2 rounded-pill border border-border-subtle bg-surface px-5 py-2.5 font-inter text-sm font-semibold text-ink-soft-2 transition-colors hover:bg-page"
            >
              <Pencil className="h-4 w-4" />
              Editar
            </button>
          </div>
        </div>
      </Card>

      {/* Cuenta-corriente body */}
      {cuentaCorrienteQuery.data ? (
        <CuentaCorrientePage cuentaCorriente={cuentaCorrienteQuery.data} />
      ) : (
        <p role="status" className="text-sm text-ink-soft dark:text-zinc-400">
          Cargando cuenta corriente…
        </p>
      )}

      <ProveedorDialog
        mode="edit"
        proveedor={proveedor}
        open={editOpen}
        onSuccess={() => setEditOpen(false)}
        onCancel={() => setEditOpen(false)}
      />
    </div>
  )
}

export default ProveedorDetailPage
