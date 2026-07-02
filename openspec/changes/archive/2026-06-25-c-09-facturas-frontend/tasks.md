# Tasks — C-09 facturas-frontend

> Repo: `facturas-proveedores-web`. Stack: React 18 + TS (strict, no `any`) + Vite PWA, TanStack Query, Axios, Tailwind v4. Tests: Vitest + RTL + MSW.
> TDD is mandatory (Strict TDD Mode): RED → GREEN → TRIANGULATE → REFACTOR per task. Cloudinary and the backend are mocked via MSW — never hit for real.
> Before writing, read the actual `src/features/proveedores/` (C-07) layout and `src/shared/components/SupplierSearch/` to confirm the real prop interface and the api/hooks pattern.

## 0. Pre-flight

- [x] 0.1 Read C-07 shipped code: `src/features/proveedores/api/*`, `src/features/proveedores/components/*`, and `src/shared/components/SupplierSearch/` — confirm the real `SupplierSearch` prop interface, the typed-Axios client, and the hooks/query-key conventions.
- [x] 0.2 Run the existing test suite to capture a green baseline (safety net) before adding anything.

## 1. Types

- [x] 1.1 Extend `src/shared/api/api.d.ts` (or the project's types file) with `EstadoFactura` ('PENDIENTE'|'PARCIAL'|'PAGADA'), `FacturaItem`, `FacturaItemCreate`, `Factura`, `FacturaListItem` (with `estado`), `FacturaResponse` (with `estado`, `items`, `items_sum_mismatch`), `FacturaCreate`, `FacturaUpdate`, and `FacturasFilters`. Decimals typed as `number`. No `any`.

## 2. Data layer (TDD, MSW)

- [x] 2.1 RED: write `facturasHooks.test.tsx` covering `useFacturas(filters)` issuing `GET /api/facturas` with `proveedor_id`/`estado`/`fecha_desde`/`fecha_hasta` query params.
- [x] 2.2 GREEN: implement `facturasApi.ts` (pure typed Axios calls, `withCredentials`) and `useFacturas` in `facturasHooks.ts`.
- [x] 2.3 Triangulate: `useFactura(id)` (GET one), `useCreateFactura` (POST → invalidate list), `useUpdateFactura` (PATCH → invalidate id + list), `useDeleteFactura` (DELETE → invalidate list).
- [x] 2.4 Triangulate: `useCloudinaryPreset('factura')` → `GET /api/cloudinary/preset-firmado?tipo=factura`, mocked.
- [x] 2.5 REFACTOR: extract shared query keys; ensure no `any` in the data path.

## 3. EstadoBadge (TDD)

- [x] 3.1 RED: test that `EstadoBadge` renders the response `estado` label with the correct color (PENDIENTE orange, PARCIAL yellow, PAGADA green) and never computes estado.
- [x] 3.2 GREEN: implement `EstadoBadge` (Tailwind color map).
- [x] 3.3 Triangulate: all three estado values + a defensive default.

## 4. ItemsEditor with non-blocking sum warning (TDD)

- [x] 4.1 RED: test add/remove rows and that an empty items list is valid.
- [x] 4.2 GREEN: implement `ItemsEditor` managing `{ descripcion, cantidad, precio_unitario }[]`.
- [x] 4.3 RED: test that when `sum(cantidad*precio_unitario) != monto_total` a warning shows but submit stays enabled (epsilon compare).
- [x] 4.4 GREEN: implement the non-blocking warning (RN-FAC-04).
- [x] 4.5 Triangulate: matching sum → no warning; mismatch → warning, save allowed.

## 5. FileUploadField (TDD, mocked Cloudinary)

- [x] 5.1 RED: test client-side type rejection (non PDF/JPG/PNG) and size rejection (~10 MB).
- [x] 5.2 GREEN: implement `FileUploadField` with client validation (single file, RN-FAC-07).
- [x] 5.3 RED: test the success flow — fetch signed preset → upload to Cloudinary (MSW) → expose returned `archivo_url`.
- [x] 5.4 GREEN: implement the preset→upload→url flow via `useCloudinaryPreset`.
- [x] 5.5 Triangulate: upload failure shows error, preserves form state, allows saving without a file.

## 6. FacturaForm (TDD)

- [x] 6.1 RED: test create — supplier required (via `SupplierSearch`), `fecha_emision` not future (UTC-3), `monto_total > 0`; submit calls `POST /api/facturas`.
- [x] 6.2 GREEN: implement `FacturaForm` wiring `SupplierSearch`, `ItemsEditor`, `FileUploadField`, native controlled validation.
- [x] 6.3 RED: test edit mode — pre-fill from `GET /api/facturas/{id}`, supplier read-only (`disabled`), PATCH sends changed fields only.
- [x] 6.4 GREEN: implement edit mode.
- [x] 6.5 Triangulate: backend 422 rendered inline without losing input; future date blocked; non-positive monto blocked; `items_sum_mismatch` from response surfaced after save.

## 7. FacturasFilters + FacturasList (TDD)

- [x] 7.1 RED: test `FacturasFilters` — supplier filter uses shared `SupplierSearch`, estado select, date range; clearing restores full list.
- [x] 7.2 GREEN: implement `FacturasFilters` syncing to URL search params.
- [x] 7.3 RED: test `FacturasList` — renders estado badges from the response, `Intl.NumberFormat` ARS amounts, empty state, delete with confirmation invalidating the list.
- [x] 7.4 GREEN: implement `FacturasList` (rows/cards matching C-07's `ProveedoresList`) + delete confirmation.
- [x] 7.5 Triangulate: estado filter shows only matching computed-estado rows; date-range filter applies via query params.

## 8. Pages, routing, home entry (TDD)

- [x] 8.1 RED: `FacturasPage.test.tsx` — list page integrates filters + list, drives `useFacturas` from URL params.
- [x] 8.2 GREEN: implement `FacturasPage` and `FacturaFormPage` (create + edit routes).
- [x] 8.3 GREEN: register `/facturas`, `/facturas/nueva`, `/facturas/:id/editar` under the existing `RequireAuth` guard in `src/app/router.tsx`.
- [x] 8.4 RED+GREEN: add the "Cargar factura" quick-access action on the home screen (F-HOME-01) and test it navigates to the create form.

## 9. Verification

- [x] 9.1 Run typecheck (TS strict) — zero `any`, zero errors.
- [x] 9.2 Run lint — clean. (Note: no ESLint config in project; eslint is not installed — pre-existing gap. TS strict check passes with zero errors.)
- [x] 9.3 Run the full Vitest suite — all green, including the full upload flow, items warning, estado badges, and filters.
- [x] 9.4 Manual smoke (optional): create, edit, delete an invoice; verify estado badge reflects the API response and the items warning is non-blocking. Closed by construction — covered by Vitest (137/137 green, 21 files). See mapping below. Playwright is not installed in this repo and Vite dev server is not running, so a real browser smoke is not viable; the unit/integration suite already exercises the exact flows with MSW intercepting the backend. **Coverage map:** (a) create → `FacturaForm.test.tsx:160` "calls POST /api/facturas on valid submit" + `facturasHooks.test.tsx:207` `useCreateFactura` POSTs. (b) edit → `FacturaForm.test.tsx:191` "pre-fills fields from the existing factura" + `:205` "renders the supplier as read-only in edit mode" + `facturasHooks.test.tsx:223` `useUpdateFactura` PATCHes. (c) delete + confirm → `FacturasList.test.tsx:116` "shows a confirmation dialog before deleting" + `:133` "calls DELETE /api/facturas/{id} after confirmation" + `facturasHooks.test.tsx:235` `useDeleteFactura` DELETEs. (d) EstadoBadge from response → `EstadoBadge.test.tsx:13,21,28` PENDIENTE/PARCIAL/PAGADA color map + `FacturasList.test.tsx:82` "renders estado badges from the response". (e) items warning non-blocking → `ItemsEditor.test.tsx:75` "shows a warning when sum ≠ monto_total" + `:94` "does NOT block submission" + `FacturaForm.test.tsx:254` "shows items_sum_mismatch warning after save when response has mismatch=true". Baseline before marking: `npm run typecheck` exit 0, `npm test -- --run` 137/137 passing.

## Review Workload Forecast

- Estimated changed lines: ~600-900 across ~14 new files (feature-local, additive).
- Chained PRs recommended: No — single cohesive feature, additive, route-gated.
- 400-line budget risk: Medium — likely exceeds 400 changed lines. If a strict budget applies, split along the natural boundary: PR1 = types + data layer + EstadoBadge + ItemsEditor + FileUploadField (sections 1-5); PR2 = form + list + pages + routing + home (sections 6-8). Tests ship with their code.
- Decision needed before apply: Yes if a 400-line budget is enforced (choose single PR with `size:exception` vs. the 2-PR split above). Otherwise No.
