/**
 * DeleteProveedorDialog — destructive confirmation for supplier deletion (C-20).
 *
 * Migrated from a custom modal to Radix Dialog with role="alertdialog"
 * (the visual + behavioral pattern of a destructive confirmation).
 *
 * The destructive pattern requires:
 *   - role="alertdialog" (semantic) with aria-modal="true" and
 *     aria-label="Confirmar eliminación".
 *   - Initial focus on the Cancelar button (safer than focusing the
 *     destructive action).
 *   - Backdrop click does NOT close the dialog (the user must explicitly
 *     choose Confirmar or Cancelar).
 *   - Esc closes (handled by Radix) and returns focus to the trigger.
 *
 * Why Dialog + role=alertdialog instead of @radix-ui/react-alert-dialog:
 * the AlertDialog component intentionally omits onPointerDownOutside and
 * onInteractOutside so backdrop dismissal cannot be disabled — that is
 * the right call for accessibility on non-destructive flows, but for
 * destructive confirmations the spec requires the user to make an
 * explicit choice, so we use Dialog with the alertdialog role and
 * suppress the dismiss handlers ourselves.
 *
 * Business rule RN-PROV-04: only shown when the supplier has active
 * invoices or payments (tiene_dependencias=true). When hasDependencies is
 * false, this dialog is NOT rendered by the parent (the delete proceeds
 * silently).
 */
import * as Dialog from '@radix-ui/react-dialog'
import type { Proveedor } from '@shared/api/api'

interface DeleteProveedorDialogProps {
  open: boolean
  proveedor: Proveedor | null
  hasDependencies: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function DeleteProveedorDialog({
  open,
  proveedor,
  hasDependencies,
  onConfirm,
  onCancel,
}: DeleteProveedorDialogProps) {
  if (!open || !proveedor) return null

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
          role="alertdialog"
          aria-modal="true"
          aria-label="Confirmar eliminación"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const cancel = document.querySelector<HTMLButtonElement>(
              '[data-testid="delete-dialog-cancel"]',
            )
            cancel?.focus()
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          // max-h-[90dvh] + overflow-y-auto: same viewport-fit contract as the
          // other dialogs (c-23). Content is short today, so this is a guard
          // against growth, not a fix for an observed clip.
          className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-full max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle focus:outline-none dark:bg-card-dark dark:ring-white/10"
        >
          <Dialog.Title className="mb-2 font-inter text-lg font-semibold text-ink dark:text-zinc-100">
            Eliminar proveedor
          </Dialog.Title>

          <Dialog.Description className="text-sm text-ink-soft-2 dark:text-zinc-300">
            ¿Querés eliminar a <strong>{proveedor.nombre}</strong>?
          </Dialog.Description>

          {hasDependencies && (
            <p role="alert" className="mt-3 text-sm text-danger">
              Este proveedor tiene facturas o pagos asociados. La eliminación es permanente.
              ¿Confirmar eliminación?
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              data-testid="delete-dialog-cancel"
              onClick={onCancel}
              className="rounded-pill px-5 py-2.5 font-inter text-sm font-semibold text-ink-soft-2 transition-colors hover:bg-page dark:text-zinc-300 dark:hover:bg-white/[0.04]"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="delete-dialog-confirm"
              onClick={onConfirm}
              className="rounded-pill bg-danger px-5 py-2.5 font-inter text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-danger/90 hover:shadow-[0_6px_20px_rgba(220,38,38,0.28)] active:scale-[0.98]"
            >
              Confirmar
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default DeleteProveedorDialog
