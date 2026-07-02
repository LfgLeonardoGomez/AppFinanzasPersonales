# Proposal: c-13-cuenta-corriente-frontend

## Why

C-12 (`cuenta-corriente-backend`, archived 2026-06-27) ships the read-only `GET /api/proveedores/{id}/cuenta-corriente` endpoint that returns the on-demand `{ saldo, facturas_con_estado, historial }` triple, computed in the service layer per RN-SALDO, RN-FIFO and RN-HIST. C-09 (`facturas-frontend`, archived 2026-06-25) and C-11 (`pagos-frontend`, archived 2026-06-27) ship the two halves of that triple — invoices and payments — with their own CRUD, badges, and hooks. **The cuenta-corriente IS the product**: a single supplier-facing view that says "le debés $X, estas son las facturas (con estado), así evolucionó la deuda en el tiempo". CHANGES.md declares the product **functional in production from C-13** — without this change the manual flow has no payoff screen, the user can enter movements but cannot see the result. This change consumes the C-12 endpoint, renders the triple, and adds the missing **cross-feature cache-invalidation wiring** so a factura or pago created from the supplier detail page triggers a fresh cuenta-corriente fetch (RN-SALDO is recomputed on demand; the cache must reflect that).

## What Changes

- New `cuenta-corriente` feature in `facturas-proveedores-web/` mirroring the C-09/C-11 feature shape: `features/cuenta-corriente/{api/, components/, CuentaCorrientePage.tsx, types.ts}`.
- **SaldoBadge** — presentational pill that color-codes the signed `saldo` (`> 0` deuda red, `= 0` al día green, `< 0` a favor blue). Reads from response, NEVER recomputes.
- **TablaFacturasConEstado** — table of `facturas_con_estado` showing the FIFO estado via the existing `EstadoBadge` (reused from C-09). Frontend filters (by estado, by fecha range) operate on the response payload, **not** by re-issuing the request with new params.
- **HistorialCronologico** — chronological debe/haber table with `saldo_acumulado` per row, visually distinguishing `FACTURA` rows (debe) from `PAGO` rows (haber). Reads `saldo_acumulado` from the response, never computes it.
- **CuentaCorrientePage** — composes the three blocks. Header shows the supplier name (from `useProveedor(id)`) plus the `SaldoBadge`. Tabs/sections: saldo + facturas + historial.
- **ProveedorDetailPage** (new in `features/proveedores/`) — the page that integrates `CuentaCorrientePage` with two action buttons: "Cargar factura" and "Cargar pago" both scoped to the current supplier (via `?proveedor_id=` filter on the existing create forms).
- **TanStack Query**:
  - `useCuentaCorriente(proveedorId)` — `useQuery(['cuenta-corriente', 'detail', proveedorId])`. Read-only, 404 on foreign / soft-deleted / missing (mirrors C-12 error contract).
  - **Cross-feature cache invalidation**: the existing `useCreateFactura` / `useUpdateFactura` / `useDeleteFactura` / `useCreatePago` / `useUpdatePago` / `useDeletePago` hooks are extended to ALSO invalidate `cuenta-corriente-keys.detail(proveedorId)` for the affected supplier. The `proveedorId` is read from the mutation's payload (`FacturaCreate.proveedor_id`, `PagoCreate.proveedor_id`); for `useUpdate*` / `useDelete*` it is read from the prior cached data (`useProveedor`-style fetch of the factura/pago first, or from the response's `proveedor_id`).
- **Routing**: add `/proveedores/:id` (private, behind `RequireAuthWithBootstrap`) → `ProveedorDetailPage`. Link from `ProveedoresList` rows. Add a "Ver cuenta corriente" entry on the home screen (`F-HOME-01` extension).
- **Tests** (Vitest + RTL + MSW): `SaldoBadge` color per sign, `TablaFacturasConEstado` filters on response fields, `HistorialCronologico` renders `saldo_acumulado`, `useCuentaCorriente` (loading / success / 404 cross-tenant / no movimientos), `ProveedorDetailPage` integration, **and** a focused regression suite asserting that creating / updating / deleting a factura or pago of a given supplier invalidates the `cuenta-corriente.detail(proveedorId)` cache key (the "fresh triple after mutation" guarantee).

