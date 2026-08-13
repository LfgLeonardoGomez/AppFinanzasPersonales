/**
 * Human-readable Spanish labels for `FormaPago` (C-34).
 *
 * `FormaPagoBadge` deliberately renders the raw enum value (mirrors
 * `MetodoBadge` — RN mirrors RN-FAC-09: badges show exactly what the backend
 * sent). This map is for PROSE contexts instead — filter pills, the totals
 * breakdown, and the disappearing-debt warning copy (design.md D5) — where a
 * shouted enum value ("CUENTA_CORRIENTE") would read as a bug, not a label.
 */
import type { FormaPago } from '@shared/api/api'

export const FORMA_PAGO_LABELS: Record<FormaPago, string> = {
  EFECTIVO: 'Efectivo',
  TRANSFERENCIA: 'Transferencia',
  TARJETA: 'Tarjeta',
  CUENTA_CORRIENTE: 'Cuenta corriente',
  OTRO: 'Otro',
}
