/**
 * Toast API (C-20, frontend-ui-polish).
 *
 * Thin re-export of sonner's toast methods so call sites import from a
 * project-internal path. This is the single point of customization for
 * future telemetry opt-out, i18n, or migration to another toast library.
 *
 * Usage:
 *   import { toast } from '@shared/components/Toaster/toast'
 *   toast.success('Proveedor creado.')
 *   toast.error('No se pudo guardar.')
 */
export { toast } from 'sonner'
