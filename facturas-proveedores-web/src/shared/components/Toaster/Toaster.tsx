/**
 * Toaster — global toast renderer (C-20, frontend-ui-polish).
 *
 * Wraps sonner's <Toaster /> with project-theming via CSS variables
 * defined in src/app/index.css (@theme block). Mounted exactly once
 * at the authenticated layout so all authenticated routes can fire
 * toasts via the `toast` helper from `./toast`.
 */
import { Toaster as SonnerToaster } from 'sonner'

export function Toaster() {
  return (
    <SonnerToaster
      richColors
      closeButton
      position="top-right"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-card group-[.toaster]:text-navy-800 group-[.toaster]:border-black/[0.06] group-[.toaster]:shadow-lg dark:group-[.toaster]:bg-card-dark dark:group-[.toaster]:text-zinc-100 dark:group-[.toaster]:border-white/10',
          description: 'group-[.toast]:text-navy-400 dark:group-[.toast]:text-zinc-500',
          actionButton:
            'group-[.toast]:bg-navy-500 group-[.toast]:text-white dark:group-[.toast]:bg-accent-500',
          cancelButton:
            'group-[.toast]:bg-cream-dark group-[.toast]:text-navy-600 dark:group-[.toast]:bg-white/[0.04] dark:group-[.toast]:text-zinc-300',
          success:
            'group-[.toaster]:bg-success-bg group-[.toaster]:text-success group-[.toaster]:border-success/20',
          error:
            'group-[.toaster]:bg-danger-bg group-[.toaster]:text-danger group-[.toaster]:border-danger/20',
          warning:
            'group-[.toaster]:bg-warning-bg group-[.toaster]:text-warning group-[.toaster]:border-warning/20',
          info: 'group-[.toaster]:bg-navy-50 group-[.toaster]:text-navy-800 group-[.toaster]:border-navy-200',
        },
      }}
    />
  )
}

export default Toaster
