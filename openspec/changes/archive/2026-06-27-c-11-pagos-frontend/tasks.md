# Tasks — C-11 pagos-frontend

> Repo: `facturas-proveedores-web`. Stack: React 18 + TS (strict, no `any`) + Vite PWA, TanStack Query, Axios, Tailwind v4. Tests: Vitest + RTL + MSW.
> TDD mandatory (Strict TDD): RED → GREEN → TRIANGULATE → REFACTOR per task. Cloudinary and the backend mocked via MSW.
> Before writing, read `src/features/facturas/api/*`, `src/features/facturas/components/FacturaForm.tsx`, `src/features/facturas/components/FileUploadField.tsx`, and `src/shared/components/SupplierSearch/SupplierSearch.tsx` to confirm prop interfaces and the typed-Axios client.

## 0. Pre-flight

- [x] 0.1 Read the shipped C-09 code: `src/features/facturas/api/*`, `src/features/facturas/components/{FacturaForm,FileUploadField,EstadoBadge}.tsx`, `src/shared/components/SupplierSearch/SupplierSearch.tsx`. Confirm the `SupplierSearch` prop interface, the `FileUploadField` `tipo` prop, and the hooks/query-key convention.
- [x] 0.2 Run the existing test suite to capture a green baseline before adding anything.

## 1. Types (api.d.ts extension)

- [x] 1.1 RED: write a tiny type-level test `src/shared/api/api.types.test-d.ts` (or in the pagos hooks test) asserting the `PagoCreate` interface has NO `factura_id` key (via `expectTypeOf`/`satisfies`).
- [x] 1.2 GREEN: extend `src/shared/api/api.d.ts` with `MetodoPago`, `OrigenDocumento`, `Pago`, `PagoListItem`, `PagoResponse`, `PagoListResponse`, `PagoCreate`, `PagoUpdate`, `PagosFilters`. Extend `TipoUpload` to `'avatar' | 'factura' | 'comprobante'` (closes the C-09 gap). Decimals typed as `number`. No `any`.
- [x] 1.3 Triangulate: `PagoUpdate` has no `proveedor_id`; `PagoListItem` is lean (no `comprobante_url`); `PagoListResponse` wraps `{items, total, page, page_size}`.

## 2. Data layer — TDD, MSW

- [x] 2.1 RED: `pagosHooks.test.tsx` — `usePagos(proveedor_id)` issues `GET /api/pagos?proveedor_id=...&page=1`; `usePago(id)` issues `GET /api/pagos/{id}`.
- [x] 2.2 GREEN: `pagosApi.ts` (typed Axios, `withCredentials`) + `usePagos`/`usePago` in `pagosHooks.ts`. `PAGO_KEYS` mirrors `FACTURA_KEYS`.
- [x] 2.3 Triangulate: `useCreatePago` (POST → invalidate `pagos.all`); `useUpdatePago` (PATCH → invalidate + set detail); `useDeletePago` (DELETE → invalidate). Reuse `useCloudinaryPreset('comprobante')` from C-09.
- [x] 2.4 RED: assert the `useCreatePago` payload type does NOT allow a `factura_id` key (compile-time test using `satisfies`).
- [x] 2.5 REFACTOR: extract shared query keys; ensure no `any`.

## 3. MetodoBadge — TDD

- [x] 3.1 RED: `MetodoBadge` renders the response `metodo` with a distinct color per enum value; never computes anything.
- [x] 3.2 GREEN: implement `MetodoBadge` (Tailwind color map: EFECTIVO emerald, TRANSFERENCIA blue, TARJETA violet, MERCADOPAGO sky, OTRO gray).
- [x] 3.3 Triangulate: all five enum values + a defensive default for unknown.

## 4. PagoCard — TDD

- [x] 4.1 RED: `PagoCard` renders monto (Intl ARS), fecha, `MetodoBadge`, comprobante link, edit/delete actions. Includes the "Pago al proveedor" label that reinforces RN-PAG-01.
- [x] 4.2 GREEN: implement `PagoCard` as a pure presentational component (props only, no data fetching).
- [x] 4.3 Triangulate: missing `comprobante_url` → no link rendered; click on edit invokes the prop callback; click on delete invokes the prop callback.

## 5. PagoForm — TDD, RN-PAG-01 enforced

