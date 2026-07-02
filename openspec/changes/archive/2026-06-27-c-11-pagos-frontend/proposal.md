# Proposal: c-11-pagos-frontend

## Why

C-10 (`pagos-backend`, archived 2026-06-27) exposes the full `/api/pagos` CRUD (RN-PAG-01..05 enforced in the service layer) and a signed Cloudinary preset for `tipo=comprobante`, but the user has no interface to record payments. Payments are the **other half of the cuenta-corriente** — without them, the supplier saldo (RN-SALDO) never moves and the FIFO pool (RN-FIFO) is empty, so the manual flow that makes the product usable in production (target: C-13) cannot be completed. This change unblocks C-12 (cuenta-corriente-backend) and C-13 (cuenta-corriente-frontend) by giving users a way to load, edit and delete payments. It is the final manual-flow piece: from C-11 onwards, every input that feeds the supplier balance is reachable from the UI.

## What Changes

- New `pagos` feature in `facturas-proveedores-web/`, mirroring the exact structure shipped by C-07/C-09: `features/<x>/api/{xApi.ts, xHooks.ts, xHooks.test.tsx}`, `features/<x>/components/`, a list page, a form page, and `types.ts` re-exporting from `@shared/api/api`.
- **List page** (`PagosPage`): filterable by supplier (reuses the shared `SupplierSearch` autocomplete), paginated, ordered by `fecha DESC, created_at DESC`. No estado filter — `Pago` has no estado (RN-PAG-01 is exactly the absence of a per-invoice link).
- **Create/edit form** (`PagoFormPage`): `proveedor` (required, via `SupplierSearch`); `monto` (> 0); `fecha` (not future, UTC-3); `metodo` (select, enum `EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO`); optional `comprobante` (single PDF/JPG/PNG, Cloudinary `tipo=comprobante` preset). **No `factura` field anywhere** — the form does not render, accept, or send a `factura_id` (RN-PAG-01).
- **Explicit UI reinforcement of RN-PAG-01**: a persistent note in the form ("El pago se asocia al proveedor, no a una factura específica") and a `PagoCard` badge that labels each payment as a "Pago al proveedor" so the absence of an invoice link is unambiguous.
- **Método de pago badges with icons**: visual chips per `metodo` (cash/transfer/card/MP/other) so users can scan the list.
- **Cloudinary upload**: reuse the existing `FileUploadField` (shipped in C-09) with `tipo='comprobante'`. The component is already `tipo`-generic.
- **TanStack Query data layer**: `usePagos(proveedor_id?)`, `usePago(id)`, `useCreatePago`, `useUpdatePago`, `useDeletePago`, plus the `useCloudinaryPreset('comprobante')` hook. Cache invalidation: list + detail on every mutation.
- **Home quick access**: a "Cargar pago" action on the home screen (F-HOME-01) that navigates to `/pagos/nuevo`.
- **Tests** (Vitest + RTL + MSW): form has no factura field, comprobante upload flow, `metodo` required, list filter by supplier, soft-delete confirmation, `RN-PAG-01` UI note is present in the form.

## Capabilities

### New Capabilities

- `pagos-frontend`: The web interface for payment management — supplier-scoped list with método badges and Cloudinary comprobante upload, create/edit form that structurally cannot accept a `factura_id`, TanStack Query data layer over `/api/pagos`, and the home quick-access entry point. Enforces RN-PAG-01 in the UI (no factura field, explicit reinforcement note).

### Modified Capabilities

- None. The change adds a NEW frontend capability and consumes the existing `pagos-backend` and `proveedores-frontend` capabilities without changing their requirements.

## Impact

- **Repo**: `facturas-proveedores-web` (frontend). No backend change — consumes the C-10 `/api/pagos` endpoints and the C-10 `GET /api/cloudinary/preset-firmado?tipo=comprobante`.
- **New code**: `src/features/pagos/` (api hooks, components, page, types). Router wiring in `src/app/router.tsx` (private route under the existing `RequireAuthWithBootstrap` guard). A "Cargar pago" entry on the home screen.
- **Reused code** (full list in `design.md` §"Reuse from C-07/C-09"): `SupplierSearch` (C-07), `FileUploadField` (C-09, already `tipo`-generic), `FacturaForm` controlled-state pattern (C-09), `apiClient` + 401 interceptor (C-04), TanStack Query + query-key convention (C-07/C-09), Cloudinary preset hook (C-09).
- **Dependencies**: C-07 (proveedores-frontend, archived) for `SupplierSearch`; C-09 (facturas-frontend, archived) for `FileUploadField` + Cloudinary pattern + form conventions; C-10 (pagos-backend, archived) for the endpoint contract. No new npm dependencies.
- **Governance**: MEDIUM — business UI over an established API; no auth/billing/security surface changed. The hard rule is the structural absence of `factura_id` from the form payload — the apply phase must verify by snapshot test that no field/select/path/key containing `factura` exists in the pagos feature.

## Out of scope

- Cuenta-corriente view (C-12 backend, C-13 frontend) — depends on this change.
- IA extraction for pagos (C-14/C-15) — separate change, same `VisionExtractor` interface.
- Cancelaciones, reversals, or per-factura linking (explicitly out of MVP per `05_reglas_de_negocio.md`).
- Changes to the `pagos-backend` spec, the `proveedores-frontend` spec, or the shared `SupplierSearch`/`FileUploadField` components.

## Dependencies satisfied

- C-07 (proveedores-frontend, archived) — `SupplierSearch` shipped and reused.
- C-09 (facturas-frontend, archived) — `FileUploadField` shipped and reused; form pattern established.
- C-10 (pagos-backend, archived) — `/api/pagos` CRUD live, `tipo=comprobante` preset live.

## Patterns mirrored (archive references)

- `openspec/changes/archive/2026-06-25-c-09-facturas-frontend/` — folder structure, hooks pattern, `api.d.ts` extension, form validation strategy, file upload flow, filter+list composition.
- `openspec/changes/archive/2026-06-27-c-10-pagos-backend/` — request/response shape, `metodo` enum, `origen=MANUAL` invariant, `PagoListItem` lean row, no-`factura_id` enforcement at the wire.

## Hard rules (non-negotiable)

1. **NEVER** render, accept, or send a `factura_id` field anywhere in the pagos feature (RN-PAG-01). A test asserts the form payload contains no `factura` key; a test asserts the `PagoForm` JSX contains no factura input/select.
2. **NEVER** compute `saldo` or `estado` on the frontend — both are on-demand, computed server-side. Pagos do not have an `estado`.
3. **NEVER** override `usuario_id` or `origen` from the client. The session sets the user; the service stamps `origen=MANUAL`.
4. **TS strict, no `any`** — types come from `@shared/api/api` (extended in apply). `monto` arrives as `number`, formatted with `Intl.NumberFormat` (ARS).
5. **Cloudinary mocked in tests** via MSW. Never hit Cloudinary for real in the unit suite.
6. **Montos** in ARS, **fechas** in UTC-3. Client "not future" check uses the same `getTodayUTC3()` helper as C-09.
