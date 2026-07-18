/**
 * PagoFormPage — route entry for create (/pagos/nuevo) and edit (/pagos/:id/editar).
 *
 * Uses the id param to determine mode:
 *   - No id → create mode (POST /api/pagos)
 *   - id present → edit mode (GET /api/pagos/{id} + PATCH)
 *
 * Route: /pagos/nuevo and /pagos/:id/editar (private, behind RequireAuthWithBootstrap)
 *
 * C-13 (D8 / Q-CC-FE-02): the create form reads `?proveedor_id=` from the
 * search params. If present, the page pre-fetches the supplier via
 * `useProveedor(proveedorId)` and passes it as `initialSelectedProveedor`
 * to the form. The form's `SupplierSearch` still allows clearing and
 * picking a different supplier — the pre-fill is purely additive.
 *
 * C-21 (D1, D7, supersedes C-15's D-19): the create page also renders the
 * "Cargar con imagen (IA)" button (hidden in edit mode) that opens the
 * `PropuestaIAModal` scoped to the payment flow. The modal is now
 * TERMINAL — on its single "Confirmar" it uploads the read comprobante
 * image (`tipo='comprobante'`), builds the `PagoCreate` payload, and
 * fires `useCreatePago` directly (injected as `createResource`). The IA
 * path no longer falls through to the big manual form; `onCreated`
 * performs the same `/proveedores/:id` redirect as the manual path
 * (D7). The payload NEVER carries a `factura_id` (RN-PAG-01 —
 * `buildCreatePayload('pago', ...)` never sets that key).
 */
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PagoForm } from './components/PagoForm'
import { usePago, useCreatePago, useUpdatePago } from './api/pagosHooks'
import { useProveedor } from '@features/proveedores/api/proveedoresHooks'
import { PropuestaIAModal } from '@features/ia-vision/components/PropuestaIAModal'
import type { FacturaResponse, PagoCreate, PagoResponse, ProveedorListItem } from '@shared/api/api'

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
  // the UUID. When the supplier is soft-deleted, the backend returns
  // `null` and we fall back to the UUID (the previous behavior, kept
  // for the soft-deleted case).
  const proveedorForDisplay: ProveedorListItem = {
    id: pago.proveedor_id,
    usuario_id: pago.usuario_id,
    nombre: pago.proveedor_nombre ?? pago.proveedor_id,
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

function ModeSelector({
  onIa,
  onManual,
}: {
  onIa: () => void
  onManual: () => void
}) {
  return (
    <div className="mx-auto max-w-lg animate-fade-in-up">
      <h1 className="mb-2 text-center font-serif text-2xl font-semibold text-navy-800 dark:text-zinc-100">
        Cargar pago
      </h1>
      <p className="mb-8 text-center text-sm text-navy-400 dark:text-zinc-500">
        Elegí cómo querés cargar el pago
      </p>

      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={onIa}
          className="group flex items-center gap-5 rounded-2xl bg-card p-6 text-left shadow-[0_2px_8px_rgba(10,37,64,0.04)] ring-1 ring-black/[0.04] transition-all duration-300 ease-[var(--ease-out)] hover:shadow-[0_8px_24px_rgba(10,37,64,0.10)] dark:bg-card-dark dark:ring-white/10 dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.30)]"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent-500 text-white shadow-[0_2px_8px_rgba(99,91,255,0.35)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-navy-800 dark:text-zinc-100">Cargar con foto</p>
            <p className="text-sm text-navy-400 dark:text-zinc-500">Sacá una foto o subí una imagen del comprobante y la IA extrae los datos</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-navy-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600"><path d="m9 18 6-6-6-6"/></svg>
        </button>

        <button
          type="button"
          onClick={onManual}
          className="group flex items-center gap-5 rounded-2xl bg-card p-6 text-left shadow-[0_2px_8px_rgba(10,37,64,0.04)] ring-1 ring-black/[0.04] transition-all duration-300 ease-[var(--ease-out)] hover:shadow-[0_8px_24px_rgba(10,37,64,0.10)] dark:bg-card-dark dark:ring-white/10 dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.30)]"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-navy-500 text-white shadow-[0_2px_8px_rgba(10,37,64,0.25)]">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-semibold text-navy-800 dark:text-zinc-100">Cargar manual</p>
            <p className="text-sm text-navy-400 dark:text-zinc-500">Completá los datos del pago a mano</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-navy-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  )
}

function CreatePagoPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProveedorId = searchParams.get('proveedor_id') ?? ''
  const proveedorQuery = useProveedor(prefillProveedorId)

  const createMutation = useCreatePago()
  const updateMutation = useUpdatePago()

  const [mode, setMode] = useState<'selector' | 'form' | 'ia'>('selector')

  function handleSuccess(saved: PagoResponse) {
    // After a successful create, land on the supplier's current account
    // (cuenta corriente) so the user sees the payment reflected in the
    // ledger — mirrors FacturaFormPage (D7).
    void navigate(`/proveedores/${saved.proveedor_id}`, {
      state: { successMessage: 'Pago creado exitosamente.' },
    })
  }

  // C-21 (D1): the modal is terminal — it creates the pago directly via
  // `createResource` (backed by the same `createMutation` the manual
  // form uses) and reports the created resource here. No `mode='form'`
  // transition for the IA path anymore.
  function handleIACreated(created: FacturaResponse | PagoResponse) {
    handleSuccess(created as PagoResponse)
  }

  if (mode === 'selector') {
    return (
      <ModeSelector
        onIa={() => setMode('ia')}
        onManual={() => setMode('form')}
      />
    )
  }

  return (
    <div>
      {mode === 'form' && (
        <>
          <div className="mb-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMode('selector')}
              className="text-sm text-navy-500 hover:text-navy-700 dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              ← Volver
            </button>
          </div>
          <h1 className="mb-4 text-xl font-semibold text-navy-800 dark:text-zinc-100">Cargar pago</h1>
          <PagoForm
            onSuccess={handleSuccess}
            onCancel={() => void navigate('/pagos')}
            initialSelectedProveedor={proveedorQuery.data ?? null}
            prefillFromProposal={null}
            externalCreateMutation={createMutation}
            externalUpdateMutation={updateMutation}
          />
        </>
      )}
      <PropuestaIAModal
        open={mode === 'ia'}
        tipo="pago"
        onClose={() => setMode('selector')}
        onCreated={handleIACreated}
        createResource={(payload) => createMutation.mutateAsync(payload as PagoCreate)}
        onManualLoad={() => setMode('form')}
      />
    </div>
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
