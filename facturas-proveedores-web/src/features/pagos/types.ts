/**
 * Re-exports of Pago domain types from the shared API declarations.
 * Provides a convenient feature-local import path (mirrors the C-07/C-09
 * pattern in `src/features/facturas/types.ts`).
 *
 * The authoritative source is `src/shared/api/api.d.ts`.
 */
export type {
  OrigenDocumento,
  MetodoPago,
  Pago,
  PagoListItem,
  PagoResponse,
  PagoListResponse,
  PagoCreate,
  PagoUpdate,
  PagosFilters,
} from '@shared/api/api'
