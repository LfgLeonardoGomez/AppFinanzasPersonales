# Design: c-18-housekeeping-fixes

## Context

c-15a (origen=IA en backend), c-15 (IA vision frontend), c-16 (fix suite + spec headers), and c-17 (fix test pollution) all shipped between 2026-06-27 and 2026-06-29, leaving the project at a clean baseline: 701 backend tests passing, ~359 frontend tests passing, MVP live and demoable. A targeted audit of the post-c-17 working tree surfaced 11 real issues — 4 critical frontend bugs, 2 high-priority UX defects, 1 docs drift, and 4 medium-priority style/dead-code issues — that are all small, mechanical, and isolated. They do not require business-rule changes, DB migrations, new endpoints, or new spec capabilities (with one exception: FE-005 adds an optional field to the `PagoResponse` schema, which requires a delta spec on `pagos-backend` and `pagos-frontend`).

The project has strict TDD discipline: every fix in this change has a regression test that fails on the unfixed code and passes on the fixed code. Conventional commits, no co-authored-by, no AI attribution (per `AGENTS.md` global rules). The 11 fixes are sized for **one commit per fix**; the total diff (code + tests + docs) is estimated at ~350 lines, well under the 400-line chained-PR threshold. A single coherent PR is recommended.

**Affected code (summary):**
- Frontend: 7 files + 3 new PNG files in `public/`.
- Backend: 4 files + 2 new tests.
- Docs: 1 file (`CHANGES.md`).
- Specs: 2 delta spec files in `openspec/changes/c-18-housekeeping-fixes/specs/`.

**No DB migration.** No new dependencies. No `app/services/factura_service.py` changes. No `app/routers/pagos.py` changes. The `PagoService` changes in FE-005 are limited to the response serializer (one new field, populated by an existing join or one targeted lookup).

## Goals / Non-Goals

**Goals:**

1. **Eliminate the 4 critical frontend bugs** (FE-001, FE-002, FE-003, FE-004) that break the SPA UX, the PWA installability audit, or the IA flow's no-duplicate-submission guarantee.
2. **Fix the high-priority UX defects** (FE-005 supplier name in edit-mode Pago, FE-008 delete-confirmation flow that fires before user consent).
3. **Apply 4 medium mechanical fixes** (MED-001 `__import__` cleanup, MED-004 deterministic ordering tiebreak, FE-006 type import style, FE-007 `formatSaldo` dedup).
4. **Bring `CHANGES.md` up to date** (META-001) so the project's canonical roadmap index reflects the 18 archived changes, not 15.
5. **Preserve the c-17 protected test baseline** (the 22 c-16/c-17 regression-guard tests stay green throughout).
6. **Keep the diff small and reviewable** — one commit per fix, one PR for the whole change.
7. **Lock every fix with a regression test** — the test must fail on the unfixed code and pass on the fixed code.

**Non-Goals:**

- No business-rule changes. The hard rules in `AGENTS.md` (no `saldo` persisted, no `factura_id` on `Pago`, isolation by `usuario_id` → 404) are preserved verbatim.
- No new endpoints, no new spec capabilities, no new spec folders under `openspec/specs/`.
- No DB migration (Alembic is untouched). The MED-004 fix is a query-level change; the column order does not need an index.
- No new Python or Node dependencies. The PWA icon generation (FE-002) is a one-shot script using only Node `Buffer` + a known valid PNG byte sequence; no `sharp`, no `pngjs`, no other image lib is added to the runtime or dev tree.
- No new test framework layers. The 11 fixes use the existing `pytest + testcontainers` (backend) and `Vitest + RTL + MSW` (frontend) stacks.
- No spec renames (the `perfil-usuario-api` / `perfil-usuario-frontend` asymmetry is Q-2/Q-4 in `knowledge-base/10_preguntas_abiertas.md`, out of scope for c-18).
- No retroactive edit of `openspec/changes/archive/**`.
- No refactor of working code. The 11 fixes are targeted; they do not refactor `FacturaService` / `PagoService` / `ProveedorService` beyond the FE-005 response serializer.
- No `MED-002`, `MED-003`, `MED-005`, `META-002`, `META-003`, `META-004`, or any `LOW-*` / `FE-009+` / `META-005+` items (all deferred to `known-debt.md` for the next housekeeping pass or for opportunistic fixing in the next change that touches the same files).

