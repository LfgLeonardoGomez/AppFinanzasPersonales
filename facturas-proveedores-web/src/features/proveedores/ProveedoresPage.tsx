/**
 * ProveedoresPage — route entry point for supplier management.
 *
 * Composes ProveedoresList + ProveedorForm (modal) + DeleteProveedorDialog.
 * Modal open/close state is local to this page (D-C07-3).
 *
 * Route: /proveedores (private, behind RequireAuthWithBootstrap)
 */
import { useState } from 'react'
import ProveedoresList from './components/ProveedoresList'
import ProveedorForm from './components/ProveedorForm'
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
        : `Proveedor "${saved.nombre}" creado exitosamente.`
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {successMessage && (
        <SuccessMessage message={successMessage} onDismiss={() => setSuccessMessage(null)} />
      )}
      <ProveedoresList
        onNewProveedor={openCreate}
        onEditProveedor={openEdit}
      />

      {(modalMode === 'create' || modalMode === 'edit') && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Formulario de proveedor"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm dark:bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal()
          }}
        >
          <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
            {editTarget ? (
              <ProveedorForm
                proveedor={editTarget}
                onSuccess={handleFormSuccess}
                onCancel={closeModal}
              />
            ) : (
              <ProveedorForm
                onSuccess={handleFormSuccess}
                onCancel={closeModal}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default ProveedoresPage