## Capabilities

### New Capabilities

- `cuenta-corriente-frontend`: The web interface for the per-supplier cuenta-corriente view — SaldoBadge with sign-based color, TablaFacturasConEstado showing the FIFO `estado` from the response, HistorialCronologico showing `saldo_acumulado` from the response, filters applied on response fields, TanStack Query `useCuentaCorriente(proveedorId)` against the C-12 endpoint, and cross-feature cache invalidation on every factura/pago mutation. Enforces RN-SALDO (consume the signed `saldo`, never recompute), RN-FIFO (consume `estado` from response, never recompute), and RN-HIST (consume `saldo_acumulado`, never recompute). No `factura_id` field on any pago payload (RN-PAG-01) — the mutation hooks are reused, not duplicated.

### Modified Capabilities

- `proveedores-frontend`: extended with `ProveedorDetailPage` (the integration page). The supplier list (`/proveedores`) and the supplier form pages are unchanged; only a new sub-route `/proveedores/:id` is added and the list rows gain a "Ver" link. The home screen gains a "Ver cuenta corriente" entry that routes to a supplier picker (or to `/proveedores` if no supplier is in scope — the exact home UX is a small design decision, see Q-CC-FE-01 in `design.md`). No existing `proveedores-frontend` REQUIREMENT changes — the addition is a new sub-page and a navigation tweak. A delta spec is required because the `proveedores-frontend` capability gains a new public page and a new hook that did not exist before.

## Impact

- **Repo**: `facturas-proveedores-web/` (frontend). No backend change. No `facturas-proveedores-api/` edit.
- **New code** (paths under `src/features/cuenta-corriente/`):
  - `api/cuentaCorrienteApi.ts` — typed Axios: `getCuentaCorriente(proveedorId)`.
  - `api/cuentaCorrienteHooks.ts` — `useCuentaCorriente(proveedorId)`, `CUENTA_CORRIENTE_KEYS`.
  - `api/cuentaCorrienteHooks.test.tsx` — MSW tests (loading / success / 404 cross-tenant / empty).
  - `components/SaldoBadge.tsx` (+ test) — presentational, sign-based color, no math.
  - `components/TablaFacturasConEstado.tsx` (+ test) — table + estado badge reuse + client-side filters.
  - `components/HistorialCronologico.tsx` (+ test) — chronological merge, `saldo_acumulado` per row, FACTURA vs PAGO visual distinction.
  - `components/FiltrosFacturas.tsx` (+ test) — estado select + fecha desde/hasta, applied on response fields.
  - `CuentaCorrientePage.tsx` (+ test) — page composition (header + saldo + tablas).
  - `types.ts` — re-exports from `@shared/api/api`.
- **New code** (paths under `src/features/proveedores/`):
  - `ProveedorDetailPage.tsx` (+ test) — supplier detail / cuenta-corriente integration; "Cargar factura" / "Cargar pago" buttons scoped to the current supplier.
- **Modified code** (cache-invalidation wiring):
  - `src/features/facturas/api/facturasHooks.ts` — `useCreateFactura` / `useUpdateFactura` / `useDeleteFactura` now also `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', proveedorId] })`. The `proveedorId` is read from the mutation payload (`create`) or from the deleted/updated row's `proveedor_id` field (`update` / `delete`); `update` / `delete` need the cached detail of the row to recover it (mirrors how `useUpdateProveedor` reads `updated.id` to set the detail cache).
  - `src/features/pagos/api/pagosHooks.ts` — symmetric invalidation for `useCreatePago` / `useUpdatePago` / `useDeletePago`.
  - `src/shared/api/api.d.ts` — add `CuentaCorrienteResponse`, `FacturaConEstado`, `EntradaHistorial` (mirror of the C-12 Pydantic shapes; decimals as `number` like the rest of `api.d.ts`).
  - `src/app/router.tsx` — register `/proveedores/:id` (private). Update the inlined `HomePage` quick-access nav with a "Ver cuenta corriente" entry. Update `ProveedoresList` to add a "Ver cuenta corriente" link on each row.