## Decisions

### D-1 — One commit per fix, 11 commits total, single PR

**What.** Each of the 11 tasks in `tasks.md` lands as a single commit. The full change is one PR (or one squash-merge into the main branch). Commit messages follow conventional commits (`fix(fe): ...`, `fix(be): ...`, `chore(docs): ...`).

**Why one commit per fix.** A single 11-task change with intermixed frontend, backend, and docs edits is hard to bisect if a regression lands later. One commit per fix means: `git log --oneline -- facturas-proveedores-web/src/features/facturas/FacturasPage.tsx` shows the exact commit that swapped `window.location.href` for `useNavigate()`. The history is self-documenting.

**Why one PR.** The total diff is ~350 lines (estimated), well under the 400-line chained-PR threshold from the `chained-pr` skill. Splitting the PR would mean an artificial dependency between the frontend FE-001 and the docs META-001 commits (the CHANGES.md update reflects both). A single PR with 11 atomic commits is the cleanest deliverable.

**Why not one giant commit.** A 350-line single commit is unreviewable. The reviewer would have to skim 350 lines and trust the description. Eleven 30-line commits with clear titles and bodies are reviewable in 10 minutes.

### D-2 — FE-001 / FE-004: SPA navigation uses `useNavigate` / `<Link>`, never `window.location`

**What.**
- FE-001: `FacturasPage.tsx:49` and `PagosPage.tsx:42` swap `window.location.href = ...` for `void navigate(...)` from `useNavigate()`. The `useNavigate` hook is added to the existing `react-router-dom` import block.
- FE-004: `app/router.tsx:31-102` replaces the 7 `<a href="...">` tags in `HomePage` with `<Link to="...">`. The `Link` import is added to the existing `react-router-dom` import block.

**Why `useNavigate` over `Link` for the list page.** The list-page edit button is rendered inside a row, not a navigation entry. `<Link>` requires a `to` prop that's a static string; the dynamic `/facturas/${id}/editar` and `/pagos/${id}/editar` are easier with `useNavigate()` inside the `onEditFactura` / `onEditPago` handler. This is the React Router idiomatic pattern for "imperative navigation from an event handler."

**Why `<Link>` over `useNavigate` for the home page.** The home page has 7 static navigation entries. `<Link>` is declarative and renders as `<a href>` for accessibility, with the SPA navigation handled by React Router at click time. The home page is rendered once at mount, so the cost of `useNavigate()` x 7 is not worth the verbosity.

**Alternatives considered.**
- *Use `<Link>` everywhere.* Doesn't work for the list-page edit button (the destination is dynamic per row).
- *Keep `window.location.href`.* Rejected — that's the bug.
- *Use a global `navigate` helper from `@shared/api/navigateToLogin`.* The login-redirect helper exists for the Axios interceptor; reusing it for in-app navigation muddles its single responsibility.

### D-3 — FE-002: PWA icons generated by a one-shot Node script (no new npm dependency)

**What.** Three PNG files are added to `facturas-proveedores-web/public/`:
- `pwa-192x192.png` — 192×192 PNG, transparent background, a flat-color "FP" logo (Facturas Proveedores).
- `pwa-512x512.png` — 512×512 PNG, same logo.
- `pwa-512x512.maskable.png` — 512×512 PNG, same logo with the safe-zone padding that the maskable spec requires (the inner 80% of the image is the safe area).

