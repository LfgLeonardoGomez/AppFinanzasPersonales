/**
 * ProveedorDialog — accessible create/edit form for a supplier (C-20).
 *
 * Wraps the existing ProveedorForm in a Radix Dialog so the modal gets
 * focus trap, Esc-to-close, aria-modal, and portal mount for free.
 *
 * Migration of the previous custom modal pattern (C-07) to a Radix
 * Dialog. The destructive confirmation flow (DeleteProveedorDialog)
 * is migrated separately (C-20, Phase 6) to a Radix AlertDialog.
 *
 * Redesign (design/screen-proveedores — "Proveedor Form" handoff): in edit
 * mode, ProveedorForm renders an "Eliminar proveedor" button. Clicking it
 * opens the existing DeleteProveedorDialog on top (Radix layers dialogs
 * correctly — Esc/outside-click only dismiss the topmost one). Confirming
 * reuses the existing `useDeleteProveedor` mutation — no new API — and
 * calls `onCancel()` on success to close the whole flow.
 */
import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ProveedorForm } from './ProveedorForm'
import { DeleteProveedorDialog } from './DeleteProveedorDialog'
import { useDeleteProveedor } from '../api/proveedoresHooks'
import { toast } from '@shared/components/Toaster/toast'
import type { Proveedor } from '@shared/api/api'

interface ProveedorDialogProps {
  mode: 'create' | 'edit'
  proveedor?: Proveedor | null
  open: boolean
  onSuccess: (saved: Proveedor) => void
  onCancel: () => void
}

export function ProveedorDialog({
  mode,
  proveedor,
  open,
  onSuccess,
  onCancel,
}: ProveedorDialogProps) {
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false)
  const deleteMutation = useDeleteProveedor()

  function handleConfirmDelete() {
    if (!proveedor) return
    deleteMutation.mutate(proveedor.id, {
      onSuccess: () => {
        setConfirmDeleteOpen(false)
        toast.success(`Proveedor "${proveedor.nombre}" eliminado.`)
        onCancel()
      },
    })
  }

  return (
    <>
      <Dialog.Root
        open={open}
        onOpenChange={(next) => {
          if (!next) onCancel()
        }}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm dark:bg-black/40" />
          <Dialog.Content
            aria-label="Formulario de proveedor"
            aria-modal="true"
            // max-h + overflow: centring with -translate-y-1/2 and no height
            // cap pushes content off-screen in BOTH directions when the form
            // is taller than the viewport (clipped heading, half-visible
            // button). dvh — not vh — because the mobile address bar and the
            // on-screen keyboard shrink the usable height precisely while the
            // user is filling this form.
            className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto p-4 focus:outline-none"
          >
            <Dialog.Title className="sr-only">Formulario de proveedor</Dialog.Title>
            <Dialog.Description className="sr-only">
              {mode === 'create' ? 'Crear un nuevo proveedor' : 'Editar proveedor existente'}
            </Dialog.Description>
            {mode === 'edit' && proveedor ? (
              <ProveedorForm
                proveedor={proveedor}
                onSuccess={onSuccess}
                onCancel={onCancel}
                onDeleteClick={() => setConfirmDeleteOpen(true)}
              />
            ) : (
              <ProveedorForm onSuccess={onSuccess} onCancel={onCancel} />
            )}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <DeleteProveedorDialog
        open={confirmDeleteOpen}
        proveedor={proveedor ?? null}
        hasDependencies={false}
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmDeleteOpen(false)}
      />
    </>
  )
}

export default ProveedorDialog
