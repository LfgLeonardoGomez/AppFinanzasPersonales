/**
 * SupplierMatchControl — shared supplier picker for the IA proposal
 * field groups (C-21, D4/D5).
 *
 * Wraps `SupplierSearch` (C-07) with two additions specific to the IA
 * confirm flow:
 *   1. Auto-match (D4): on a normalized-exact UNIQUE hit against the
 *      detected `proveedor_nombre` (via `useAutoMatchProveedor`), the
 *      match is pre-selected automatically — but stays fully
 *      changeable (the user can clear it and pick/search a different
 *      supplier; RN-IA-06 still requires an explicit human confirm to
 *      persist).
 *   2. Inline create (D5): when there is NO match (partial, multiple,
 *      or zero hits) and the IA detected a name, an inline "Crear «X»"
 *      action appears with the detected name pre-filled and editable.
 *      Confirming it calls `useCreateProveedor` with
 *      `{ nombre, categoria: 'OTRO' }` and selects the created
 *      supplier — no navigation away from the modal.
 *
 * Shared between `PropuestaFacturaFields` and `PropuestaPagoFields` so
 * both paths behave identically (no copy-paste divergence — mirrors
 * the D2 rationale for `buildCreatePayload`).
 */
import { useEffect, useState } from 'react'
import { SupplierSearch } from '@shared/components/SupplierSearch/SupplierSearch'
import { useCreateProveedor } from '@features/proveedores/api/proveedoresHooks'
import { useAutoMatchProveedor } from '../hooks/useAutoMatchProveedor'
import type { ProveedorListItem } from '@shared/api/api'

export interface SupplierMatchControlProps {
  /** The name the IA detected (null when the IA didn't read one). */
  proveedorNombre: string | null
  selectedProveedor: ProveedorListItem | null
  onProveedorChange: (proveedor: ProveedorListItem | null) => void
}

export function SupplierMatchControl({
  proveedorNombre,
  selectedProveedor,
  onProveedorChange,
}: SupplierMatchControlProps) {
  const autoMatch = useAutoMatchProveedor(proveedorNombre)
  const createMutation = useCreateProveedor()
  const [editableName, setEditableName] = useState(proveedorNombre ?? '')

  // Keep the editable inline-create name in sync when a new proposal
  // (a different detected name) comes in.
  useEffect(() => {
    setEditableName(proveedorNombre ?? '')
  }, [proveedorNombre])

  // Pre-select on a unique normalized-exact match. Only fires while
  // nothing is selected yet, so it never clobbers a user's manual pick
  // or a later inline-create.
  useEffect(() => {
    if (autoMatch.status === 'matched' && selectedProveedor === null) {
      onProveedorChange(autoMatch.proveedor)
    }
  }, [autoMatch, selectedProveedor, onProveedorChange])

  function handleCreate(): void {
    const nombre = editableName.trim()
    if (!nombre || createMutation.isPending) return
    createMutation.mutate(
      { nombre, categoria: 'OTRO' },
      {
        onSuccess: (created) => onProveedorChange(created as ProveedorListItem),
      },
    )
  }

  const showInlineCreate =
    selectedProveedor === null && autoMatch.status === 'no-match' && Boolean(proveedorNombre)

  return (
    <div>
      <label className="block text-xs font-medium text-slate-600 mb-1">Proveedor</label>
      <SupplierSearch
        value={selectedProveedor}
        onChange={onProveedorChange}
        placeholder="Buscar proveedor…"
      />
      {proveedorNombre ? (
        <p className="text-xs text-slate-500 mt-1">
          Detectado por IA: <span className="font-medium">{proveedorNombre}</span>
        </p>
      ) : null}
      {showInlineCreate ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            aria-label="Nombre del proveedor a crear"
            value={editableName}
            onChange={(e) => setEditableName(e.target.value)}
            className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/10"
          />
          <button
            type="button"
            onClick={handleCreate}
            disabled={createMutation.isPending || !editableName.trim()}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Creando…' : `Crear «${editableName.trim()}»`}
          </button>
          {createMutation.isError ? (
            <p role="alert" className="text-xs text-rose-600">
              Error al crear proveedor. Intentá de nuevo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
