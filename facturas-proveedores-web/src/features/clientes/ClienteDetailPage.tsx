/**
 * ClienteDetailPage — the customer's card (C-36, design.md D5, D12).
 *
 * Mirrors `ProveedorDetailPage`'s header-card + panel composition and its
 * loading/error branches — one level down (customer instead of supplier).
 *
 * D5 — TWO sources, on purpose: `useCliente(id)` for the name (`GET
 * /api/clientes/{id}` always reports `saldo: null`), and
 * `useCuentaCorrienteCliente(id)` for the balance, the fiados and the
 * history. `cliente.saldo` is NEVER read here — it is structurally `null`
 * on precisely the screen where a balance is the point.
 *
 * A 404 from EITHER query renders the same "cliente no encontrado" empty
 * state with a link back to `/clientes`. A non-404 failure of the account
 * query renders a retry affordance while the header still shows the
 * customer's name (the cliente query may have succeeded independently).
 */
import { useParams, Link } from 'react-router-dom'
import { isAxiosError } from 'axios'
import { useCliente } from './api/clientesHooks'
import { useCuentaCorrienteCliente } from './api/clientesHooks'
import { CuentaCorrienteCliente } from './components/CuentaCorrienteCliente'
import { Card } from '@shared/components/Card/Card'
import { Button } from '@shared/components/Button/Button'
import { LoadingState } from '@shared/components/LoadingState/LoadingState'
import { ArrowLeft, RefreshCw } from 'lucide-react'

function isNotFoundError(err: unknown): boolean {
  if (isAxiosError(err)) {
    return err.response?.status === 404
  }
  return false
}

export function ClienteDetailPage() {
  const { id } = useParams<{ id: string }>()
  const clienteId = id ?? ''

  const clienteQuery = useCliente(clienteId)
  const cuentaCorrienteQuery = useCuentaCorrienteCliente(clienteId)

  if (clienteQuery.isError || cuentaCorrienteQuery.isError) {
    if (isNotFoundError(clienteQuery.error) || isNotFoundError(cuentaCorrienteQuery.error)) {
      return (
        <Card className="flex flex-col items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-card-sm bg-danger-bg text-danger ring-1 ring-danger/10">
            <ArrowLeft className="h-5 w-5" />
          </div>
          <h2 className="font-inter text-lg font-semibold text-ink dark:text-zinc-100">
            Cliente no encontrado
          </h2>
          <p className="text-sm text-ink-soft dark:text-zinc-400">
            No se encontró el cliente solicitado. Es posible que haya sido
            eliminado o que no tengas permiso para verlo.
          </p>
          <Link
            to="/clientes"
            className="text-sm font-semibold text-violet-500 transition-colors hover:text-violet-600"
          >
            Ir a clientes
          </Link>
        </Card>
      )
    }
  }

  if (clienteQuery.isLoading) {
    return <LoadingState label="Cargando cliente…" />
  }

  if (!clienteQuery.data) {
    return (
      <p role="alert" className="text-sm text-ink-soft dark:text-zinc-400">
        No se encontró el cliente.
      </p>
    )
  }

  const cliente = clienteQuery.data

  return (
    <div data-testid="cliente-detail-page" className="flex flex-col gap-5">
      {/* Header: customer name. NEVER read cliente.saldo here (design.md D5). */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link to="/clientes" className="text-xs font-semibold text-ink-soft transition-colors hover:text-ink-soft-2">
              ← Clientes
            </Link>
            <p className="mt-2 text-[11.5px] font-semibold uppercase tracking-wider text-ink-soft">
              Cliente
            </p>
            <h1 className="mt-1 font-inter text-2xl font-bold tracking-tight text-ink dark:text-zinc-100">
              {cliente.nombre}
            </h1>
            {cliente.telefono && (
              <p className="mt-1 text-sm text-ink-soft dark:text-zinc-400">
                {cliente.telefono}
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Cuenta-corriente body */}
      {cuentaCorrienteQuery.isLoading ? (
        <p role="status" className="text-sm text-ink-soft dark:text-zinc-400">
          Cargando cuenta corriente…
        </p>
      ) : cuentaCorrienteQuery.isError ? (
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
          <Button
            variant="primary"
            icon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void cuentaCorrienteQuery.refetch()}
          >
            Reintentar
          </Button>
        </Card>
      ) : cuentaCorrienteQuery.data ? (
        <CuentaCorrienteCliente cuentaCorriente={cuentaCorrienteQuery.data} />
      ) : null}
    </div>
  )
}

export default ClienteDetailPage
