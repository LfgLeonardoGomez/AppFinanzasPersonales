/**
 * ProveedorDialog — accessible create/edit form for a supplier (C-20).
 *
 * Wraps the existing ProveedorForm in a Radix Dialog so the modal gets
 * focus trap, Esc-to-close, aria-modal, and portal mount for free.
 *
 * Migration of the previous custom modal pattern (C-07) to a Radix
 * Dialog. The destructive confirmation flow (DeleteProveedorDialog)
 * is migrated separately (C-20, Phase 6) to a Radix AlertDialog.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { ProveedorForm } from './ProveedorForm'
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
  return (
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
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-4 focus:outline-none"
        >
          <Dialog.Title className="sr-only">Formulario de proveedor</Dialog.Title>
          <Dialog.Description className="sr-only">
            {mode === 'create' ? 'Crear un nuevo proveedor' : 'Editar proveedor existente'}
          </Dialog.Description>
          {mode === 'edit' && proveedor ? (
            <ProveedorForm proveedor={proveedor} onSuccess={onSuccess} onCancel={onCancel} />
          ) : (
            <ProveedorForm onSuccess={onSuccess} onCancel={onCancel} />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default ProveedorDialog
