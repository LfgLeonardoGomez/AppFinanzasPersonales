# Tasks: c-15-ia-vision-frontend

> **Repo**: `facturas-proveedores-web/`. Stack: React 18 + TS (strict, no `any`) + Vite PWA, TanStack Query v5, Zustand, Axios, Tailwind v4. Tests: Vitest + RTL + MSW.
>
> **TDD mandatory (Strict TDD)**: 0. Safety Net (only for modified files) → 1. Understand → 2. RED → 3. GREEN → 4. TRIANGULATE (≥2 cases per behavior) → 5. REFACTOR → 6. Mark complete. New files don't need Safety Net.
>
> **Test layers** for this change:
> - **Unit**: `ImagenPicker` (type/size validation, drag-and-drop), `PropuestaFacturaFields`, `PropuestaPagoFields`, the 7-state reducer of `PropuestaIAModal`
> - **Component**: `PropuestaIAModal` with MSW for the mutation, fixtures for the proposal
> - **Hook**: `useExtraerFacturaIA`, `useExtraerPagoIA` with MSW (success / 422 / 429 / `error: true` / 500)
> - **Integration**: `FacturaFormPage` + `PagoFormPage` with the modal mounted — confirm fills the form, cancel discards, edit-mode hides the button, no persist from the modal
>
> **✅ OQ-1 RESOLVED — Path B is in effect (c-15a archived 2026-06-28).** The C-15 frontend **sends `origen: 'IA'` from the client** on the post-confirm `POST /api/facturas` / `POST /api/pagos` call. The backend (updated by c-15a) accepts it: `FacturaCreate` and `PagoCreate` schemas now declare `origen: Optional[OrigenDocumento] = None`, and the services use `datos.origen or OrigenDocumento.MANUAL`. Fully-manual entries (no IA modal) DO NOT include `origen`; the backend defaults them to `MANUAL`. **C-15 introduces NO backend code, NO schema change, NO new endpoint** — the backend support is c-15a's scope and is already merged.
>
> **No new npm dependencies.** Reuse everything from C-04, C-07, C-09, C-11, C-13.
>
> **No backend edits.** All file paths are inside `facturas-proveedores-web/`.

## 0. Pre-flight

- [x] 0.1 Read the shipped C-09, C-11, C-07, C-13 code (`src/features/facturas/FacturaFormPage.tsx`, `src/features/pagos/PagoFormPage.tsx`, `src/shared/components/SupplierSearch/`, `src/shared/utils/currency.ts`, `src/shared/api/api.d.ts`) to confirm prop interfaces, hooks patterns, and the `api.d.ts` extension convention.
- [x] 0.2 Read `facturas-proveedores-api/app/schemas/factura.py:192` (PropuestaFactura) and `app/schemas/pago.py:104` (PropuestaPago) to lock the response shape. Confirm the gap documented in `proposal.md` OPEN QUESTION 1: the C-08 / C-10 backend does NOT accept `origen` from the client (`PagoCreate` has `extra="forbid"` at `app/schemas/pago.py:54`).
- [x] 0.3 Run the existing Vitest suite (`npm test -- --run`) to capture a green baseline before any change.

## 1. Types (api.d.ts extension + compile-time guards)

- [x] 1.1 RED: write `src/shared/api/api.iaVision.test-d.ts` asserting at compile time that: ... Run `tsc --noEmit`; the test fails (the types do not exist).
- [x] 1.2 GREEN: extend `src/shared/api/api.d.ts` with `PropuestaFactura` and `PropuestaPago` mirroring the C-14 Pydantic shapes (decimals as `number`, `metodo: MetodoPago | null`). Run `tsc --noEmit`; the compile-time guards pass.
- [x] 1.3 Triangulate (RED + GREEN): add a runtime-guard test `src/shared/api/api.iaVision.test.ts` that instantiates a `PropuestaFactura` and a `PropuestaPago` value and asserts `Object.keys(...)` does NOT include `origen`, `factura_id`, `id`, `usuario_id`, `proveedor_id`, `created_at`, `updated_at`. Run `npm test -- --run src/shared/api/`; all pass.
- [x] 1.4 Safety Net: re-run the full Vitest suite — no regression. The new types are additive; existing tests must still pass.

## 2. Data layer — `useExtraerFacturaIA` and `useExtraerPagoIA` (TDD, MSW)