- **Reused code** (full list in `design.md` §"Reuse from C-07/C-09/C-11"): `EstadoBadge` (C-09), `SupplierSearch` (C-07), `MetodoBadge` + `PagoCard` (C-11), `useCloudinaryPreset` (C-09), `apiClient` + 401 interceptor (C-04), TanStack Query + query-key convention (C-07/C-09/C-11), `FacturaForm` / `PagoForm` controlled-state pattern (C-09/C-11), `getTodayUTC3()` (C-09), `Intl.NumberFormat('es-AR', ...)` ARS formatting (C-09/C-11), `api.d.ts` extension pattern (C-09/C-11), `HomePage` quick-access pattern (C-09/C-11).
- **Dependencies**: C-07 (proveedores-frontend, archived) for `ProveedorListItem` shape and `SupplierSearch`; C-09 (facturas-frontend, archived) for `EstadoBadge`, query-key convention and `FacturaCreate.proveedor_id` payload shape; C-10 (pagos-backend, archived) for the `PagoCreate.proveedor_id` payload shape; C-11 (pagos-frontend, archived) for the `useCreatePago`/`useUpdatePago`/`useDeletePago` invalidation pattern; C-12 (cuenta-corriente-backend, archived) for the endpoint contract. **No new npm dependencies.**
- **Governance**: MEDIO — pure read-and-render over an established API; the hard rule is that NOTHING is recomputed on the client. The triple comes from the response verbatim. The apply phase must verify by component tests that no `saldo`/`estado`/`saldo_acumulado` recomputation happens (the badge receives the value as a prop, the tables read the value from the response object, the hook returns the response unchanged). The cache-invalidation wiring must be covered by a regression test that asserts the `cuenta-corriente.detail(proveedorId)` key is invalidated on every mutation path.

## Out of scope

- **Cuenta-corriente backend (C-12)**: already shipped; this change is consumer-only.
- **IA extraction (C-14 backend, C-15 frontend)**: separate changes. Nothing here touches `VisionExtractor` or `origen=IA`. The cuenta-corriente view will already include `origen=IA` rows when C-14/C-15 land (the endpoint does not filter by `origen`).
- **Pagination of the cuenta-corriente payload**: the C-12 endpoint returns the full triple per supplier; the frontend renders what the backend returns. If a supplier ever has >500 movements, the next change adds `?limit=&offset=` to the endpoint AND the frontend filter — out of scope here.
- **Date range / estado filtering at the SQL level**: explicitly forbidden (RN-FAC-09 mirror on the cuenta-corriente view). Filters are client-side on the response payload. The endpoint is read-only with no query params.
- **New actions on the cuenta-corriente view (e.g. "Pagar factura X")**: explicitly forbidden — `Pago` has no `factura_id` (RN-PAG-01) and that contract is not relaxed here. The only actions surfaced are the existing create-factura / create-pago flows, scoped to the supplier.
- **Editing a supplier's `saldo` or `estado` field**: the frontend does not expose such fields. There is no input that could write them. A test asserts no input/select with `name="saldo"` or `name="estado"` exists in the cuenta-corriente feature.
- **Changes to the `facturas-frontend`, `pagos-frontend`, or `proveedores-frontend` backend specs**, the C-12 spec, the shared `apiClient`, the `api.d.ts` Pago / Factura / Proveedor types. This change is additive to the frontend.

## Dependencies satisfied

