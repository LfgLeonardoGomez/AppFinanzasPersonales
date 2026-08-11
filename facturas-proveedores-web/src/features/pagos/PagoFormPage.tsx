/**
 * PagoFormPage — route entry for create (/pagos/nuevo) and edit (/pagos/:id/editar).
 *
 * Uses the id param to determine mode:
 *   - No id → create mode (opens the unified `CargaModal`)
 *   - id present → edit mode (GET /api/pagos/{id} + PATCH, via `PagoForm`)
 *
 * Route: /pagos/nuevo and /pagos/:id/editar (private, behind RequireAuthWithBootstrap)
 *
 * C-13 (D8 / Q-CC-FE-02): the create page reads `?proveedor_id=` from the
 * search params. If present, it pre-fetches the supplier via
 * `useProveedor(proveedorId)` and passes it to `CargaModal` as
 * `initialSelectedProveedor`.
 *
 * Carga-modal convergence (supersedes C-21's `ModeSelector` +
 * `PropuestaIAModal` split, itself superseding C-15's D-19/D7): create
 * mode now opens `CargaModal` directly — ONE modal for both IA (image,
 * `tipo='comprobante'`) and manual origin. `PagoForm` is kept ONLY for
 * edit mode. The payload NEVER carries a `factura_id`
 * (RN-PAG-01 — enforced by `buildCreatePayload('pago', ...)`).
 */
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PagoForm } from './components/PagoForm'
import { usePago, useCreatePago } from './api/pagosHooks'
import { useCreateFactura } from '@features/facturas/api/facturasHooks'
import { useProveedor } from '@features/proveedores/api/proveedoresHooks'
import { CargaModal } from '@features/ia-vision/components/CargaModal'
import type { FacturaResponse, PagoResponse, ProveedorListItem } from '@shared/api/api'

// ── Edit mode: load existing pago ────────────────────────────────────────────

function EditPagoPage({ id }: { id: string }) {
  const { data: pago, isLoading, isError } = usePago(id)
  const navigate = useNavigate()

  if (isLoading) {
    return <div role="status">Cargando pago…</div>
  }

  if (isError || !pago) {
    return <p role="alert">No se encontró el pago.</p>
  }

  // For the read-only supplier display, use the bare ProveedorListItem shape
  // (PagoResponse carries proveedor_id; PagoForm expects a ProveedorListItem
  // with a `nombre` for the readonly view).
  //
  // C-18 (FE-005): prefer `pago.proveedor_nombre` (populated by the
  // backend service) so the user sees the supplier's actual name, not
  // the UUID.
  //
  // c-26 (D1): when the supplier is soft-deleted, the backend returns
  // `null`. This USED to fall back to `pago.proveedor_id`, which is the
  // same UUID-leak defect as the invoice form — a supplier id is never
  // a valid label. `PagoForm` renders a neutral placeholder when
  // `nombre` is empty, so we pass `''` here instead of the id.
  const proveedorForDisplay: ProveedorListItem = {
    id: pago.proveedor_id,
    nombre: pago.proveedor_nombre ?? '',
    cuit: null,
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: pago.created_at,
    updated_at: pago.updated_at,
  }

  // Build a PagoListItem from PagoResponse for the form's pre-fill path.
  // (PagoListItem is a subset — comprobante_url and updated_at are dropped
  // from the list shape but the form needs comprobante_url.)
  const pagoListItem = {
    id: pago.id,
    proveedor_id: pago.proveedor_id,
    monto: pago.monto,
    fecha: pago.fecha,
    metodo: pago.metodo,
    origen: pago.origen,
    created_at: pago.created_at,
    comprobante_url: pago.comprobante_url,
  }

  function handleSuccess(_saved: PagoResponse) {
    void navigate('/pagos', {
      state: { successMessage: 'Pago actualizado exitosamente.' },
    })
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Editar pago</h1>
      <PagoForm
        pago={pagoListItem}
        proveedor={proveedorForDisplay}
        onSuccess={handleSuccess}
        onCancel={() => void navigate('/pagos')}
      />
    </div>
  )
}

// ── Create mode ───────────────────────────────────────────────────────────────

function CreatePagoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProveedorId = searchParams.get('proveedor_id') ?? ''
  const proveedorQuery = useProveedor(prefillProveedorId)

  const createPagoMutation = useCreatePago()
  const createFacturaMutation = useCreateFactura()

  function handleSuccess(saved: FacturaResponse | PagoResponse) {
    // After a successful create, land on the supplier's current account
    // (cuenta corriente) so the user sees the movement reflected in the
    // ledger — mirrors FacturaFormPage (D7).
    const label = 'monto_total' in saved ? 'Factura' : 'Pago'
    void navigate(`/proveedores/${saved.proveedor_id}`, {
      state: { successMessage: `${label} creado exitosamente.` },
    })
  }

  return (
    <CargaModal
      open
      initialTipo="pago"
      onClose={() => void navigate('/pagos')}
      onCreated={handleSuccess}
      createFactura={(payload) => createFacturaMutation.mutateAsync(payload)}
      createPago={(payload) => createPagoMutation.mutateAsync(payload)}
      initialSelectedProveedor={proveedorQuery.data ?? null}
    />
  )
}

// ── Route entry ───────────────────────────────────────────────────────────────

export function PagoFormPage() {
  const { id } = useParams<{ id?: string }>()

  if (id) {
    return <EditPagoPage id={id} />
  }

  return <CreatePagoPage />
}

export default PagoFormPage