- [x] 5.1 RED: `PagoForm.test.tsx` — the form renders NO `factura` input/select (assert via `querySelector('[name*="factura"]')` returning null). The RN-PAG-01 note "El pago se asocia al proveedor, no a una factura específica" is present in the rendered DOM.
- [x] 5.2 GREEN: implement `PagoForm` with controlled state: `selectedProveedor` (via `SupplierSearch`), `monto`, `fecha`, `metodo`, `comprobante_url`. Persistent info note near the supplier field.
- [x] 5.3 RED: on valid submit, the captured payload contains only `proveedor_id`, `monto`, `fecha`, `metodo`, optional `comprobante_url` — assert `Object.keys(payload).every(k => !k.toLowerCase().includes('factura'))`. `useCreatePago` mutation is called.
- [x] 5.4 GREEN: wire submit → mutation.
- [x] 5.5 RED: client validation: missing `metodo` blocks submit; `monto <= 0` blocks; `fecha` in future (UTC-3) blocks; missing `selectedProveedor` blocks. Triangulate: each error has a distinct message.
- [x] 5.6 GREEN: implement client validation with the same `getTodayUTC3()` helper as C-09.
- [x] 5.7 RED: backend 422 is rendered inline without losing input (e.g. Pydantic rejects `monto: 'abc'` server-side; the field keeps user input and shows the error).
- [x] 5.8 GREEN: wire 422 rendering on the offending field.
- [x] 5.9 Triangulate: edit mode pre-fills from `GET /api/pagos/{id}`, supplier is read-only (`disabled`), PATCH sends only changed fields. Date inputs use `YYYY-MM-DD` string format.

## 6. FileUploadField reuse (comprobante)

- [x] 6.1 RED: `PagoForm.test.tsx` — the comprobante upload calls `useCloudinaryPreset('comprobante')` and POSTs to Cloudinary (MSW).
- [x] 6.2 GREEN: wire the existing `FileUploadField` with `tipo='comprobante'` inside `PagoForm`. No new component.
- [x] 6.3 Triangulate: client-side rejects non PDF/JPG/PNG; rejects >10 MB; failed upload preserves form state and allows save without a file; replacing the file replaces the URL (single file only, RN-PAG-04 parallel to RN-FAC-07).

## 7. PagosFilters + PagosList — TDD

- [x] 7.1 RED: `PagosFilters` — supplier filter uses shared `SupplierSearch`; clearing restores the unfiltered list.
- [x] 7.2 GREEN: implement `PagosFilters` syncing to URL search params (mirroring C-09 D-C09-4).
- [x] 7.3 RED: `PagosList` — renders `PagoCard` per row, empty state, `Intl.NumberFormat` ARS amounts, delete with confirmation, `MetodoBadge` per row.
- [x] 7.4 GREEN: implement `PagosList` matching C-09's `FacturasList` visual rhythm; delete confirmation modal/flow.
- [x] 7.5 Triangulate: supplier filter narrows the list; clearing restores full list; delete invalidates the list query and the row disappears.

## 8. Pages, routing, home entry — TDD

- [x] 8.1 RED: `PagosPage.test.tsx` — integrates `PagosFilters` + `PagosList`, drives `usePagos` from URL params.
- [x] 8.2 GREEN: implement `PagosPage` and `PagoFormPage` (create + edit routes).
- [x] 8.3 GREEN: register `/pagos`, `/pagos/nuevo`, `/pagos/:id/editar` under the existing `RequireAuthWithBootstrap` guard in `src/app/router.tsx`.
- [x] 8.4 RED+GREEN: add the "Cargar pago" quick-access link in the home screen (F-HOME-01) — wherever the actual `HomePage` lives (currently inlined in `router.tsx` per D-C11-9; future `src/app/HomePage.tsx` if extracted). Test it navigates to `/pagos/nuevo`.

## 9. Verification

- [x] 9.1 Run typecheck (TS strict) — zero `any`, zero errors. `api.d.ts` extension is consistent with the live backend.
- [x] 9.2 Run the full Vitest suite — all green, including the three explicit brief tests: (a) formulario sin campo factura, (b) upload comprobante, (c) método obligatorio validado. Plus: `usePagos`/`usePago`/`useCreatePago`/`useUpdatePago`/`useDeletePago` round-trips with MSW.
- [x] 9.3 Manual smoke (optional, via Playwright if installed): create a payment with comprobante, edit, delete; assert the supplier saldo and the cuenta-corriente view (C-12/C-13, not in this change) react on the next re-aggregation.

## Review Workload Forecast

- Estimated changed lines: ~600-900 across ~14 new files (feature-local, additive) + a small `api.d.ts` extension.
- 400-line budget risk: Medium — likely exceeds 400 changed lines.
- Chained PRs recommended: Yes (if a strict 400-line budget applies).
  - **PR-A (foundation, ≤ ~200 lines):** task 1 (`api.d.ts` extension) + task 2 (data layer) + task 3 (`MetodoBadge`). Tests ship with the code.
  - **PR-B (form, ≤ ~250 lines):** task 4 (`PagoCard`) + task 5 (`PagoForm`) + task 6 (comprobante upload wiring).
  - **PR-C (list, pages, home, ≤ ~250 lines):** task 7 (filters + list) + task 8 (pages + router + home) + task 9 (verification).
- Delivery strategy: `ask-on-risk`. Decision needed before apply: Yes (chained PRs or `size:exception`).
- Default if no decision: single PR with `size:exception` (matches C-09's choice; change is additive and route-gated, rollback is trivial).

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium
