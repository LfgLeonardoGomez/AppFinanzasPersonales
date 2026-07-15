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
import { toast } from '@shared/components/Toaster/toast'
import type { ProveedorListItem, Proveedor } from '@shared/api/api'

type ModalMode = 'closed' | 'create' | 'edit'

export function ProveedoresPage() {
  const [modalMode, setModalMode] = useState<ModalMode>('closed')
  const [editTarget, setEditTarget] = useState<Proveedor | null>(null)

  function openCreate() {
    setEditTarget(null)
    setModalMode('create')
  }

  function openEdit(proveedor: ProveedorListItem) {
    setEditTarget(proveedor as Proveedor)
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
