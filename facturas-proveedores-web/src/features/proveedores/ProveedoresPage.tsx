/**
 * ProveedoresPage — route entry point for supplier management.
 *
 * Composes ProveedoresList + ProveedorDialog (C-20) + DeleteProveedorDialog.
 * Modal open/close state is local to this page (D-C07-3).
 *
 * Route: /proveedores (private, behind RequireAuthWithBootstrap)
 */
import { useState } from 'react'
import ProveedoresList from './components/ProveedoresList'
import { ProveedorDialog } from './components/ProveedorDialog'
import { SuccessMessage } from '@shared/components/SuccessMessage/SuccessMessage'
import type { ProveedorListItem, Proveedor } from '@shared/api/api'

type ModalMode = 'closed' | 'create' | 'edit'

export function ProveedoresPage() {
  const [modalMode, setModalMode] = useState<ModalMode>('closed')
  const [editTarget, setEditTarget] = useState<Proveedor | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)

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
    setSuccessMessage(
      editTarget
        ? `Proveedor "${saved.nombre}" actualizado exitosamente.`
        : `Proveedor "${saved.nombre}" creado exitosamente.`,
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {successMessage && (
        <SuccessMessage message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}
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
