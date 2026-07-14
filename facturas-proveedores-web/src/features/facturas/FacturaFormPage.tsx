/**
 * FacturaFormPage — route entry for create (/facturas/nueva) and edit (/facturas/:id/editar).
 *
 * Uses the id param to determine mode:
 *   - No id → create mode (POST /api/facturas)
 *   - id present → edit mode (GET /api/facturas/{id} + PATCH)
 *
 * Route: /facturas/nueva and /facturas/:id/editar (private, behind RequireAuthWithBootstrap)
 *
 * C-13 (D8 / Q-CC-FE-02): the create form reads `?proveedor_id=` from the
 * search params. If present, the page pre-fetches the supplier via
 * `useProveedor(proveedorId)` and passes it as `initialSelectedProveedor`
 * to the form. The form's `SupplierSearch` still allows clearing and
 * picking a different supplier — the pre-fill is purely additive.
 *
 * C-15: the create page also renders the "Cargar con imagen (IA)" button
 * (hidden in edit mode) that opens the `PropuestaIAModal` scoped to the
 * invoice flow. On confirm, the proposal + the user-picked supplier are
 * passed to the form as `prefillFromProposal`; the form syncs its state
 * and tags the create payload with `origen: 'IA'` (OQ-1 RESOLVED via
 * c-15a — Path B).
 */
import { useState } from 'react'
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { FacturaForm } from './components/FacturaForm'
import { useFactura, useCreateFactura, useUpdateFactura } from './api/facturasHooks'
import { useProveedor } from '@features/proveedores/api/proveedoresHooks'
import { PropuestaIAModal } from '@features/ia-vision/components/PropuestaIAModal'
import type { FacturaResponse, PropuestaFactura, PropuestaPago, ProveedorListItem } from '@shared/api/api'

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
        onSuccess={handleSuccess}
        onCancel={() => void navigate('/facturas')}
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
        Cargar factura
      </h1>
      <p className="mb-8 text-center text-sm text-navy-400 dark:text-zinc-500">
        Elegí cómo querés cargar la factura
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
            <p className="text-sm text-navy-400 dark:text-zinc-500">Sacá una foto o subí una imagen y la IA extrae los datos automáticamente</p>
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
            <p className="text-sm text-navy-400 dark:text-zinc-500">Completá los datos de la factura a mano</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-navy-300 transition-transform group-hover:translate-x-0.5 dark:text-zinc-600"><path d="m9 18 6-6-6-6"/></svg>
        </button>
      </div>
    </div>
  )
}

function CreateFacturaPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const prefillProveedorId = searchParams.get('proveedor_id') ?? ''
  const proveedorQuery = useProveedor(prefillProveedorId)

  const createMutation = useCreateFactura()
  const updateMutation = useUpdateFactura()

  const [mode, setMode] = useState<'selector' | 'form' | 'ia'>('selector')
  const [iaPrefill, setIaPrefill] = useState<{
    propuesta: PropuestaFactura
    selectedProveedor: ProveedorListItem
  } | null>(null)

  function handleSuccess(_saved: FacturaResponse) {
    void navigate('/facturas', {
      state: { successMessage: 'Factura creada exitosamente.' },
    })
  }

  function handleIAConfirm(propuesta: PropuestaFactura | PropuestaPago, selectedProveedor: ProveedorListItem) {
    setIaPrefill({ propuesta: propuesta as PropuestaFactura, selectedProveedor })
    setMode('form')
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
          <h1 className="mb-4 text-xl font-semibold text-navy-800 dark:text-zinc-100">Cargar factura</h1>
          <FacturaForm
            onSuccess={handleSuccess}
            onCancel={() => void navigate('/facturas')}
            initialSelectedProveedor={proveedorQuery.data ?? null}
            prefillFromProposal={iaPrefill}
            externalCreateMutation={createMutation}
            externalUpdateMutation={updateMutation}
          />
        </>
      )}
      <PropuestaIAModal
        open={mode === 'ia'}
        tipo="factura"
        onClose={() => setMode('selector')}
        onConfirm={handleIAConfirm}
        onManualLoad={() => setMode('form')}
      />
    </div>
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
