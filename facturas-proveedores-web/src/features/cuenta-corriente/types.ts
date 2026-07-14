/**
 * Re-exports for the cuenta-corriente feature (C-13, D1).
 *
 * Mirrors the C-09 / C-11 pattern of colocating the type imports
 * consumers need. Keeps the import paths stable for future
 * contributors — the feature is consumed via `@features/cuenta-corriente`
 * and the types are reachable from there.
 */
export type {
  FacturaConEstado,
  EntradaHistorial,
  EntradaHistorialTipo,
  CuentaCorrienteResponse,
  FiltrosFacturas,
  FacturaDeleteInput,
  PagoDeleteInput,
} from '@shared/api/api'
