# Tasks: c-18-housekeeping-fixes

> **Strict TDD discipline.** Every task follows: 0. Baseline (RED) → 1. Understand → 2. RED (write a failing test that fails for the right reason) → 3. GREEN (minimum code to pass) → 4. TRIANGULATE (add ≥1 more case per behavior, watch all pass) → 5. REFACTOR (keep tests green) → 6. Mark complete.
>
> **This change is housekeeping.** 11 mechanical fixes, no business-rule changes, no DB migration, no new endpoints. Each task is one commit. Order: CRITICAL → HIGH → MEDIUM.
>
> **Test layers in this change:**
> - **Frontend tests** (FE-001, FE-002, FE-003, FE-004, FE-005, FE-008): Vitest + RTL + MSW. Each new test lives next to the file it tests (e.g., `FacturasPage.test.tsx`, `PagoFormPage.test.tsx`).
> - **Backend tests** (FE-005 service, MED-004 repository): pytest + testcontainers. The new tests live in `tests/test_pago_service.py` and `tests/test_pago_repository.py` (verify file names before landing).
> - **Style fixes** (FE-006, FE-007, MED-001): no new tests; acceptance is "the existing test suite still passes" + a `tsc --noEmit` / `ruff check` clean.
> - **Docs fix** (META-001): no automated test; acceptance is "the CHANGES.md diff matches the 4 expected edits."
>
> **This change introduces no new business behavior.** The bulk of TDD evidence is the 8 new tests (6 frontend + 2 backend) + the preserved c-17 baseline (701 backend + ~359 frontend tests).

## Task 1 — FE-001: SPA navigation in `FacturasPage.tsx` (CRITICAL, frontend)

- [ ] 1.1 **Understand.** Read `facturas-proveedores-web/src/features/facturas/FacturasPage.tsx:1-60`. Identify the `handleEditFactura` function (line 49) that uses `window.location.href = ...`. Note the existing import block.
- [ ] 1.2 **RED — write the regression test first.** Create (or extend) `facturas-proveedores-web/src/features/facturas/FacturasPage.test.tsx` with a test that:
  - Renders `FacturasPage` with a mock list of 1 factura.
  - Mocks `useNavigate` from `react-router-dom` (via `vi.mock`).
  - Triggers the row's "Edit" action.
  - **Asserts** that `useNavigate` was called with `/facturas/${factura.id}/editar` AND that `window.location.href` was NOT assigned.
  - **Expected:** test FAILS because the current code uses `window.location.href` (the mock for `useNavigate` is never called).
- [ ] 1.3 **GREEN — apply the minimum fix.** In `FacturasPage.tsx`:
  - Add `useNavigate` to the existing `react-router-dom` import: `import { useSearchParams, Link, useNavigate } from 'react-router-dom'`.
  - Inside `FacturasPage`, add `const navigate = useNavigate()`.
  - Change `function handleEditFactura(factura: FacturaListItem)` body from `window.location.href = \`/facturas/${factura.id}/editar\`` to `void navigate(\`/facturas/${factura.id}/editar\`)`.
  - **Expected:** the test from 1.2 PASSES.
- [ ] 1.4 **TRIANGULATE.** Add a second test case to the same file: trigger "Edit" on a second factura, assert `useNavigate` is called with the second factura's id. **Expected:** both tests pass.
- [ ] 1.5 **REFACTOR.** Remove any now-unused imports. Verify the file still type-checks (`tsc --noEmit`).
- [ ] 1.6 **Cross-check.** Run `npm run test -- --run src/features/facturas/FacturasPage.test.tsx` from `facturas-proveedores-web/`. **Expected:** the new tests pass + the existing `FacturasPage` tests still pass.

## Task 2 — FE-001 (cont.): SPA navigation in `PagosPage.tsx` (CRITICAL, frontend)

> Same fix as Task 1, applied to `PagosPage.tsx:42`. Same TDD discipline. Can be done in the same commit as Task 1, or as a separate commit (the orchestrator decides; recommendation: separate commit so the history is per-file).

