/**
 * Re-exports of Venta domain types from the shared API declarations.
 * Provides a convenient feature-local import path (mirrors the C-11
 * pattern in `src/features/pagos/types.ts`).
 *
 * The authoritative source is `src/shared/api/api.d.ts`.
 */
export type {
  FormaPago,
  Venta,
  VentaListItem,
  VentaCreate,
  VentaUpdate,
  VentasFilters,
  VentaDeleteInput,
} from '@shared/api/api'
