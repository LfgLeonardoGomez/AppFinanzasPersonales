/**
 * VentaFormPage — route entry for create (/ventas/nueva) and edit
 * (/ventas/:id/editar), C-34.
 *
 * Uses the id param to determine mode:
 *   - No id → create mode (renders `VentaForm` directly — there is no
 *     IA-vision carga flow for sales, design.md Non-Goals)
 *   - id present → edit mode (GET /api/ventas/{id} + PATCH, via `VentaForm`)
 *
 * D3 (design.md): `Venta` carries `cliente_id` and no name. Edit mode
 * resolves the existing customer's display name from the already-cached
 * `useClientes()` list (loaded once, shared across the app) rather than a
 * per-row `GET /api/clientes/{id}` — same reasoning as the sales list.
 *
 * Review fix (finding A): `useVenta` and `useClientes` run in parallel, and
 * `VentaForm` seeds its `cliente` chip via a lazy `useState` initializer that
 * only runs once — it never re-syncs. If the venta resolved first, the form
 * used to mount with a blank customer name baked in for the rest of the
 * session. Rendering now gates on BOTH queries' `isLoading`, so `VentaForm`
 * never mounts before the real name is known. `useClientes()` is shared and
 * usually already cached by the time a user reaches this screen (see D3
 * above), so this rarely adds a visible wait.
 */
import { useNavigate, useParams } from 'react-router-dom'
import { VentaForm } from './components/VentaForm'
import { useVenta } from './api/ventasHooks'
import { useClientes } from '@features/clientes/api/clientesHooks'
import type { ClienteRef } from '@shared/components/ClienteAutocomplete/ClienteAutocomplete'
import type { Venta } from '@shared/api/api'

// ── Edit mode: load existing venta ───────────────────────────────────────────

function EditVentaPage({ id }: { id: string }) {
  const { data: venta, isLoading, isError } = useVenta(id)
  const { data: clientes, isLoading: isClientesLoading } = useClientes()
  const navigate = useNavigate()

  if (isLoading || isClientesLoading) {
    return <div role="status">Cargando venta…</div>
  }

  if (isError || !venta) {
    return <p role="alert">No se encontró la venta.</p>
  }

  const clienteInicial: ClienteRef | null = venta.cliente_id
    ? {
        id: venta.cliente_id,
        nombre: clientes?.find((c) => c.id === venta.cliente_id)?.nombre ?? '',
      }
    : null

  function handleSuccess(_saved: Venta) {
    void navigate('/ventas', {
      state: { successMessage: 'Venta actualizada exitosamente.' },
    })
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Editar venta</h1>
      <VentaForm
        venta={venta}
        clienteInicial={clienteInicial}
        onSuccess={handleSuccess}
        onCancel={() => void navigate('/ventas')}
      />
    </div>
  )
}

// ── Create mode ───────────────────────────────────────────────────────────────

function CreateVentaPage() {
  const navigate = useNavigate()

  function handleSuccess(_saved: Venta) {
    void navigate('/ventas', {
      state: { successMessage: 'Venta creada exitosamente.' },
    })
  }

  return <VentaForm onSuccess={handleSuccess} onCancel={() => void navigate('/ventas')} />
}

// ── Route entry ───────────────────────────────────────────────────────────────

export function VentaFormPage() {
  const { id } = useParams<{ id?: string }>()

  if (id) {
    return <EditVentaPage id={id} />
  }

  return <CreateVentaPage />
}

export default VentaFormPage