**Strategy.** The apply phase writes a one-shot Node script (`scripts/generate-pwa-icons.mjs`) that uses ONLY Node's built-in `Buffer` and `zlib` to emit a minimal valid PNG with the project's brand color (`#1e40af`) as the background and a 2-character "FP" mark. The script is run once during this change and the resulting PNGs are committed to the repo. The script itself is NOT committed to `package.json` scripts (it's a one-shot, not a recurring build step) — it lives in `scripts/` as a one-time generator and is documented in the commit body so a future contributor can re-run it if the brand color changes.

**Why a script and not a placeholder.** A 1×1 transparent PNG works for the build but looks bad when installed on a phone. The Lighthouse PWA audit accepts any valid PNG, so the visual quality is purely cosmetic. The script ensures the icon is on-brand and matches the `theme_color: '#1e40af'` from `manifest.json`.

**Why not add `sharp` or `pngjs` to devDependencies.** The script runs once. Adding a dependency to handle a one-shot is over-engineering. Node's `zlib` is sufficient to emit a valid PNG (deflate-compressed pixel data, CRC-32 checksum, IHDR + IDAT + IEND chunks). The script is ~60 lines of clear, commented code.

**Why not commit a placeholder and skip the script.** A placeholder would satisfy the build but fail the "design quality" bar the project maintains (c-13 established the brand color, c-15 set the polish). A 1×1 transparent icon on a user's home screen is a regression in PWA quality.

**Alternatives considered.**
- *Use an existing online tool to generate the PNGs and commit the output.* Works, but is opaque — the contributor would not be able to reproduce the icons without re-running the tool.
- *Add a `vite-plugin-pwa-icons` or `vite-plugin-pwa-asset-generator` dependency.* Rejected — those plugins run at build time and generate icons from a single SVG source. The project does not have a logo SVG; adding one is a separate design task. The one-shot script is the smallest viable change.
- *Skip FE-002 entirely and let the build continue with missing icons.* Rejected — the Lighthouse "installable PWA" audit fails, the PWA still installs but with a broken icon, and the project loses the "installable PWA" badge that c-01 established.

### D-4 — FE-003: IA button `disabled` while mutation is `isPending` (the spec already requires it)

**What.** In `FacturaFormPage.tsx` and `PagoFormPage.tsx`, the "Cargar con imagen (IA)" button is wrapped in a conditional that reads the form mutation's `isPending` state. The current code structure is:

```tsx
<PagoForm
  onSuccess={handleSuccess}
  ...
  prefillFromProposal={iaPrefill}
/>
```

The `PagoForm` (and `FacturaForm`) component owns the `useCreatePago` (or `useCreateFactura`) mutation. The page-level "Cargar con imagen (IA)" button is a sibling of the form, not a child, so it cannot read the form's mutation state directly.

**The fix.** Two options were considered:

- **Option A (lift the mutation to the page).** Move the `useCreatePago` hook to the page, pass the mutation as a prop to the form, and let the page read `isPending` directly. Clean state ownership, but the form's `onSuccess` callback needs to be preserved (the page navigates on success).
- **Option B (lift the `isPending` boolean via a callback).** Add a `onMutationStateChange?: (isPending: boolean) => void` prop to the form, called from `useCreatePago`'s `onSuccess` / `onError` / `onSettled`. The page stores the boolean in local state. Less idiomatic React, more indirection.

**Chosen: Option A.** Cleaner state ownership, easier to test (the page can mock the mutation directly), and the form is now "dumb" — it receives a mutation as a prop, calls it, and reports the result. The form's public API is unchanged from the consumer's perspective (the page still calls `onSuccess` after the mutation settles).

**Why the spec is not modified.** The `facturas-frontend` and `pagos-frontend` specs already include the requirement: "The button SHALL be disabled while the form's own `useCreateFactura` (or `useCreatePago`) mutation is `isPending`" (with the corresponding scenario). FE-003 is the implementation fix for an already-specified behavior. No delta spec is needed for FE-003.

**The test.** A Vitest + RTL test that renders `FacturaFormPage` (or `PagoFormPage`) with a mocked `useCreateFactura` that returns `isPending: true` while the form is in flight. The test asserts that the "Cargar con imagen (IA)" button has the `disabled` attribute.

### D-5 — FE-005: backend adds `proveedor_nombre` to `PagoResponse`, service populates it

**What.**

1. `app/schemas/pago.py` — `PagoResponse` gains a new optional field:
   ```python
   proveedor_nombre: Optional[str] = None
   ```
   The field is `Optional` with a `None` default for backward compatibility (any caller that ignores it is unaffected; older tests that construct `PagoResponse` directly still pass).

2. `app/services/pago_service.py` — the response serializer (currently a `PagoResponse.model_validate(pago)` call in `crear`, `actualizar`, `obtener`, `listar_por_usuario`, `listar_por_proveedor`) is updated to populate the field. Two strategies depending on the call path:
   - For `obtener` (single Pago) and the create/update paths, the related `Proveedor` is already loaded by the service (e.g., via `_get_owned_proveedor` in `crear` / `actualizar`). The serializer passes `proveedor_nombre=pago.proveedor.nombre` after the join.
   - For `listar_por_usuario` and `listar_por_proveedor`, the existing query does not eagerly load the related `Proveedor`. The service adds a single targeted lookup: `proveedores = {p.id: p.nombre for p in self._repo_proveedor.get_many(ids)}` after the list query, then maps names to pagos by `proveedor_id`. This is one extra SQL round-trip per list call (a single `SELECT id, nombre FROM proveedor WHERE id IN (...)`).

3. The TS types regenerate from OpenAPI and the frontend (`PagoFormPage.tsx`) drops the UUID fallback. The readonly supplier display now uses `pago.proveedor_nombre`.

**Why backend, not frontend.** The decision matrix (option (a) backend vs option (b) frontend parallel `useProveedor`):
- **(a) Backend populates `proveedor_nombre`**: 1 SQL round-trip per list call, 0 extra HTTP requests on the frontend, 1 new optional field in the response schema, 1 service test, 0 frontend test changes. Backward compatible (the field is `Optional[str]`).
- **(b) Frontend does `useProveedor(pago.proveedor_id)` in parallel**: 1 extra HTTP request per visible payment in the edit form (or a separate lookup in the list page), 1 new React Query hook, harder to test (the lookup is async and races with the form's own state), worse UX (the readonly supplier field shows a spinner for ~50ms while the name loads).
- **Chosen: (a).** Cleaner contract, no parallel requests, and the cost on the backend is bounded — a single indexed lookup that returns the names for the page's pagos in one round-trip.

**Why `Optional[str] = None` and not `str`.** A `Pago` whose `Proveedor` is soft-deleted (the supplier was deleted after the pago was created — RN-PROV-04 permits this; the pago stays in the FIFO pool) would not have a `proveedor_nombre` to return. The `Optional` default is the correct contract: the field is "the supplier's name if the supplier still exists, else `None`."

**The delta spec.** `pagos-backend` gets an ADDED requirement: "PagoResponse includes proveedor_nombre" with scenarios for the populated case, the soft-deleted-supplier case, and the backward-compat case. `pagos-frontend` gets an ADDED requirement: "Edit-mode PagoFormPage displays the supplier name from PagoResponse.proveedor_nombre" with a scenario for the populated case and a scenario for the `None` case (which falls back to the UUID, preserving the current behavior).

**The test.** A service test that:
1. Creates a `Pago` with a known `Proveedor` and asserts `PagoResponse.proveedor_nombre` is the supplier's name.
2. Soft-deletes the `Proveedor` and asserts `PagoResponse.proveedor_nombre` is `None` (not 404, not 500).

### D-6 — FE-008: delete confirmation dialog fires BEFORE the DELETE mutation

**What.** In `ProveedoresList.tsx:46-67`, the current code is:

```tsx
function handleDeleteClick(proveedor: ProveedorListItem) {
  deleteMutation.mutate(proveedor.id, {
    onSuccess: (res) => {
      if (res.tiene_dependencias) {
        setPendingDelete(proveedor)
        setShowConfirmDialog(true)
      }
    },
  })
}
```

The fix is to open the dialog first, then call the mutation only if the user confirms:

```tsx
function handleDeleteClick(proveedor: ProveedorListItem) {
  setPendingDelete(proveedor)
  setShowConfirmDialog(true)
}

function handleConfirmDelete() {
  if (!pendingDelete) return
  deleteMutation.mutate(pendingDelete.id, {
    onSuccess: () => {
      setPendingDelete(null)
      setShowConfirmDialog(false)
    },
  })
}
```

**The two-pass pattern.** The backend returns `tiene_dependencias` on the first DELETE; if the user confirms, the second DELETE actually removes the supplier. The current code merges the two passes into one (the dialog only appears on `tiene_dependencias=true`). The fix keeps the two passes but moves the dialog to the start: the dialog shows "this will delete the supplier AND its N facturas/M pagos" (informational), the user confirms, and the mutation fires. The `tiene_dependencias` response is still used by the dialog to show the dependency count.

**Why not skip the dialog entirely when `tiene_dependencias=false`.** The dialog is a confirmation step. Even when there are no dependencies, a soft-delete is destructive enough to warrant a confirm. The original UX intent (c-07's D-C07-4) was "always confirm before delete"; the bug is that the confirmation only fires when there are dependencies, not that the confirmation is unnecessary.

**The test.** A Vitest + RTL test that renders `ProveedoresList` with a mock `useDeleteProveedor` mutation, clicks the delete button, and asserts that:
1. The confirmation dialog is rendered.
2. The mutation is NOT called.
3. After the user confirms, the mutation IS called.
4. After the user cancels, the mutation is NOT called and the dialog is dismissed.

### D-7 — MED-001: top-level `Decimal` import

**What.** `app/routers/proveedores.py:79` currently does:

```python
saldos.get(p.id, __import__("decimal").Decimal("0.00")),
```

The fix is to add `from decimal import Decimal` to the top-level imports (the file already imports from `decimal` indirectly, but not as a top-level import) and change the body to:

```python
saldos.get(p.id, Decimal("0.00")),
```

**Why.** `__import__("decimal").Decimal("0.00")` is a code smell. It works (Python resolves the import at call time), but a linter (`ruff`, `flake8`, `pylint`) will flag it, and a new contributor reading the line will think "why is this an import? Is it lazy? Is it for testing?" The top-level import is the idiomatic Python pattern and the rest of the file already uses `Decimal` from the top-level import block (verify with grep before landing the change).

**Why not a `try/except` for the `default` argument.** A `dict.get(key, default)` is the idiomatic Python pattern; the issue is the spelling of `default`, not the pattern. The fix is one import + one body line.

**The test.** No new test. The behavior is identical (the `default` is still `Decimal("0.00")`), and the existing test suite covers the code path. The acceptance criterion is "`ruff` reports no `__import__` calls in `app/routers/proveedores.py`."

### D-8 — MED-004: deterministic ordering tiebreak on `id`

**What.** Two `order_by` clauses are extended to add `id` as a final tiebreak:

1. `app/repositories/pago_repository.py:50`:
   ```python
   statement = statement.order_by(Pago.fecha, Pago.created_at, Pago.id)
   ```
2. `app/repositories/proveedor_repository.py:216`:
   ```python
   statement = statement.order_by(func.lower(Proveedor.nombre).asc(), Proveedor.id.asc())
   ```

**Why the FIFO pool needs deterministic order.** The `FacturaService.estado_fifo` algorithm iterates over a provider's pagos (the "pool") and applies them to the provider's facturas in order. If two pagos have the same `fecha` and `created_at` (which can happen at sub-millisecond resolution on Postgres with `now()` defaults), Python's `set` semantics or Postgres's internal row order can return them in a different order on different runs. Adding `id` (a UUID) as the final tiebreak makes the order deterministic without relying on insertion order or wall-clock resolution.

**Why on the proveedor `list_by_usuario` order_by too.** The current `func.lower(Proveedor.nombre).asc()` order can return proveedores in different orders across runs if two suppliers share a name (case-insensitive). Adding `id` as the final tiebreak ensures the page boundaries are stable, so a supplier on page 1 today is on page 1 tomorrow.

**Why not a SQL `DISTINCT ON` or a `GROUP BY` rewrite.** The current query is correct; the fix is a 5-character append (the `, Pago.id` or `, Proveedor.id`). A rewrite is a larger change with no behavior benefit.

**The test.** A repository test that:
1. Creates 3 `Pago` records with identical `fecha` and `created_at` (using `datetime(2026, 1, 1, 12, 0, 0)` and a manually-set `created_at` to force the collision).
2. Calls `repo.list_active_by_proveedor(usuario_id, proveedor_id)` and asserts the response order matches the `id` order.

### D-9 — FE-006 / FE-007: style fixes, no new tests

**What.**
- **FE-006** — `FacturaFormPage.tsx:82` and `PagoFormPage.tsx:117` move the inline `import('@shared/api/api').PropuestaPago` to the top-level import block. `PagoFormPage.tsx` already imports `PropuestaPago` as a value; the function signature uses the inline import for the `union` type. Move both to the top. `FacturaFormPage.tsx` needs a new `PropuestaPago` import.
- **FE-007** — `ProveedoresList.tsx:27-33` removes the local `formatSaldo` helper and the 2 call sites use `formatMonto` from `@shared/utils/currency`. The helper is a verbatim duplicate of `formatMonto` (verified during the audit).

**Why no new tests.** These are style fixes; the behavior is identical. The acceptance is "the existing test suite still passes" and "the affected file has no `any` types and no inline `import(...)` calls in function signatures" (verified by `tsc --noEmit` and by `grep`).

### D-10 — META-001: `CHANGES.md` brings the index to 18 changes

**What.** `CHANGES.md` is updated in 4 places:
1. **Dependency tree** (lines 21-37): add C-15a, C-16, C-17 as leaves under their respective parents (C-15a under C-14, C-16 under "C-13 housekeeping", C-17 under "C-13 housekeeping"). The tree is rewritten to show 18 leaves, not 15.
2. **FASE 9 / housekeeping sub-section** (new): add a short "Housekeeping post-MVP" section before the "Resumen" section that lists C-15a, C-16, C-17 with their archived dates, scopes, and dependencies (mirroring the existing per-change entries).
3. **Summary table** (lines 439-455): add 3 new rows for C-15a, C-16, C-17. Change the "Total" line (line 457) from "15 changes · 9 fases · 12 gates de paralelismo" to "18 changes · 9 fases + housekeeping post-MVP · 12 gates de paralelismo".
4. **"Primer change recomendado" footnote** (lines 459-461): update from "Para arrancar: `/opsx:propose C-01-foundation-setup`" to "MVP completo. Para el siguiente change de housekeeping, ver C-15a/C-16/C-17 (archivados) o el actual C-18 (en curso). Para el primer feature post-MVP, ver el backlog del orquestador."

**Why this format.** The existing `CHANGES.md` is the canonical roadmap index. The audit found that the file was last touched when C-13 was archived, so the 3 housekeeping changes that landed in the next 2 days are invisible to anyone reading the file. The update is purely additive (no existing entry is removed or rewritten; the 3 new entries follow the same shape).

**Why not a `CHANGELOG.md` separate file.** `CHANGES.md` is already the per-change scope index. A separate `CHANGELOG.md` for housekeeping would duplicate the information. The fix is to keep `CHANGES.md` as the single source of truth and update it.

**The test.** No automated test. The acceptance is: `git diff CHANGES.md` shows the 4 expected edits; `wc -l CHANGES.md` increases by ~80 lines (3 new entries × ~25 lines each); the "Total" line reads "18 changes".

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| The FE-005 backend change adds a SQL round-trip per list call (one `SELECT id, nombre FROM proveedor WHERE id IN (...)` for the page's pagos). At 50 pagos per page, this is 50 IDs in the IN clause — well within Postgres's index lookup performance. | The MED-004 fix already adds a `(usuario_id, proveedor_id, deleted_at)` index path; the new IN-clause lookup uses the same index. The performance overhead is bounded and measurable. A future change can optimize by using a single `JOIN` instead of an IN-clause lookup, but that's a MED-002-style algorithmic improvement, deferred. |
| The FE-002 PWA icon script is a one-shot generator that does not run in CI. If the brand color changes, the icons will be stale. | The script is committed to `scripts/generate-pwa-icons.mjs` and documented in the commit body. A future contributor can re-run it. The script is not added to `package.json` scripts (it's a one-shot, not a build step). |
| The FE-008 dialog UX change means a user must click "Confirm" twice for a clean delete (once to open the dialog, once to confirm). This is a 1-click regression from the current "1 click to delete" path. | The current 1-click path is the BUG. The user's mental model is: "click delete → see confirmation → confirm or cancel." The fix matches the mental model. The `tiene_dependencias` response still drives the dialog's informational content (e.g., "this will also delete N facturas and M pagos"). |
| The FE-005 service-layer change touches `PagoService` (5 methods: `crear`, `actualizar`, `obtener`, `listar_por_usuario`, `listar_por_proveedor`). The diff is ~30 lines per method, but the methods are tested independently. | The c-17 protected test suite covers the service layer's authorization and FIFO behavior. The 5 methods are tested in `tests/test_pago_service.py` (verify before landing the change). The FE-005 service test adds 1 new test per method's response shape, for 5 new tests. |
| The MED-004 deterministic ordering change might affect snapshot tests that assert on list response order. The order was already non-deterministic for the colliding case, so the snapshot tests either (a) don't cover the colliding case, or (b) assert on a specific order that may have been the wrong order. | The apply phase runs the test suite before and after the change and inspects any snapshot diffs. If a snapshot fails, the test is updated to assert on the new (correct) order, with a comment explaining the deterministic tiebreak. |
| The CHANGES.md update is ~80 lines of additions. A contributor reading the file in 6 months may be confused by the new "housekeeping" section being out of order with the FASE numbering. | The new section is clearly titled "Housekeeping post-MVP" and is placed BEFORE the "Resumen" section. The summary table is updated in place. The "Primer change recomendado" footnote makes the new project state explicit. |
| The FE-001 / FE-004 navigation changes might break a contributor's muscle memory (e.g., a long-standing test that mocks `window.location.href`). | The apply phase greps the test suite for `window.location` references and updates any test that depends on the old behavior. The expectation is that no test relies on the full-page reload (it's a frontend UX concern, not a backend contract). |

## Migration Plan

This is a housekeeping change. The deployment story:

1. **Apply the c-18 change in a working branch** (no in-progress feature work).
2. **Run the full backend test suite:** `cd facturas-proveedores-api && pytest tests/ -q --tb=line`. **Expected:** `0 failed, N+ passed` where `N >= 701` (c-17 baseline) + 2 new tests (FE-005 service test, MED-004 repository test).
3. **Run the full frontend test suite:** `cd facturas-proveedores-web && npm run test -- --run`. **Expected:** `0 failed, M+ passed` where `M >= 359` (current baseline) + 6 new tests (FE-001, FE-002, FE-003, FE-004, FE-005, FE-008).
4. **Run the frontend build:** `cd facturas-proveedores-web && npm run build`. **Expected:** completes with no Vite PWA warnings about missing icons. Verify the `dist/` directory contains `pwa-192x192.png`, `pwa-512x512.png`, and `pwa-512x512.maskable.png` (or a hashed equivalent).
5. **Run the c-17 protected tests:** `cd facturas-proveedores-api && pytest tests/test_alembic_migration_0003.py tests/test_config.py tests/test_deps.py -v`. **Expected:** 22/22 still pass.
6. **Run `openspec validate c-18-housekeeping-fixes`.** **Expected:** `Change 'c-18-housekeeping-fixes' is valid`.
7. **Inspect the diff:** `git status` shows the expected files; `git diff --stat` shows ~350 lines of additions, 0 deletions outside the expected files. No `facturas-proveedores-api/app/services/factura_service.py` changes. No `facturas-proveedores-api/app/routers/pagos.py` changes. No `openspec/changes/archive/**` changes. No `pyproject.toml` / `requirements*.txt` changes.
8. **Smoke-test the SPA:** start the dev server, navigate to `/`, click "Cargar pago" (no full-page reload), click "Cargar factura" (no full-page reload), open an existing payment's edit form (the supplier name shows, not a UUID), open the proveedores list, click delete on a supplier with dependencies (the dialog appears, the mutation does NOT fire until you confirm).
9. **Smoke-test the PWA installability:** run `npm run build && npm run preview`, then load the app in Chrome, open DevTools → Application → Manifest, verify the icons are listed and resolve to actual PNG files. Run the Lighthouse "Installable PWA" audit; the score should be 100/100.
10. **Merge the PR.** Single squash-merge, conventional commit message: `chore: c-18 housekeeping fixes (11 issues, post-MVP)`.
11. **Rollback:** revert the merge commit. The change is fully reversible; no DB migration, no new endpoints, no destructive operations. If FE-005 is the only commit that landed, reverting it drops the `proveedor_nombre` field from the response, and the frontend falls back to the UUID display (the bug returns, but the system is not broken).

## Open Questions

- **Q-C18-1 (resolved at propose time):** Should FE-005 use option (a) backend populates `proveedor_nombre` or option (b) frontend does a parallel `useProveedor` lookup?
  - **Decision:** option (a). See D-5.
- **Q-C18-2 (resolved at propose time):** Should the FE-002 PWA icon script be added to `package.json` as a `prebuild` script?
  - **Decision:** no. The script is a one-shot generator; adding it to the build pipeline means it runs on every `npm run build`, which is wasteful and couples the icons to the build. The icons are committed to the repo; the script is committed to `scripts/` for future regeneration if needed.
- **Q-C18-3 (open):** Should the FE-005 `proveedor_nombre` field be added to `PagoListItem` as well, or only to `PagoResponse`?
  - **Recommendation:** only `PagoResponse` for now. The list page (`PagosPage.tsx`) does not display the supplier name in the readonly mode (the list is a paginated table; the supplier name is shown via the `SupplierSearch` filter chip, not per row). If a future change needs the name in the list, it can be added then. This keeps the FE-005 diff minimal.
- **Q-C18-4 (open):** Should the META-001 CHANGES.md update add a new "FASE 10" section for housekeeping, or add a "Housekeeping post-MVP" section without a FASE number?
  - **Recommendation:** no FASE number. Housekeeping changes are not part of the MVP delivery sequence; they are post-completion. The section is titled "Housekeeping post-MVP" and is placed after FASE 9, before the "Resumen" section. The "Resumen" table is updated in place. The "Total" line counts all 18 changes.
- **Q-C18-5 (open):** Should c-18 split the FE-005 backend change into a separate PR (e.g., c-19) so the FE-005 spec delta is reviewed independently of the 10 other fixes?
  - **Recommendation:** no, keep c-18 as a single PR. FE-005 is one of 11 fixes; the 11 are interrelated (the audit found them together). Splitting FE-005 into a separate PR would mean 12 changes for the next reviewer to track. The FE-005 delta spec is 1 page and the FE-005 service test is 1 test; both are reviewable in the c-18 PR. If the FE-005 review surface is too large for a single PR, the orchestrator can split it per the `chained-pr` skill.
