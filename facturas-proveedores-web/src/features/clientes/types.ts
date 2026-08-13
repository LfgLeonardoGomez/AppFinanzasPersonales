/**
 * Re-exports of Cliente domain types from the shared API declarations.
 * Provides a convenient feature-local import path (mirrors the C-11
 * pattern in `src/features/pagos/types.ts`).
 *
 * The authoritative source is `src/shared/api/api.d.ts`.
 *
 * NOTE (design.md D7): C-34 owns only `src/features/clientes/api/` — the
 * customers list/detail pages belong to C-36. This types file exists now
 * because `ClienteAutocomplete` (a shared component) needs it.
 */
export type { Cliente, ClienteListItem, ClienteCreate, ClienteConflictDetail } from '@shared/api/api'