- [ ] 2.1 **Understand.** Read `facturas-proveedores-web/src/features/pagos/PagosPage.tsx:1-60`. Identify `handleEditPago` (line 42).
- [ ] 2.2 **RED.** Create `facturas-proveedores-web/src/features/pagos/PagosPage.test.tsx` with the analogous test (mock `useNavigate`, trigger edit, assert `useNavigate` called and `window.location.href` NOT assigned). **Expected:** test FAILS.
- [ ] 2.3 **GREEN.** Apply the same fix pattern as Task 1.3. **Expected:** test PASSES.
- [ ] 2.4 **TRIANGULATE.** Add a second test case with a different pago. Both pass.
- [ ] 2.5 **REFACTOR.** Verify `tsc --noEmit` is clean.
- [ ] 2.6 **Cross-check.** `npm run test -- --run src/features/pagos/PagosPage.test.tsx`. All pass.

## Task 3 — FE-002: PWA icons in `public/` (CRITICAL, frontend)

- [ ] 3.1 **Understand.** Read `facturas-proveedores-web/public/manifest.json` and `facturas-proveedores-web/vite.config.ts` to confirm the icon filenames and sizes. Verify the files do NOT exist (`ls facturas-proveedores-web/public/`).
- [ ] 3.2 **RED — write the build-time test first.** Add a Vitest test (in `facturas-proveedores-web/src/shared/pwa-icons.test.ts` or similar) that asserts the 3 PNG files exist and are valid PNGs (read the first 8 bytes; the PNG signature is `89 50 4E 47 0D 0A 1A 0A`). The test reads the files from `public/` via `fs.readFileSync` (or `import.meta.glob`).
  - **Expected:** test FAILS (the files do not exist).
- [ ] 3.3 **GREEN — generate the PNGs.** Write `facturas-proveedores-web/scripts/generate-pwa-icons.mjs` (one-shot Node script using only `Buffer` + `zlib`). The script generates 3 PNGs:
  - `pwa-192x192.png` — 192×192, background `#1e40af`, "FP" mark in white.
  - `pwa-512x512.png` — 512×512, same.
  - `pwa-512x512.maskable.png` — 512×512, same with the inner 80% as the safe area.
  - Run the script: `node scripts/generate-pwa-icons.mjs`. The files are written to `public/`.
  - **Expected:** the test from 3.2 PASSES.
