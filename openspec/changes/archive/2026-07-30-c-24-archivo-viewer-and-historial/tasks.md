# Tasks: c-24-archivo-viewer-and-historial

> Strict TDD: every behaviour starts from a failing test written against the current code.
> Scope reminder: `_build_historial`'s ORDER and the `saldo_acumulado` algorithm are NEVER touched — only the value threaded through and the frontend's display-only reversal.

## 1. Baseline

- [x] 1.1 Run the backend suite (`.venv/Scripts/python.exe -m pytest -q`) and record the exact pass count as the safety net
- [x] 1.2 Run the frontend suite (`npx vitest run`) and record the exact pass count as the safety net

## 2. Backend — EntradaHistorial.archivo_url schema (RED → GREEN)

- [x] 2.1 In `tests/test_cuenta_corriente_schemas.py`, add a test that `EntradaHistorial.model_validate` accepts an `archivo_url` string and a test that it defaults to `None` when omitted; run and confirm both FAIL for the right reason (field does not exist yet — Pydantic ignores unknown extra fields by default, so assert on `obj.archivo_url` after validation, not just that validation succeeds)
- [x] 2.2 Add `archivo_url: Optional[str] = None` to `EntradaHistorial` in `app/schemas/cuenta_corriente.py`; run and confirm GREEN
- [x] 2.3 Triangulate: add a test with `archivo_url=None` explicitly passed, confirming it's accepted (not just omitted)

## 3. Backend — thread archivo_url through _build_historial (RED → GREEN → TRIANGULATE)

- [x] 3.1 In `tests/test_cuenta_corriente_historial_helper.py`, add `archivo_url: Optional[str] = None` to `FakeFactura` and `comprobante_url: Optional[str] = None` to `FakePago` (defaults preserve all 12 existing test instantiations unchanged)
- [x] 3.2 Add a failing test: a FACTURA row's result dict has `archivo_url` equal to the fake factura's `archivo_url`; confirm it FAILS (key is absent) before implementing
- [x] 3.3 Add a failing test: a PAGO row's result dict has `archivo_url` equal to the fake pago's `comprobante_url`
- [x] 3.4 Implement: extend the tagged tuple in `_build_historial` (`app/services/proveedor_service.py`) to carry `archivo_url` (factura's `archivo_url` for FACTURA rows, pago's `comprobante_url` for PAGO rows) and include it in the output dict; run 3.2 and 3.3, confirm GREEN
- [x] 3.5 Triangulate: add a test where both `archivo_url`/`comprobante_url` are `None` on the underlying fakes and assert the result dict's `archivo_url` is `None`
- [x] 3.6 Run the full `test_cuenta_corriente_historial_helper.py` file — all 13 pre-existing tests plus the new ones pass (16 total); no ordering or saldo_acumulado assertion changed

## 4. Backend — service-layer integration test (real Postgres)

- [x] 4.1 In `tests/test_cuenta_corriente_service.py`, extend `_make_pago_db` and `_make_factura_db` with an optional `archivo_url` / `comprobante_url` kwarg (default `None`) — additive, does not change existing call sites
- [x] 4.2 Add an end-to-end test: a factura created with an `archivo_url` and a pago created with a `comprobante_url` produce `historial` entries whose `archivo_url` matches each. NOTE: implementation (3.4) preceded this test since it was written as part of the same TDD cycle as the pure-function tests — this test is a GREEN confirmation of the wiring end-to-end (real Postgres), not a fresh RED cycle. Reported explicitly, per the task's own escape hatch.
- [x] 4.3 Run `test_cuenta_corriente_service.py`, `test_cuenta_corriente_schemas.py`, `test_cuenta_corriente_historial_helper.py` — all green (61 passed, up from 53 baseline)

## 5. Frontend — types

- [x] 5.1 Attempted `npm run generate-types` — the live dev API reflects concurrent, unrelated in-progress work from other agents/changes; the regeneration produced a ~3000-line diff unrelated to this change. Reverted (`git checkout --`).
- [x] 5.2 Hand-edited `api.d.ts` to add exactly one field (`archivo_url?: string | null`) to `EntradaHistorial`, matching the backend Pydantic schema and the file's existing doc-comment conventions; noted the manual edit and the reason inline in the file and in this report.

## 6. Frontend — ArchivoPreviewDialog (RED → GREEN → TRIANGULATE)

- [x] 6.1 Create `src/shared/components/ArchivoPreviewDialog/ArchivoPreviewDialog.test.tsx` with a failing test: given an image URL, an `<img>` with the right `src` renders, plus the "Abrir en pestaña nueva" link with the right `href`/`target`/`rel`
- [x] 6.2 Create `ArchivoPreviewDialog.tsx` (Radix Dialog, controlled `open`/`onOpenChange`, sr-only Title/Description, `max-h-[90dvh]` + internal scroll container per design D1/D3) — minimum to pass 6.1
- [x] 6.3 Add a failing test: given a `.pdf` URL, the embedded PDF viewer element renders (plus the same fallback link); implement the branch, confirm GREEN
- [x] 6.4 Triangulate: a `.pdf?v=2` URL (query string) still renders the PDF branch (extension check must ignore the query string)
- [x] 6.5 Triangulate: `url={null}` renders no dialog content (`queryByRole('dialog')` is null)
- [x] 6.6 Test: pressing Escape calls `onOpenChange(false)`
- [x] 6.7 Test: the dialog's content node declares a `dvh` max-height and a scroll container (assert via className, matching the C-23 `modal-viewport-fit` pattern)

