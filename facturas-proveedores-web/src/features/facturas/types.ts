/**
 * Re-exports of Factura domain types from the shared API declarations.
 * Provides a convenient feature-local import path (mirrors C-07 pattern).
 *
 * The authoritative source is `src/shared/api/api.d.ts`.
 * Run `npm run generate-types` when the backend is available to regenerate from the live OpenAPI schema.
 */
export type {
  EstadoFactura,
  FacturaItem,
  FacturaItemCreate,
  Factura,
  FacturaResponse,
  FacturaListItem,
  PaginatedFacturas,
  FacturaCreate,
  FacturaUpdate,
  FacturasFilters,
} from '@shared/api/api'