- [ ] 3.4 **TRIANGULATE.** Extend the test to also assert the PNG dimensions (read the IHDR chunk's width and height bytes). **Expected:** both dimensions are correct.
- [ ] 3.5 **Build verification.** Run `npm run build` from `facturas-proveedores-web/`. **Expected:** build completes with no Vite PWA warnings about missing icons. Verify `dist/pwa-192x192.png`, `dist/pwa-512x512.png`, and `dist/pwa-512x512.maskable.png` (or the hashed equivalents) exist.
- [ ] 3.6 **Commit.** Commit the 3 PNGs + the script + the test. The PNGs are checked in (not gitignored); the script lives in `scripts/` and is documented in the commit body.

## Task 4 — FE-003: IA button `disabled` while mutation `isPending` in `FacturaFormPage` (CRITICAL, frontend)

> The spec already requires this. The implementation is the bug. No delta spec.

- [ ] 4.1 **Understand.** Read `facturas-proveedores-web/src/features/facturas/FacturaFormPage.tsx` (the `CreateFacturaPage` function, lines 60-130). Identify the `<button onClick={() => setIaModalOpen(true)}>Cargar con imagen (IA)</button>` (line 95-105) and the `FacturaForm` child (which owns `useCreateFactura`).
- [ ] 4.2 **RED.** Create (or extend) `facturas-proveedores-web/src/features/facturas/FacturaFormPage.test.tsx` with a test that:
  - Mocks `useCreateFactura` (or the `FacturaForm`'s underlying mutation hook) to return `isPending: true`.
  - Renders `FacturaFormPage`.
  - **Asserts** the "Cargar con imagen (IA)" button has the `disabled` attribute.
  - **Expected:** test FAILS (the current button is always enabled).
- [ ] 4.3 **GREEN — apply the minimum fix (Option A from D-4).** Refactor `FacturaFormPage` and `FacturaForm`:
  - Move `useCreateFactura` from `FacturaForm` to `FacturaFormPage` (or to a new wrapper component).
  - Pass the mutation (or a `{ mutate, isPending }` shape) to `FacturaForm` as a prop.
  - In `FacturaFormPage`, read `isPending` from the mutation and pass it as a prop to the IA button, OR pass it to `FacturaForm` which renders the IA button itself (the orchestrator picks the cleaner of the two — the simpler refactor is to move the IA button into `FacturaForm` so the button is a sibling of the form's other buttons, all reading the same `isPending`).
  - The button's `disabled={isPending}` attribute is set.
  - **Expected:** test PASSES.
- [ ] 4.4 **TRIANGULATE.** Add a second test: when `isPending: false`, the button is NOT disabled. **Expected:** both pass.
- [ ] 4.5 **REFACTOR.** Verify no `any` types were introduced. `tsc --noEmit` clean.
- [ ] 4.6 **Cross-check.** `npm run test -- --run src/features/facturas/FacturaFormPage.test.tsx`. All pass + the existing `FacturaForm` tests still pass.

## Task 5 — FE-003 (cont.): IA button `disabled` while mutation `isPending` in `PagoFormPage` (CRITICAL, frontend)

- [ ] 5.1 **Understand.** Read `facturas-proveedores-web/src/features/pagos/PagoFormPage.tsx` (the `CreatePagoPage` function).
- [ ] 5.2 **RED.** Add a test to `PagoFormPage.test.tsx`: mock `useCreatePago` to return `isPending: true`, render, assert IA button has `disabled`. **Expected:** FAILS.
- [ ] 5.3 **GREEN.** Apply the same refactor as Task 4.3. **Expected:** PASSES.
- [ ] 5.4 **TRIANGULATE.** Add a `isPending: false` case. Both pass.
- [ ] 5.5 **REFACTOR + cross-check.** Same as Task 4.5/4.6.

## Task 6 — FE-004: SPA navigation in `HomePage` (HIGH, frontend)

- [ ] 6.1 **Understand.** Read `facturas-proveedores-web/src/app/router.tsx:1-110`. Identify the 7 `<a href="...">` tags in `HomePage` (lines 38-101).
- [ ] 6.2 **RED.** Add a test to a new `facturas-proveedores-web/src/app/router.test.tsx` (or `HomePage.test.tsx`) that:
  - Renders the `HomePage` via the router.
  - Asserts that all 7 navigation links are `<a>` tags rendered by React Router (e.g., they have the `href` attribute AND the click handler does NOT trigger a page reload).
  - The test mocks `useNavigate` or uses `@testing-library/user-event` to click each link and asserts the URL changes via the router (not via `window.location`).
  - **Expected:** test FAILS (the current code uses plain `<a>` tags with full reload).
- [ ] 6.3 **GREEN.** In `router.tsx`:
  - Add `Link` to the existing `react-router-dom` import: `import { createBrowserRouter, Navigate, Link } from 'react-router-dom'`.
  - Replace each `<a href="...">...</a>` with `<Link to="...">...</Link>`. The styling and content are preserved verbatim.
  - **Expected:** test PASSES.
- [ ] 6.4 **TRIANGULATE.** Add a test that clicks each of the 7 links and asserts the URL updates via the router. All 7 pass.
- [ ] 6.5 **REFACTOR.** Verify `tsc --noEmit` clean.
- [ ] 6.6 **Cross-check.** `npm run test -- --run src/app/router.test.tsx`. All pass.

## Task 7 — FE-005: `proveedor_nombre` in `PagoResponse` (HIGH, backend + frontend)

> The biggest single change in this housekeeping pass. Backend schema + service + test; frontend types regen + display fix + test. **One commit per side** (backend commit, frontend commit) so the bisect is clean.

### Backend (commit 7A)

- [ ] 7A.1 **Understand.** Read `facturas-proveedores-api/app/schemas/pago.py:80-105` (the `PagoResponse` class) and `facturas-proveedores-api/app/services/pago_service.py` (the 5 methods: `crear`, `actualizar`, `obtener`, `listar_por_usuario`, `listar_por_proveedor`). Identify the current response serializer pattern.
- [ ] 7A.2 **RED.** In `tests/test_pago_service.py` (or create if not present), add a test:
  - Create a `Usuario`, a `Proveedor`, and a `Pago` via the service.
  - Call `service.obtener(usuario_id, pago_id)`.
  - **Assert** `result.proveedor_nombre == proveedor.nombre`.
  - **Expected:** test FAILS (`PagoResponse` has no `proveedor_nombre` field).
- [ ] 7A.3 **GREEN.**
  - In `app/schemas/pago.py`, add `proveedor_nombre: Optional[str] = None` to `PagoResponse` (with the same `model_config`).
  - In `app/services/pago_service.py`, update each of the 5 methods' response serializer to populate the field:
    - `obtener` / `crear` / `actualizar`: the related `Proveedor` is already loaded; pass `proveedor_nombre=pago.proveedor.nombre` to `PagoResponse.model_validate(...)`.
    - `listar_por_usuario` / `listar_por_proveedor`: do a single targeted lookup `proveedores = {p.id: p.nombre for p in self._repo_proveedor.get_many({pago.proveedor_id for pago in pagos})}`, then map names in the serializer.
  - **Expected:** test PASSES.
- [ ] 7A.4 **TRIANGULATE.** Add 4 more tests:
  1. After soft-deleting the `Proveedor`, `PagoResponse.proveedor_nombre` is `None` (not 404, not 500).
  2. `listar_por_usuario` returns pagos with `proveedor_nombre` populated for all rows.
  3. `listar_por_proveedor` returns pagos with `proveedor_nombre` populated.
  4. `crear` returns a `PagoResponse` with `proveedor_nombre` populated.
  All pass.
- [ ] 7A.5 **REFACTOR.** Verify the service's `_to_response` helper (if it exists) is the single place that populates the field; the 5 methods all delegate to it. If not, refactor to a helper.
- [ ] 7A.6 **Cross-check.** `pytest tests/test_pago_service.py -v` from `facturas-proveedores-api/`. All pass + the existing `pago` service tests still pass.
- [ ] 7A.7 **Full suite check.** `pytest tests/ -q --tb=line`. **Expected:** `0 failed, N+ passed` (N >= 701).

### Frontend (commit 7B)

- [ ] 7B.1 **Understand.** Read `facturas-proveedores-web/src/features/pagos/PagoFormPage.tsx:50-65` (the `proveedorForDisplay` construction with the UUID fallback). Note: the TS types are generated from OpenAPI; the new optional `proveedor_nombre` field will appear after regenerating.
- [ ] 7B.2 **Regenerate TS types.** Run the OpenAPI types generation command (check `package.json` scripts for `gen:api` or similar). The new `proveedor_nombre` field appears in the `PagoResponse` type.
- [ ] 7B.3 **RED.** In `facturas-proveedores-web/src/features/pagos/PagoFormPage.test.tsx`, add a test:
  - Mock `usePago` to return a pago with `proveedor_nombre: "YPF S.A."` (the new field).
  - Render `PagoFormPage` in edit mode (route `/pagos/:id/editar`).
  - **Assert** the readonly supplier display shows "YPF S.A." (NOT the UUID).
  - **Expected:** test FAILS (the current code constructs `proveedorForDisplay` with `nombre: pago.proveedor_id` as a fallback, ignoring `proveedor_nombre`).
- [ ] 7B.4 **GREEN.** In `PagoFormPage.tsx:50-65`, change the `proveedorForDisplay` construction to use `pago.proveedor_nombre ?? pago.proveedor_id` (preserve the UUID fallback for the `None` case, when the supplier was soft-deleted).
  - **Expected:** test PASSES.
- [ ] 7B.5 **TRIANGULATE.** Add a second test: mock a pago with `proveedor_nombre: null`, render, assert the display falls back to the UUID. Both pass.
- [ ] 7B.6 **REFACTOR.** Verify no `any` types; `tsc --noEmit` clean.
- [ ] 7B.7 **Cross-check.** `npm run test -- --run src/features/pagos/PagoFormPage.test.tsx`. All pass.

## Task 8 — FE-006: type imports at top of file (MEDIUM, frontend)

- [ ] 8.1 **Understand.** Read `FacturaFormPage.tsx:82` and `PagoFormPage.tsx:117`. Identify the inline `import('@shared/api/api').PropuestaPago` inside the function signature.
- [ ] 8.2 **No new test.** Style fix; behavior is identical. Acceptance: the existing test suite passes + `tsc --noEmit` clean + `grep` for `import(` inside function signatures returns no results in the 2 files.
- [ ] 8.3 **GREEN.** In `FacturaFormPage.tsx`, add `PropuestaPago` to the existing `import type { ... } from '@shared/api/api'` block. Change the function signature to use the bare type name.
- [ ] 8.4 **GREEN.** In `PagoFormPage.tsx`, the type is already imported as a value (`PropuestaPago` in the existing import block); just remove the inline `import(...)` and use the bare name.
- [ ] 8.5 **REFACTOR.** `tsc --noEmit` clean. `npm run test -- --run` clean.

## Task 9 — FE-007: dedupe `formatSaldo` → `formatMonto` (MEDIUM, frontend)

- [ ] 9.1 **Understand.** Read `ProveedoresList.tsx:27-33` (the local `formatSaldo` helper) and `src/shared/utils/currency.ts` (the shared `formatMonto` helper). Verify the two are functionally identical.
- [ ] 9.2 **No new test.** Style fix; behavior is identical. Acceptance: the existing test suite passes + `formatSaldo` no longer exists in `ProveedoresList.tsx` + the 2 call sites use `formatMonto`.
- [ ] 9.3 **GREEN.** Remove the `formatSaldo` function. Add `import { formatMonto } from '@shared/utils/currency'`. Replace the 2 call sites with `formatMonto`.
- [ ] 9.4 **REFACTOR.** `tsc --noEmit` clean. `npm run test -- --run src/features/proveedores/ProveedoresList.test.tsx` (or whatever the test file is named) passes.

## Task 10 — FE-008: delete confirmation before mutation (MEDIUM, frontend)

- [ ] 10.1 **Understand.** Read `ProveedoresList.tsx:46-67` (the `handleDeleteClick` and `handleConfirmDelete` functions). Identify the bug: `handleDeleteClick` fires the mutation before the user confirms.
- [ ] 10.2 **RED.** Add a test to `ProveedoresList.test.tsx`:
  - Mock `useDeleteProveedor` to return a mutation with a `mutate` mock.
  - Render `ProveedoresList`, click the delete button on a supplier row.
  - **Assert** the confirmation dialog is rendered AND `mutate` was NOT called.
  - **Expected:** test FAILS (the current code calls `mutate` on click).
- [ ] 10.3 **GREEN.** Refactor:
  - `handleDeleteClick` opens the dialog (sets `pendingDelete` and `showConfirmDialog`) — does NOT call `mutate`.
  - `handleConfirmDelete` calls `mutate` only after the user confirms.
  - **Expected:** test PASSES.
- [ ] 10.4 **TRIANGULATE.** Add 2 more tests:
  1. After the user cancels, `mutate` is NOT called and the dialog is dismissed.
  2. After the user confirms, `mutate` IS called and the dialog is dismissed on success.
  All pass.
- [ ] 10.5 **REFACTOR.** Verify the dialog's content still shows the dependency count (use the `tiene_dependencias` from a mocked first-pass response if needed; the simplest path is to show "Eliminar proveedor" + the supplier name + a generic "Esta acción no se puede deshacer" warning, without the dependency count, since the dialog now fires before the first-pass response).
- [ ] 10.6 **Cross-check.** `npm run test -- --run src/features/proveedores/ProveedoresList.test.tsx`. All pass.

## Task 11 — MED-001: top-level `Decimal` import (MEDIUM, backend)

- [ ] 11.1 **Understand.** Read `facturas-proveedores-api/app/routers/proveedores.py:1-90`. Find the `__import__("decimal").Decimal("0.00")` call at line 79. Verify the file does NOT have a top-level `from decimal import Decimal` (it should not, or the `__import__` is unnecessary).
- [ ] 11.2 **No new test.** Behavior is identical. Acceptance: the existing test suite passes + `grep` for `__import__` in `app/routers/proveedores.py` returns 0 results + `ruff check app/routers/proveedores.py` is clean.
- [ ] 11.3 **GREEN.** Add `from decimal import Decimal` to the top-level imports. Change the body to `saldos.get(p.id, Decimal("0.00"))`.
- [ ] 11.4 **REFACTOR.** `ruff check app/` clean. `pytest tests/ -q` clean.

## Task 12 — MED-004: deterministic ordering tiebreak (MEDIUM, backend)

- [ ] 12.1 **Understand.** Read `facturas-proveedores-api/app/repositories/pago_repository.py:1-55` (the `list_active_by_proveedor` method, line 50) and `facturas-proveedores-api/app/repositories/proveedor_repository.py:140-220` (the `list_by_usuario` method, line 216).
- [ ] 12.2 **RED — write the regression test first.** In `tests/test_pago_repository.py` (or create if not present), add a test:
  - Create a `Usuario`, a `Proveedor`, and 3 `Pago` records with the SAME `fecha` (e.g., `date(2026, 1, 1)`) and the SAME `created_at` (force via direct INSERT or via a service that takes `created_at` as a parameter).
  - Call `repo.list_active_by_proveedor(usuario_id, proveedor_id)`.
  - **Assert** the response order matches the `id` order (deterministic).
  - **Expected:** test FAILS (the current code orders by `fecha, created_at` only; the 3 pagos have identical values, so the order is non-deterministic — the test asserts a specific order and the response may be in a different order).
- [ ] 12.3 **GREEN — fix the pago_repository order_by.** In `pago_repository.py:50`, change `.order_by(Pago.fecha, Pago.created_at)` to `.order_by(Pago.fecha, Pago.created_at, Pago.id)`. **Expected:** test PASSES.
- [ ] 12.4 **GREEN — fix the proveedor_repository order_by.** In `proveedor_repository.py:216`, change `statement = statement.order_by(func.lower(Proveedor.nombre).asc())` to `statement = statement.order_by(func.lower(Proveedor.nombre).asc(), Proveedor.id.asc())`.
- [ ] 12.5 **TRIANGULATE.** Add a second test in `tests/test_proveedor_repository.py`:
  - Create 3 `Proveedor` records with the SAME name (case-insensitive), e.g., all named "YPF".
  - Call `repo.list_by_usuario(usuario_id)`.
  - **Assert** the response order is deterministic (matches the `id` order).
  - Both tests pass.
- [ ] 12.6 **REFACTOR.** Verify no other `order_by` clauses in the repo layer are missing a tiebreak. `grep` for `order_by` in `app/repositories/` and audit each.
- [ ] 12.7 **Cross-check.** `pytest tests/test_pago_repository.py tests/test_proveedor_repository.py -v`. All pass + the existing repository tests still pass.
- [ ] 12.8 **Full suite check.** `pytest tests/ -q --tb=line`. **Expected:** `0 failed, N+ passed` (N >= 701 + 2 new tests).

## Task 13 — META-001: update `CHANGES.md` (META, docs)

- [ ] 13.1 **Understand.** Read `CHANGES.md` end-to-end. Note the 4 places to edit: dependency tree (lines 21-37), FASE 9 / housekeeping sub-section (new), summary table (lines 439-455), and "Primer change recomendado" footnote (lines 459-461).
- [ ] 13.2 **No new test.** Docs fix. Acceptance: `git diff CHANGES.md` shows the 4 expected edits + `wc -l CHANGES.md` increases by ~80 lines + the "Total" line reads "18 changes".
- [ ] 13.3 **Edit 1 — dependency tree.** Add C-15a, C-16, C-17 as leaves under their parents. The exact structure is in the design's D-10; mirror it.
- [ ] 13.4 **Edit 2 — new "Housekeeping post-MVP" section.** Add a new section before the "Resumen" section. Title: `## Housekeeping post-MVP`. List C-15a, C-16, C-17 with their archived dates, scopes, dependencies, and governance.
- [ ] 13.5 **Edit 3 — summary table.** Add 3 new rows for C-15a, C-16, C-17. Change the "Total" line from "15 changes" to "18 changes".
- [ ] 13.6 **Edit 4 — "Primer change recomendado" footnote.** Update to reflect that MVP is done and the next recommended step is the current housekeeping pass or the next feature.
- [ ] 13.7 **REFACTOR.** Read the file end-to-end after the edits. Verify the narrative is consistent (no orphan references, the new section flows into the "Resumen").

## Task 14 — Cross-bucket verification (c-17 protected tests + project invariants)

- [ ] 14.1 From `facturas-proveedores-api/`, run `pytest tests/test_alembic_migration_0003.py -v`. **Expected:** 6/6 passing.
- [ ] 14.2 From `facturas-proveedores-api/`, run `pytest tests/test_config.py -v`. **Expected:** 7/7 passing.
- [ ] 14.3 From `facturas-proveedores-api/`, run `pytest tests/test_deps.py -v`. **Expected:** 9/9 passing.
- [ ] 14.4 From `facturas-proveedores-web/`, run `npm run test -- --run`. **Expected:** all passing (existing 359 + 8 new = 367+).
- [ ] 14.5 From `facturas-proveedores-web/`, run `npm run build`. **Expected:** completes with no Vite PWA warnings.
- [ ] 14.6 From the project root, run `openspec validate c-18-housekeeping-fixes`. **Expected:** `Change 'c-18-housekeeping-fixes' is valid`.
- [ ] 14.7 From the project root, run `git status` and `git diff --stat`. **Expected:** only the expected files changed. **No** `app/services/factura_service.py` changes. **No** `app/routers/pagos.py` changes. **No** `openspec/changes/archive/**` changes. **No** `pyproject.toml` or `requirements*.txt` changes.
- [ ] 14.8 From the project root, run `npx tsc --noEmit` in `facturas-proveedores-web/` and `ruff check app/ tests/` in `facturas-proveedores-api/`. **Expected:** both clean.

## Task 15 — Documentation companion (`known-debt.md`)

- [ ] 15.1 Create `openspec/changes/c-18-housekeeping-fixes/known-debt.md` mirroring c-16 and c-17's pattern. The file documents:
  - The 11 issues addressed in this change (with file:line references).
  - The 7+ issues deferred (MED-002, MED-003, MED-005, META-002, META-003, META-004, LOW-001..004, FE-009..011, META-005..006) with file:line references and the rationale for deferring.
  - The c-17 protected test baseline (22 tests) that must stay green.
  - The 8 new tests added in this change (6 frontend + 2 backend).
- [ ] 15.2 The file is for downstream reference; the next change that touches the affected code can pick up the deferred items opportunistically.

## Review Workload Forecast

- **Estimated changed lines:** ~350 total (200 code + 150 tests + 80 docs). Breakdown:
  - Frontend code: ~100 lines (FE-001: 4, FE-002: 60 script, FE-003: 30 refactor, FE-004: 12, FE-005: 8, FE-006: 4, FE-007: 4, FE-008: 15).
  - Frontend tests: ~120 lines (6 new test files × ~20 lines each).
  - Frontend assets: 3 PNG files (~10 KB each).
  - Backend code: ~40 lines (FE-005: 30, MED-001: 2, MED-004: 2).
  - Backend tests: ~80 lines (2 new test functions × ~40 lines each).
  - Docs: ~80 lines (CHANGES.md additions).
  - Specs: ~40 lines (2 delta spec files).
- **Chained PRs recommended:** **No.** Single coherent housekeeping change. The 11 fixes are interrelated (the audit found them together) but each is small enough to be a single commit. A single PR with 13 atomic commits (11 fixes + 1 backend commit + 1 frontend commit for FE-005 split = 13; the design allows for splitting FE-005 into 2 commits) is reviewable in 15-20 minutes.
- **400-line budget risk:** **Low.** The upper bound is ~400 lines (with comments and tests). If a test file is unexpectedly long, the orchestrator can split per the `chained-pr` skill, but the expected case is a single PR.
- **Breaking surface:** **None at the public API level.** FE-005 adds an optional field to `PagoResponse`; all other changes are internal (refactors, style fixes, icon files). The TS contract regenerates and gains an optional field; consumers that don't reference it are unaffected.
- **C-19+ unblocked:** this change brings the codebase to a state where the next feature change can land without inheriting 11 small defects. The CHANGES.md index is up to date; the PWA is installable; the SPA doesn't full-reload; the IA flow's button is correctly disabled; the edit-mode Pago shows the supplier name; the ordering is deterministic.
- **Follow-up housekeeping (out of scope):** the 7+ deferred items in `known-debt.md` are captured for the next housekeeping pass or for opportunistic fixing in the next change that touches the same files.

## Definition of done (apply phase)

- [ ] All tasks 1–15 are checked off; the full backend test suite reports `0 failed` and the full frontend test suite reports `0 failed` (with 8+ new tests added).
- [ ] The c-17 protected tests still pass: 22/22.
- [ ] Each fix has a regression test (or a clear non-test acceptance criterion for style/docs fixes) that fails on the unfixed code and passes on the fixed code.
- [ ] `CHANGES.md` reflects 18 archived changes (not 15).
- [ ] The PWA icons are present in `public/` and `dist/` (after `npm run build`).
- [ ] The change introduces no new Python or Node dependency.
- [ ] `openspec validate c-18-housekeeping-fixes` is clean.
- [ ] `git diff --stat` shows the expected files changed; no `app/services/factura_service.py` or `app/routers/pagos.py` changes; no `openspec/changes/archive/**` changes; no `pyproject.toml` or `requirements*.txt` changes.