## 7. Frontend — TablaFacturasConEstado wiring (RED → GREEN)

- [x] 7.1 Update `TablaFacturasConEstado.test.tsx`: change the existing `getByRole('link', { name: /ver archivo/i })` assertions to `getByRole('button', ...)`, dropping the `href`/`target`/`rel` assertions (they no longer apply to a button) — run and confirm this now FAILS against the current `<a>` implementation
- [x] 7.2 Change the "Ver archivo" cell in `TablaFacturasConEstado.tsx` from `<a>` to `<button>` that sets local preview state `{url, title}` and renders one `ArchivoPreviewDialog` for the table; confirm 7.1 passes
- [x] 7.3 Add a test: clicking "Ver archivo" on a row opens the dialog with that row's `archivo_url` (`getByRole('dialog')` appears, dialog content references the URL)
- [x] 7.4 Triangulate: clicking "Ver archivo" on row A, closing, then clicking row B's button reopens the dialog with row B's URL (not stale row A state)
- [x] 7.5 Confirm the "no button when archivo_url is null" test (already exists, adapt role from link to button) still passes

## 8. Frontend — PagosRegistrados Archivo column (RED → GREEN → TRIANGULATE)

- [x] 8.1 In `PagosRegistrados.test.tsx`, add fixtures with `archivo_url` set (one) and unset/null (one); add a failing test asserting a "Ver archivo" button renders for the row with `archivo_url` and opens `ArchivoPreviewDialog` with that URL
- [x] 8.2 Add a failing test asserting "—" (or the table's existing placeholder) renders for the row without `archivo_url`, with no button
- [x] 8.3 Add the "Archivo" `<th>`/`<td>` column to `PagosRegistrados.tsx`, wire the same local-dialog-state pattern as 7.2; confirm both tests pass
- [x] 8.4 Confirm the three pre-existing `PagosRegistrados.test.tsx` tests (empty state, row rendering, no-resort order) still pass unchanged

## 9. Frontend — CuentaCorrientePage historial order toggle (RED → GREEN → TRIANGULATE — highest risk)

- [x] 9.1 In `CuentaCorrientePage.test.tsx`, add a fixture with 3 historial entries with distinct, known `saldo_acumulado` values; add a failing test: on first render of the Historial tab, the FIRST rendered row is the response's LAST entry (newest-first default) — confirmed it failed against current ASC-only rendering (4 new tests RED)
- [x] 9.2 Implement: `useState<'asc'|'desc'>('desc')` + `useMemo(() => (order === 'desc' ? [...cuentaCorriente.historial].reverse() : cuentaCorriente.historial), [cuentaCorriente.historial, order])`, passed to `HistorialCronologico` instead of the raw array; added the explanatory comment per design D5 (never `.sort()`, never recompute); confirmed 9.1 passes
- [x] 9.3 Add the asc/desc toggle control near the "Historial cronológico" heading (only rendered when `tab === 'historial'`)
- [x] 9.4 **Regression-critical**: added a test that for EVERY entry, the rendered `saldo_acumulado` in `desc` mode is byte-identical to the value rendered for the same entry in `asc` mode — only row position differs, plus a sanity check the 3 values are genuinely distinct
- [x] 9.5 Add a test: toggling from `desc` back to `asc` restores the exact response order (first rendered row is `historial[0]`)
- [x] 9.6 Confirmed the existing cross-block invariant test still passes — it queries by `data-testid` (row identity), not position, so it was already toggle-order-agnostic; added an explicit companion test asserting the newest-first (default) row shows the SaldoBadge value
- [x] 9.7 Confirmed the empty-historial test still passes regardless of toggle state

## 10. Full-suite verification

- [x] 10.1 Ran the full backend suite; 788 passed, 1 failed in 492s. The 1 failure (`tests/test_alembic_migration_0005.py::test_database_url_restored_after_teardown`) is in a file explicitly owned by the concurrent c-25 change (not touched by this change) — reported as out of scope, not fixed. Zero regressions attributable to c-24 (cuenta-corriente files alone: 53 baseline → 61 after, +8 new tests, all green)
- [x] 10.2 Ran the full frontend suite; 476 passed (70 files) baseline → 491 passed (71 files) after — zero regressions, +15 net new tests (14 from this change; the 1-test discrepancy is attributable to other agents' concurrent, disjoint-scope work in this shared repo), +1 new file (`ArchivoPreviewDialog.test.tsx`)
- [x] 10.3 Ran `npm run typecheck` — zero errors (one `exactOptionalPropertyTypes` issue found and fixed: `title?: string | undefined` on `ArchivoPreviewDialogProps`)
- [x] 10.4 Ran `npm run lint` — zero errors project-wide
- [x] 10.5 All tasks marked `[x]`; final report delivered to the orchestrator