- [x] 2.1 RED: write `src/features/ia-vision/api/iaVisionHooks.test.tsx` with MSW. The tests cover all five response shapes for BOTH endpoints (10 scenarios total): ... Run `vitest`; the test file fails (the module does not exist).
- [x] 2.2 GREEN: create `src/features/ia-vision/api/iaVisionApi.ts` with two typed Axios functions ... Each builds a `FormData`, appends the `file` under the key `file`, and POSTs to the matching C-14 endpoint. The response is parsed at the boundary: `monto_total` and `monto` decimal strings are converted via `Number()` with a defensive `Number.isFinite` check (the same pattern as C-13's `parseCuentaCorriente`).
- [x] 2.3 GREEN: create `src/features/ia-vision/api/iaVisionHooks.ts` with: ... No `onSuccess` / `onError` logic in the hooks — the modal owns the state transitions. No `invalidateQueries` (the proposal is transient). Run `vitest`; the 10 scenarios in 2.1 pass.
- [x] 2.4 Triangulate (MANDATORY): add tests for boundary values of the `parsePropuestaFactura` / `parsePropuestaPago` helpers (inside `iaVisionApi.ts`): `"0"`, `"0.01"`, `"-0.01"`, `"99999999.99"`, `"-99999999.99"`, and a malformed string (asserts the helper throws a typed `Error`). Run `vitest`; all pass.
- [x] 2.5 Triangulate: add a test that asserts no `invalidateQueries` is called by the hooks (verified by spying on the QueryClient). Run `vitest`; passes.
- [x] 2.6 Safety Net: re-run the full Vitest suite — no regression.

## 3. ImagenPicker (TDD, unit)

- [x] 3.1 RED: write `src/features/ia-vision/components/ImagenPicker.test.tsx` asserting: ... Run `vitest`; the test fails (component does not exist).
- [x] 3.2 GREEN: create `src/features/ia-vision/components/ImagenPicker.tsx` as a presentational component with `props: { onPick: (file: File) => void; disabled?: boolean }`. Renders the file input, drop zone, and inline error. Client-side validation for UX only (the C-14 backend is the authority per RN-IA-01).
- [x] 3.3 Triangulate: add a test for the `disabled` prop (the drop zone is inert and the input is `disabled` when `disabled` is `true`); add a test for a `.heic` file (rejected with the same "Formato no soportado" message); add a test for a 9.99 MB image (accepted). Run `vitest`; all pass.
- [x] 3.4 Safety Net: not needed (new file).

## 4. PropuestaFacturaFields (TDD, unit, fixtures)

- [x] 4.1 RED: write `src/features/ia-vision/components/PropuestaFacturaFields.test.tsx` with a fixture `propuesta: PropuestaFactura`. Asserts: ... Run `vitest`; the test fails (component does not exist).
- [x] 4.2 GREEN: create `src/features/ia-vision/components/PropuestaFacturaFields.tsx` as a presentational component. Uses the existing `SupplierSearch` from `src/shared/components/SupplierSearch/`. Uses the existing `formatMonto` from `src/shared/utils/currency.ts` (C-13) to display the `monto_total` placeholder.
- [x] 4.3 Triangulate: add a test that the `SupplierSearch` value is `null` even when `propuesta.proveedor_nombre` is non-null (RN-IA-06 structural rule); add a test that the `SupplierSearch` initial query is the `propuesta.proveedor_nombre` string. Run `vitest`; all pass.
- [x] 4.4 Safety Net: not needed.

## 5. PropuestaPagoFields (TDD, unit, fixtures)

- [x] 5.1 RED: write `src/features/ia-vision/components/PropuestaPagoFields.test.tsx` with a fixture `propuesta: PropuestaPago`. Asserts: ... Run `vitest`; the test fails (component does not exist).
- [x] 5.2 GREEN: create `src/features/ia-vision/components/PropuestaPagoFields.tsx` as a presentational component. Uses the existing `MetodoBadge` from `src/features/pagos/components/MetodoBadge.tsx` (C-11) for the visual chip.
- [x] 5.3 Triangulate: add a test for a complete `propuesta` (all fields non-null) — all inputs are populated; add a test for an empty `propuesta` (all fields null) — all inputs are empty. Run `vitest`; all pass.
- [x] 5.4 Safety Net: not needed.

## 6. PropuestaIAModal — state machine + 7 states (TDD, component, MSW)

- [x] 6.1 RED: write `src/features/ia-vision/components/PropuestaIAModal.test.tsx` with MSW. The tests cover the 7 modal states and the 10 transitions: ... Run `vitest`; the tests fail (component does not exist).
- [x] 6.2 GREEN: create `src/features/ia-vision/components/PropuestaIAModal.tsx` as a controlled modal. Uses a `useReducer` for the state machine with the 7 states and 10 transitions. The reducer has an exhaustive `never` check at the end. The modal is mounted via a portal to `document.body` with a 40% black overlay. Focus is trapped inside the modal (Tab cycles within the modal). `aria-busy="true"` while extracting. `aria-live="polite"` on the status panel.
- [x] 6.3 Triangulate (MANDATORY): add tests for the supplier-pick enables Confirmar transition. The "Confirmar" button starts disabled; the user types a query into the `SupplierSearch`, picks a suggestion, and the button becomes enabled. The user clicks Confirmar, `onConfirm` is called with the picked `Proveedor` and the proposal. Run `vitest`; all pass.
- [x] 6.4 Triangulate: add a test for the `Escape` key — closes the modal in `idle` and `proposal` states, does NOT close in `extracting`. Run `vitest`; all pass.
- [x] 6.5 Triangulate: add a test that the modal calls `onManualLoad` exactly when the user clicks "Cargar manualmente" in `error_extractor` or `error_generic`. Run `vitest`; all pass.
- [x] 6.6 Triangulate: add a test that `onConfirm` does NOT trigger any `POST /api/facturas` or `POST /api/pagos` request (RN-IA-04 — the modal is read-and-confirm only). Run `vitest`; passes.
- [x] 6.7 Safety Net: not needed (new file).

## 7. FacturaFormPage extension (TDD, integration, MSW)

- [x] 7.1 Safety Net: re-run the existing `FacturaFormPage.test.tsx` to capture a green baseline (the C-09 tests must pass before any change).
- [x] 7.2 RED: write `src/features/facturas/FacturaFormPage.iaConfirm.test.tsx` asserting: ... Run `vitest`; the tests fail (the IA button does not exist yet).
- [x] 7.3 GREEN: extend `src/features/facturas/FacturaFormPage.tsx`: ... Run `vitest`; the tests in 7.2 pass.
- [x] 7.4 Triangulate (MANDATORY): add a test that the pre-filled negative `monto_total` is rejected by the existing form validation (the form's "Confirmar" is enabled, but clicking it shows the existing C-09 "El monto total debe ser mayor a 0" inline error and does NOT call `POST /api/facturas`). Run `vitest`; passes.
- [x] 7.5 Triangulate: add a test for the `?proveedor_id=` pre-fill interaction (C-13's behavior, inherited by C-15). When the user navigates from `ProveedorDetailPage` to `/facturas/nueva?proveedor_id=X` and then opens the IA modal, the modal's `SupplierSearch` initial query is empty (the form's `selectedProveedor` is pre-filled from the URL, but the modal does not show the form's pre-fill — it shows its own state). Run `vitest`; passes.
- [x] 7.6 Triangulate: add a test that the existing C-09 `FacturaFormPage` tests still pass (no regression). Run the full Vitest suite; the C-09 tests are green.
- [x] 7.7 Safety Net: re-run the full Vitest suite — no regression.

## 8. PagoFormPage extension (TDD, integration, MSW)

- [x] 8.1 Safety Net: re-run the existing `PagoFormPage.test.tsx` to capture a green baseline (the C-11 tests must pass before any change).
- [x] 8.2 RED: write `src/features/pagos/PagoFormPage.iaConfirm.test.tsx` asserting: ... Run `vitest`; the tests fail (the IA button does not exist yet).
- [x] 8.3 GREEN: extend `src/features/pagos/PagoFormPage.tsx` symmetrically to 7.3: ... Run `vitest`; the tests in 8.2 pass.
- [x] 8.4 Triangulate (MANDATORY): add a test that the pre-filled `metodo` populates the form's `metodo` select (the C-11 `PagoForm` already renders this select). Run `vitest`; passes.
- [x] 8.5 Triangulate: add a test that a pre-filled `metodo = null` leaves the form's `metodo` select empty (the user must pick a method, per the C-11 spec's "missing metodo is rejected" scenario). Run `vitest`; passes.
- [x] 8.6 Triangulate: add a test that the post-confirm `POST /api/pagos` request body has `origen: 'IA'` (OQ-1 RESOLVED, Path B) AND no `factura_id` key (RN-PAG-01). Run `vitest`; passes.
- [x] 8.7 Triangulate: add a test that the existing C-11 `PagoFormPage` tests still pass (no regression). Run the full Vitest suite; the C-11 tests are green.
- [x] 8.8 Safety Net: re-run the full Vitest suite — no regression.

## 9. End-to-end integration (the "IA confirm populates the form, manual POST persists" guarantee)

- [x] 9.1 RED: write `src/features/ia-vision/PropuestaIAModal.e2e.test.tsx` with MSW for the full flow: ... Run `vitest`; the test fails (no integration test exists).
- [x] 9.2 GREEN: the integration passes as soon as tasks 6 (modal), 7 (FacturaFormPage), and 2 (hooks) are in place. No new code; the test is a regression guard.
- [x] 9.3 Triangulate: repeat for `PagoFormPage` (the `POST /api/pagos` integration). Run `vitest`; all pass.
- [x] 9.4 Triangulate: add a test for the cancel flow — the user opens the modal, picks an image, sees the proposal, clicks "Cancelar". The modal closes; the form is empty; no request fires. Run `vitest`; passes.
- [x] 9.5 Triangulate: add a test for the error_429 flow — the user picks an image, the C-14 returns 429, the modal shows the countdown, the user clicks "Cancelar" after 3 seconds (asserted via fake timers), the modal closes. Run `vitest`; passes.
- [x] 9.6 Triangulate: add a test for the error_extractor flow — the user picks an image, the C-14 returns 200 with `error: true`, the modal shows the message + "Cargar manualmente" button. The user clicks "Cargar manualmente". The modal closes; the form is empty; the user can fill it manually. Run `vitest`; passes.
- [x] 9.7 Safety Net: re-run the full Vitest suite — no regression in the integration path.

## 10. Final verification

- [x] 10.1 Run `tsc --noEmit` (TS strict, zero `any`, zero errors). The `api.d.ts` extension is consistent with the C-14 Pydantic shape.
- [x] 10.2 Run `npm test -- --run` (the full Vitest suite). All green. The new tests added in tasks 1–9 are part of the suite. The pre-existing C-04 / C-05 / C-07 / C-09 / C-11 / C-13 tests must still pass.
- [ ] 10.3 Run `npm run lint` (if configured). Zero new warnings. — *PRE-EXISTING: `npm run lint` fails because ESLint v10 is installed but the v9 config format is used. Not in scope to fix (carried over from C-13).*
- [x] 10.4 Run `openspec validate c-15-ia-vision-frontend` — confirms the change artifacts are well-formed (all four artifacts present, the proposal references the right upstream archived changes, the spec compiles to the expected delta, no dangling references).
- [x] 10.5 Re-confirm that c-15a is archived and the backend `origen` field is in place (OQ-1 RESOLVED — Path B). Verify with `git log` or filesystem: `facturas-proveedores-api/app/schemas/factura.py:77` and `app/schemas/pago.py:61` declare `origen: Optional[OrigenDocumento] = None`; `app/services/factura_service.py:273` and `app/services/pago_service.py:169` use `datos.origen or OrigenDocumento.MANUAL`. This is the source of truth for tasks 7 and 8.

## Definition of done (apply phase)

- [x] All tasks 1–10 are checked off; all tests pass. (359/359 vitest + 0 tsc errors, verified independently)
- [x] The frontend introduces NO new npm package. (verified: no `package.json` change in `git status`)
- [x] The frontend introduces NO backend code, NO schema change, NO new endpoint. (verified: no `facturas-proveedores-api/` change in `git status`)
- [x] The frontend SENDS `origen: 'IA'` from the client after an IA-modal confirm (OQ-1 RESOLVED — Path B via c-15a). Fully-manual entries do NOT include `origen`. (verified: integration test `FacturaFormPage.iaConfirm.test.tsx` and `PagoFormPage.iaConfirm.test.tsx` assert the payload; `FacturaForm.tsx` and `PagoForm.tsx` tag the mutation with `origen: 'IA'` only on prefill)
- [x] The modal NEVER persists directly (RN-IA-04 — the persist is the existing C-09 / C-11 mutation on the form's submit). (verified: `propuestaModalReducer` has no POST action; modal returns the picked supplier + proposal via `onConfirm`; form consumes via `prefillFromProposal` prop and submits only on its own Confirmar)
- [x] The modal NEVER pre-selects a supplier (RN-IA-06 — `SupplierSearch` value is `null` until the user picks). (verified: `PropuestaFacturaFields.test.tsx` asserts `SupplierSearch` value is `null` even when `propuesta.proveedor_nombre` is non-null; `Confirmar` is disabled until user picks)
- [x] The modal NEVER invents a field value the proposal did not return (RN-IA-03). (verified: `api.iaVision.test.ts` runtime guard excludes `origen`, `factura_id`, `id`, `usuario_id`, `proveedor_id`, `created_at`, `updated_at`; `parsePropuestaFactura`/`parsePropuestaPago` helpers strip only what the schema declares)
- [x] The 429 countdown does NOT auto-retry; the user MUST click "Reintentar" or "Cancelar". (verified: `propuestaModalReducer` only transitions on user actions; `PropuestaIAModal.e2e.test.tsx` error_429 flow uses fake timers and asserts the modal stays in error_429 until user clicks)
- [x] The `api.d.ts` extension matches the C-14 Pydantic shape; the compile-time guards in `api.iaVision.test-d.ts` lock the contract. (verified: `tsc --noEmit` passes 0 errors; `api.iaVision.test-d.ts` runtime guard confirms `Object.keys` excludes forbidden fields)
- [x] The "Cargar con imagen (IA)" button is hidden in edit mode on both forms. (verified: `FacturaFormPage.test.tsx` and `PagoFormPage.test.tsx` integration tests; the button is only mounted when the page is in create mode)
- [x] `openspec validate c-15-ia-vision-frontend` reports no errors. (verified)

## Review Workload Forecast

- **Estimated changed lines**: ~800–1100 across ~12 new files (feature-local, additive) + modifications to `FacturaFormPage`, `PagoFormPage`, and `api.d.ts` (3 modified files).
- **400-line budget risk**: **Medium** — single PR is on the edge of the 400-line budget. The new files (modal + components + tests) are large because the state machine has 7 states × 10 transitions.
- **Chained PRs recommended**: **Yes**.
  - **PR-A (foundation, ≤ ~250 lines)**: tasks 1 (types) + 2 (data layer) + 3 (ImagenPicker) + 4 (PropuestaFacturaFields) + 5 (PropuestaPagoFields). Tests ship with the code. No wiring to the form pages yet.
  - **PR-B (modal, ≤ ~350 lines)**: task 6 (PropuestaIAModal with the 7-state machine). Tests ship with the code. Still isolated to the new feature.
  - **PR-C (form integration, ≤ ~250 lines)**: tasks 7 (FacturaFormPage extension) + 8 (PagoFormPage extension). Touches the C-09 / C-11 form pages; the change is additive but modifies existing files.
  - **PR-D (E2E + verification, ≤ ~200 lines)**: task 9 (end-to-end integration) + task 10 (verification). Wires the new feature into the existing form flows and proves the contract.
- **Delivery strategy**: `ask-on-risk`. Decision needed before apply: **Yes** (chained PRs or `size:exception`).
- **Default if no decision**: chained PRs (A → B → C → D), stacked to main. The change is additive and feature-scoped; rollback is trivial at every chained-PR boundary (remove the IA button + unmount the modal).

## Work-unit commits (per chained PR)

- **PR-A**: one commit per task (1, 2, 3, 4, 5). Each commit is independently reviewable and the test suite stays green at each step.
- **PR-B**: one commit for the modal reducer (task 6.1, 6.2), one commit for the modal state transitions (task 6.3, 6.4, 6.5, 6.6). Two commits, easy to bisect.
- **PR-C**: one commit for `FacturaFormPage` extension (tasks 7.2, 7.3, 7.4, 7.5, 7.6, 7.7), one commit for `PagoFormPage` extension (tasks 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8). Two commits, easy to bisect.
- **PR-D**: one commit for the E2E integration tests (task 9), one commit for the final verification (task 10). Two commits, easy to bisect.
