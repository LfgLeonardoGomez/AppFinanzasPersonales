/**
 * DeudaDesapareceDialog — the disappearing-debt warning (C-34, design.md D5).
 *
 * "This is the reason the change exists." It fires on exactly two paths, and
 * only when the sale being acted on is currently `CUENTA_CORRIENTE`:
 *   1. deleting a sale on account (`mode="delete"`);
 *   2. saving an edit whose resulting `forma_pago` is anything other than
 *      `CUENTA_CORRIENTE` (`mode="leave"`).
 *
 * Deleting a sale that is NOT on account uses a different, ordinary
 * confirmation with no debt paragraph — that dialog lives in `VentasList`,
 * not here (design.md D5, spec "a cash sale is confirmed without the debt
 * warning").
 *
 * Copy is quoted VERBATIM from design.md D5:
 *  - It names the amount and the person — "¿Estás seguro?" tells the user
 *    nothing they did not already know.
 *  - The confirm button says what happens, not "Confirmar".
 *  - The second paragraph is the C-35 consequence in plain language
 *    (design.md D6): a signed balance that may legitimately go negative once
 *    the charge is gone but the payments against it remain.
 *
 * Accessibility mirrors `DeleteProveedorDialog` (RN-PROV-04): Radix `Dialog`
 * with `role="alertdialog"`, initial focus forced onto Cancelar, backdrop and
 * outside-interaction dismissal suppressed, Esc still closes via Radix.
 */
import * as Dialog from '@radix-ui/react-dialog'
import { formatMonto } from '@shared/utils/currency'
import { FORMA_PAGO_LABELS } from '../utils/formaPagoLabels'
import type { FormaPago } from '@shared/api/api'

interface DeudaDesapareceDialogPropsBase {
  open: boolean
  clienteNombre: string
  monto: string | number
  onConfirm: () => void
  onCancel: () => void
  isPending?: boolean
  /**
   * Review fix (finding B): a failed delete/leave request used to just
   * re-enable the buttons and say nothing — the shopkeeper could believe a
   * fiado debt was gone when it was not. Mirrors `VentaForm`'s
   * `errors.backend` + `role="alert"` pattern. Accepts `null` too (not just
   * `undefined`) so callers can pass a `useState<string | null>` slot
   * directly under `exactOptionalPropertyTypes`.
   */
  error?: string | null
}

interface DeleteModeProps extends DeudaDesapareceDialogPropsBase {
  mode: 'delete'
  formaPagoNueva?: never
}

interface LeaveModeProps extends DeudaDesapareceDialogPropsBase {
  mode: 'leave'
  formaPagoNueva: FormaPago
}

type DeudaDesapareceDialogProps = DeleteModeProps | LeaveModeProps

export function DeudaDesapareceDialog(props: DeudaDesapareceDialogProps) {
  const { open, mode, clienteNombre, monto, onConfirm, onCancel, isPending = false, error } = props
  if (!open) return null

  const montoFormateado = formatMonto(monto)

  const titulo = mode === 'delete' ? 'Eliminar venta fiada' : 'Sacar la venta de cuenta corriente'
  const confirmLabel = mode === 'delete' ? 'Eliminar y quitar la deuda' : 'Cambiar y quitar la deuda'

  const primerParrafo =
    mode === 'delete' ? (
      <>
        Esta venta está en la cuenta corriente de <strong>{clienteNombre}</strong>. Si la eliminás,{' '}
        <strong>{montoFormateado}</strong> dejan de figurar como deuda suya.
      </>
    ) : (
      <>
        Esta venta figura como fiado de <strong>{clienteNombre}</strong> por{' '}
        <strong>{montoFormateado}</strong>. Al cambiarla a {FORMA_PAGO_LABELS[props.formaPagoNueva]},
        ese monto deja de ser deuda suya.
      </>
    )

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
          aria-label={titulo}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const cancel = document.querySelector<HTMLButtonElement>(
              '[data-testid="deuda-dialog-cancel"]',
            )
            cancel?.focus()
          }}
          onPointerDownOutside={(event) => event.preventDefault()}
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card bg-surface p-6 shadow-card ring-1 ring-border-subtle focus:outline-none dark:bg-card-dark dark:ring-white/10"
        >
          <Dialog.Title className="mb-3 font-inter text-lg font-semibold text-ink dark:text-zinc-100">
            {titulo}
          </Dialog.Title>

          <Dialog.Description className="font-inter text-sm leading-relaxed text-ink-soft-2 dark:text-zinc-300">
            {primerParrafo}
          </Dialog.Description>

          <p className="mt-3 font-inter text-sm leading-relaxed text-ink-soft-2 dark:text-zinc-300">
            Los cobros que ya registraste no se borran. Si ya te pagó una parte, su saldo puede
            quedar a favor.
          </p>

          {mode === 'delete' && (
            <p className="mt-3 font-inter text-sm leading-relaxed text-ink-soft-2 dark:text-zinc-300">
              Hacelo solo si la venta nunca existió o si en realidad te la pagó en el momento.
            </p>
          )}

          {error && (
            <p
              role="alert"
              aria-live="assertive"
              className="mt-3 font-inter text-sm text-danger"
            >
              {error}
            </p>
          )}

          <div className="mt-6 flex items-center justify-end gap-3">
            <button
              type="button"
              data-testid="deuda-dialog-cancel"
              onClick={onCancel}
              disabled={isPending}
              className="rounded-pill px-5 py-2.5 font-inter text-sm font-semibold text-ink-soft-2 transition-colors hover:bg-page disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-white/[0.04]"
            >
              Cancelar
            </button>
            <button
              type="button"
              data-testid="deuda-dialog-confirm"
              onClick={onConfirm}
              disabled={isPending}
              className="rounded-pill bg-danger px-5 py-2.5 font-inter text-sm font-semibold text-white shadow-[0_4px_12px_rgba(220,38,38,0.20)] transition-all duration-200 ease-[var(--ease-out)] hover:bg-danger/90 hover:shadow-[0_6px_20px_rgba(220,38,38,0.28)] active:scale-[0.98] disabled:opacity-50"
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

export default DeudaDesapareceDialog