- C-07 (proveedores-frontend, archived 2026-06-21) — `SupplierSearch` shipped, `ProveedorListItem`/`Proveedor` types, list-row navigation pattern.
- C-09 (facturas-frontend, archived 2026-06-25) — `EstadoBadge` (PENDIENTE/PARCIAL/PAGADA), `FacturaCreate.proveedor_id` payload, `FacturasFilters` shape, filter-on-response-field precedent (the list filters by estado from the response, not by re-issuing).
- C-10 (pagos-backend, archived 2026-06-27) — `PagoCreate.proveedor_id` payload (used to derive the invalidation key on create).
- C-11 (pagos-frontend, archived 2026-06-27) — `useCreatePago`/`useUpdatePago`/`useDeletePago` invalidation pattern; `MetodoBadge`; `PagoCard`.
- C-12 (cuenta-corriente-backend, archived 2026-06-27) — `GET /api/proveedores/{id}/cuenta-corriente` contract; the `CuentaCorrienteResponse` / `FacturaConEstado` / `EntradaHistorial` shapes from `app/schemas/cuenta_corriente.py` are mirrored verbatim into `api.d.ts`.

## Patterns mirrored (archive references)

- `openspec/changes/archive/2026-06-27-c-12-cuenta-corriente-backend/` — endpoint contract, response shape, sign convention on `saldo` and `saldo_acumulado`, error contract (401 / 404).
- `openspec/changes/archive/2026-06-27-c-11-pagos-frontend/` — feature folder structure, hooks pattern, `api.d.ts` extension, cache-invalidation shape, `Intl.NumberFormat` ARS, `MetodoBadge` reuse.
- `openspec/changes/archive/2026-06-25-c-09-facturas-frontend/` — `EstadoBadge`, filter-on-response-field precedent, `FacturaForm` pattern, list composition, router wiring.
- `openspec/changes/archive/2026-06-21-c-07-proveedores-frontend/` — `SupplierSearch`, `ProveedorListItem` shape, list-row "Ver" link pattern.

## Hard rules (non-negotiable)

1. **NEVER** recompute `saldo`, `estado`, or `saldo_acumulado` on the frontend (RN-SALDO, RN-FIFO, RN-HIST). The triple comes from the response verbatim. A regression test asserts that no function in `src/features/cuenta-corriente/` invokes a math operation on a `saldo`/`estado`/`saldo_acumulado` field (the test checks by inspecting imports and component source: no `useMemo` reducer, no `reduce` over `facturas`/`historial`).
2. **NEVER** show, accept, or send a `factura_id` field anywhere (RN-PAG-01). The pago mutation hooks are reused from C-11 without modification of their payload shape. A test asserts that the cuenta-corriente feature source has no input/select/comment with `factura` in the name.
3. **NEVER** filter at the SQL level. The `useCuentaCorriente` hook has no query params; the response is the full triple for the supplier. Filters (by estado, by fecha range) are applied client-side on the response payload, mirroring the C-09 `FacturasFilters.estado` precedent (which already filters on the computed field from the response, not by re-issuing the request).
4. **NEVER** request the cuenta-corriente of a supplier owned by another user — the backend returns 404 (mirrors C-12). The frontend surfaces a friendly "Proveedor no encontrado" empty state. A test asserts the hook returns the response unchanged on 404 and the page shows the empty state.
5. **NEVER** write `saldo` or `estado` to the user. The frontend has no input/select with `name="saldo"` or `name="estado"`. A test asserts this by walking the rendered JSX of the new pages and components.
6. **TS strict, no `any`** — types come from `@shared/api/api` (extended in apply). Decimals arrive as JSON numbers typed `number`, formatted with `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`. `monto` of the existing `PagoCard` and `FacturaCard` is the same pattern.
7. **Cloudinary not used here** — the cuenta-corriente view is read-only. The "Cargar factura" / "Cargar pago" buttons reuse the existing create forms (C-09/C-11) which already mock Cloudinary via MSW. No new upload logic in this change.
8. **Multi-tenant isolation**: the frontend trusts the backend's session-injected `usuario_id`. The hook makes no assumption about the supplier's owner; the backend's 404 is the only source of "not yours" (no 403 handling needed in the UI).
9. **Cross-feature cache invalidation is a contract**: every mutation of a `Factura` or `Pago` for supplier X invalidates the `cuenta-corriente.detail(X)` query key. A regression test asserts the invalidation by spying on `queryClient.invalidateQueries` and exercising the mutation hooks.
10. **Currency**: ARS only. `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })`. `getTodayUTC3()` for any client-side date validation (none expected in this read-only view, but kept consistent if a filter ever needs it).
