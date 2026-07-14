/**
 * DeleteProveedorDialog — confirmation modal for supplier deletion.
 *
 * Business rule RN-PROV-04: if the supplier has active invoices or payments
 * (tiene_dependencias=true), the user must explicitly confirm the deletion.
 * If there are no dependencies, this dialog is NOT shown (delete proceeds silently).
 *
 * The deletion is NOT blocked by dependencies — it's a confirmation only.
 */
import type { Proveedor } from '@shared/api/api'

interface DeleteProveedorDialogProps {
  /** Whether the dialog is visible */
  open: boolean
  /** The supplier to be deleted */
  proveedor: Proveedor | null
  /** Whether the supplier has active invoices or payments */
  hasDependencies: boolean
  /** Called when user confirms deletion */
  onConfirm: () => void
  /** Called when user cancels */
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-4 backdrop-blur-sm dark:bg-black/40"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-[0_8px_32px_rgba(10,37,64,0.12)] ring-1 ring-black/[0.04] dark:bg-espresso dark:shadow-[0_8px_32px_rgba(0,0,0,0.4)] dark:ring-white/10"
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="delete-dialog-title"
          className="mb-2 font-serif text-lg font-semibold text-navy-800 dark:text-zinc-100"
        >
          Eliminar proveedor
        </h2>

        <p className="text-sm text-navy-600 dark:text-zinc-300">
          ¿Querés eliminar a <strong>{proveedor.nombre}</strong>?
        </p>

        {hasDependencies && (
          <p role="alert" className="mt-3 text-sm text-danger">
            Este proveedor tiene facturas o pagos asociados. La eliminación es permanente.
            ¿Confirmar eliminación?
          </p>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-full px-5 py-2.5 text-sm font-semibold text-navy-600 transition-colors hover:bg-cream-dark dark:text-zinc-300 dark:hover:bg-white/[0.04]"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-full bg-danger px-5 py-2.5 text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-danger/90 hover:shadow-[0_6px_20px_rgba(220,38,38,0.28)] active:scale-[0.98]"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  )
}

export default DeleteProveedorDialog
