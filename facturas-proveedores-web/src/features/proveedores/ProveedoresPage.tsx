/**
 * ProveedoresPage — route entry point for supplier management.
 *
 * Composes ProveedoresList + ProveedorDialog (C-20) + DeleteProveedorDialog.
 * Success messages use the global toast system (C-20) instead of the
 * deprecated SuccessMessage inline banner.
 *
 * Route: /proveedores (private, behind RequireAuthWithBootstrap)
 */
import { useState } from 'react'
import { ProveedoresList } from './components/ProveedoresList'
import { ProveedorDialog } from './components/ProveedorDialog'
import { ActividadReciente } from './components/ActividadReciente'
import { toast } from '@shared/components/Toaster/toast'
import type { ProveedorListItem, Proveedor } from '@shared/api/api'

type ModalMode = 'closed' | 'create' | 'edit'

export function ProveedoresPage() {
  const [modalMode, setModalMode] = useState<ModalMode>('closed')
  // C-41: this only ever holds a `ProveedorListItem` — the grid row passed
  // into `openEdit` — never a full `Proveedor`. It used to be typed
  // `Proveedor` via an `as` cast that "worked" only because the two types
  // were structurally identical; now that `ProveedorListItem`'s drift is
  // resolved, the cast would silently fabricate `telefono`/`notas`/
  // timestamps that were never fetched.
  const [editTarget, setEditTarget] = useState<ProveedorListItem | null>(null)

  function openCreate() {
    setEditTarget(null)
    setModalMode('create')
  }

  function openEdit(proveedor: ProveedorListItem) {
    setEditTarget(proveedor)
    setModalMode('edit')
  }

  function closeModal() {
    setModalMode('closed')
    setEditTarget(null)
  }

  function handleFormSuccess(saved: Proveedor) {
    closeModal()
    toast.success(
      editTarget
        ? `Proveedor "${saved.nombre}" actualizado exitosamente.`
        : `Proveedor "${saved.nombre}" creado exitosamente.`,
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ProveedoresList onNewProveedor={openCreate} onEditProveedor={openEdit} />

      {/* C-44: relocated from HomePage — proveedores frecuentes lands here
          in task group 5, below the list (design.md Open Question 4). */}
      <ActividadReciente />

      <ProveedorDialog
        mode={modalMode === 'edit' ? 'edit' : 'create'}
        open={modalMode !== 'closed'}
        proveedor={editTarget}
        onSuccess={handleFormSuccess}
        onCancel={closeModal}
      />
    </div>
  )
}

export default ProveedoresPage
