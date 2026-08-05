/**
 * FacturaFormPage — route entry for create (/facturas/nueva) and edit (/facturas/:id/editar).
 *
 * Uses the id param to determine mode:
 *   - No id → create mode (opens the unified `CargaModal`)
 *   - id present → edit mode (GET /api/facturas/{id} + PATCH, via `FacturaForm`)
 *
 * Route: /facturas/nueva and /facturas/:id/editar (private, behind RequireAuthWithBootstrap)
 *
 * C-13 (D8 / Q-CC-FE-02): the create page reads `?proveedor_id=` from the
 * search params. If present, it pre-fetches the supplier via
 * `useProveedor(proveedorId)` and passes it to `CargaModal` as
 * `initialSelectedProveedor`. The review step's supplier control still
 * allows clearing and picking a different supplier — the pre-fill is
 * purely additive.
 *
 * Carga-modal convergence (supersedes C-21's `ModeSelector` +
 * `PropuestaIAModal` split, itself superseding C-15's D-19): create mode
 * now opens `CargaModal` directly — ONE modal for both IA (image) and
 * manual origin, per `specs/design/IA_EXPERIENCE.md`. There is no more
 * mode-selector screen and no more full-page manual form for create;
 * `FacturaForm` is kept ONLY for edit mode. `CargaModal` owns both
 * `createFactura` and `createPago` so the user can toggle tipo inside —
 * this page just seeds `initialTipo="factura"`.
 */
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FacturaForm } from './components/FacturaForm'
import { useFactura, useCreateFactura } from './api/facturasHooks'
import { useCreatePago } from '@features/pagos/api/pagosHooks'
import { useProveedor } from '@features/proveedores/api/proveedoresHooks'
import { CargaModal } from '@features/ia-vision/components/CargaModal'
import type { FacturaResponse, PagoResponse, ProveedorListItem } from '@shared/api/api'

// ── Edit mode: load existing factura ─────────────────────────────────────────

function EditFacturaPage({ id }: { id: string }) {
  const { data: factura, isLoading, isError } = useFactura(id)
  const navigate = useNavigate()

  if (isLoading) {
    return <div role="status">Cargando factura…</div>
  }

  if (isError || !factura) {
    return <p role="alert">No se encontró la factura.</p>
  }

  // c-26 (D1): for the read-only supplier display, mirror PagoFormPage's
  // shape (a bare ProveedorListItem built from proveedor_nombre). Unlike
  // the pre-c-26 payment form, `nombre` never falls back to the id —
  // `FacturaForm` itself renders a neutral placeholder when this is
  // empty (soft-deleted supplier, or the name failed to resolve).
  const proveedorForDisplay: ProveedorListItem = {
    id: factura.proveedor_id,
    usuario_id: factura.usuario_id,
    nombre: factura.proveedor_nombre ?? '',
    cuit: null,
    telefono: null,
    categoria: 'OTRO',
    notas: null,
    saldo: 0,
    created_at: factura.created_at,
    updated_at: factura.updated_at,
  }

  function handleSuccess(_saved: FacturaResponse) {
    void navigate('/facturas', {
      state: { successMessage: 'Factura actualizada exitosamente.' },
    })
  }

  return (
    <div>
      <h1 className="text-xl font-semibold mb-4">Editar factura</h1>
      <FacturaForm
        factura={factura}
        proveedor={proveedorForDisplay}
        onSuccess={handleSuccess}
        onCancel={() => void navigate('/facturas')}
      />
    </div>
  )
}

// ── Create mode ───────────────────────────────────────────────────────────────

function CreateFacturaPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProveedorId = searchParams.get('proveedor_id') ?? ''
  const proveedorQuery = useProveedor(prefillProveedorId)

  const createFacturaMutation = useCreateFactura()
  const createPagoMutation = useCreatePago()

  function handleSuccess(saved: FacturaResponse | PagoResponse) {
    // After a successful create, land on the supplier's current account
    // (cuenta corriente) so the user sees the movement reflected in the ledger.
    const label = 'monto_total' in saved ? 'Factura' : 'Pago'
    void navigate(`/proveedores/${saved.proveedor_id}`, {
      state: { successMessage: `${label} creado exitosamente.` },
    })
  }

  return (
    <CargaModal
      open
      initialTipo="factura"
      onClose={() => void navigate('/facturas')}
      onCreated={handleSuccess}
      createFactura={(payload) => createFacturaMutation.mutateAsync(payload)}
      createPago={(payload) => createPagoMutation.mutateAsync(payload)}
      initialSelectedProveedor={proveedorQuery.data ?? null}
    />
  )
}

// ── Route entry ───────────────────────────────────────────────────────────────

export function FacturaFormPage() {
  const { id } = useParams<{ id?: string }>()

  if (id) {
    return <EditFacturaPage id={id} />
  }

  return <CreateFacturaPage />
}

export default FacturaFormPage
