# Proposal: c-18-housekeeping-fixes

## Why

A targeted audit of the c-15a/15/16/17-baseline (701 backend tests passing, ~359 frontend tests passing, MVP live) surfaced **11 issues** that are real defects or quality debt, none of which require a business-rule change. They range from critical (frontend bugs visible to the user, like full-page reloads that break the SPA) to mechanical (style, imports, deterministic ordering, dead code). The cost of NOT addressing them is concrete:

- **FE-001** (`window.location.href` in `FacturasPage.tsx:49` and `PagosPage.tsx:42`): each "Edit" click triggers a full-page reload, which **destroys the SPA** — auth bootstrap re-runs, TanStack Query cache is wiped, the `RequireAuthWithBootstrap` guard flashes, and the back button history is broken. The PWA loses its installability feel.
- **FE-002** (missing PWA icons): `vite.config.ts` and `public/manifest.json` reference `pwa-192x192.png`, `pwa-512x512.png`, and `pwa-512x512.maskable.png`, but the files do not exist in `facturas-proveedores-web/public/`. The build does not fail (Vite's PWA plugin tolerates missing icon files at build time), so the user installs the PWA and sees a broken icon / "missing asset" warning. Lighthouse's "installable PWA" audit fails.
- **FE-003** ("Cargar con imagen (IA)" button not disabled while mutation is `isPending`): the **spec already requires this** in both `facturas-frontend` (Requirement: IA button disabled while mutation is in flight) and `pagos-frontend` (same requirement), but the implementation only sets `disabled` on the inner form buttons, not the IA button. A user can click "Cargar con imagen (IA)" while a `useCreateFactura` is in flight, which opens the modal, files a second `POST /api/facturas/extraer-ia`, and the user ends up with a duplicate payment flow.
- **FE-004** (HomePage uses 7 plain `<a href>` tags in `router.tsx:31-102`): same problem as FE-001, but on the home page. The user navigates to "Cargar pago" and the entire SPA reloads.
- **FE-005** (edit-mode Pago shows supplier UUID as the name): `PagoFormPage.tsx:51-63` constructs a `ProveedorListItem` with `nombre: pago.proveedor_id` as a fallback, because the `PagoResponse` schema does not include `proveedor_nombre`. The user sees a UUID string in the readonly supplier field on the edit screen — a real UX defect.
- **META-001** (`CHANGES.md` still says "15 changes"): the c-15a, c-16, c-17 archive commits landed after the "Resumen" section was last touched. Anyone reading `CHANGES.md` to discover the project's history gets a stale picture.
- **MED-001** (`__import__("decimal").Decimal("0.00")` in `app/routers/proveedores.py:79`): working code, but a `__import__` call inside a function body is a code smell that a linter or new contributor will flag.
- **MED-004** (`PagoRepository.list_active_by_proveedor` orders by `(fecha, created_at)` without `id` as a final tiebreak in `app/repositories/pago_repository.py:50`): the FIFO pool algorithm in `app/services/factura_service.py` is deterministic only when its input is deterministic. Two pagos with the same `fecha` and `created_at` (which can happen at sub-millisecond resolution on fast hardware) yield a non-deterministic pool, which can flip a `PENDIENTE` to `PARCIAL` between runs. Same risk in `proveedor_repository.py:216` where the order is by `func.lower(Proveedor.nombre)` and ties in name (e.g., "YPF" appears twice) yield non-deterministic page boundaries.
- **FE-006** (inline `import('@shared/api/api').PropuestaPago` type import inside a function signature in `FacturaFormPage.tsx:82` and `PagoFormPage.tsx:117`): works in Vite/TS, but `tsconfig` strict + `verbatimModuleSyntax` would reject it, and any future contributor copy-pasting the pattern is at risk. Style debt, not a bug.
- **FE-007** (local `formatSaldo` helper in `ProveedoresList.tsx:27-33` duplicates `formatMonto` in `@shared/utils/currency`): c-13 established `formatMonto` as the single source of truth for ARS formatting. `ProveedoresList.tsx` was missed in that migration.
- **FE-008** (delete flow fires the DELETE mutation BEFORE the user confirms in `ProveedoresList.tsx:46-67`): the dialog only shows up on the **second** click (the success callback of the first). The expected flow is: click delete → see dialog → confirm → DELETE. The current flow is: click delete → DELETE silently → if `tiene_dependencias` → dialog. The user has no chance to back out of a soft-delete they did not mean to do.

**This change is explicitly housekeeping**, post-MVP. No business rules change. No new endpoints. No DB migration. No spec renames. The goal is to bring the project to a state where the next agent (working on c-19+ or the first real feature beyond MVP) inherits clean code, a complete changelog, and an icon-complete PWA.

## What Changes

**Frontend (7 fixes, 4 critical / 2 high / 1 medium):**

1. **FE-001** — Replace `window.location.href = ...` with `useNavigate()` in `FacturasPage.tsx:49` and `PagosPage.tsx:42`. Adds `useNavigate` to the import from `react-router-dom` and changes the `handleEditFactura` / `handleEditPago` function bodies.
2. **FE-002** — Add `pwa-192x192.png`, `pwa-512x512.png`, `pwa-512x512.maskable.png` to `facturas-proveedores-web/public/`. Strategy: generate minimal valid PNGs (1x1 transparent, scaled to 192/512 via any lib, or a small synthetic image) and verify `npm run build` completes without Vite PWA warnings.
3. **FE-003** — In `FacturaFormPage.tsx` and `PagoFormPage.tsx`, the "Cargar con imagen (IA)" button is `disabled` while the form mutation (`useCreateFactura` / `useCreatePago`) is `isPending`. The button is currently a child of the page, not the form, so it needs the mutation state lifted up or passed down. Specs already require this; this is the implementation fix.
4. **FE-004** — In `app/router.tsx:31-102`, the 7 `<a href>` tags in `HomePage` are replaced with `<Link to>` from `react-router-dom`. No new imports beyond what is already used.
5. **FE-005** — Backend: add `proveedor_nombre: Optional[str] = None` to `PagoResponse` in `app/schemas/pago.py`. Service layer: in `PagoService._to_response(...)` (or equivalent), populate the field by reading the related `Proveedor` (already loaded in most paths via the `get` / `list_by_usuario` joins, or by a single targeted lookup). Frontend: in `PagoFormPage.tsx`, use `pago.proveedor_nombre` as the readonly display, drop the UUID fallback.
6. **FE-006** — Move the inline `import('@shared/api/api').PropuestaPago` to the top-level import block in `FacturaFormPage.tsx` and `PagoFormPage.tsx`. The `PropuestaPago` type is already imported as a value in `PagoFormPage.tsx`; `FacturaFormPage.tsx` needs a new import. One-line cleanup per file.
7. **FE-007** — Remove the local `formatSaldo` helper in `ProveedoresList.tsx:27-33` and replace its 2 call sites with `formatMonto` from `@shared/utils/currency`. The helper is a verbatim duplicate of `formatMonto` (c-13's D13 single source of truth).
8. **FE-008** — In `ProveedoresList.tsx:46-67`, refactor the delete flow so the confirmation dialog shows up FIRST, only calling `deleteMutation.mutate` if the user confirms. The current code triggers the mutation on click, then opens the dialog only if the response says `tiene_dependencias`. The fix is to open the dialog on click; the dialog then calls the mutation.

**Backend (2 fixes, both medium):**

9. **MED-001** — In `app/routers/proveedores.py:79`, replace `__import__("decimal").Decimal("0.00")` with a top-level `from decimal import Decimal` import. One-line import + one-line body change.
10. **MED-004** — In `app/repositories/pago_repository.py:50`, change `.order_by(Pago.fecha, Pago.created_at)` to `.order_by(Pago.fecha, Pago.created_at, Pago.id)`. Same in `app/repositories/proveedor_repository.py:216` (add `Proveedor.id` as the final tiebreak after `func.lower(Proveedor.nombre).asc()`). Add a test that creates 3 pagos with identical `fecha` and `created_at` (using `datetime` microsecond precision or by stubbing the column) and asserts the response order is deterministic.

**Docs (1 fix, meta):**

11. **META-001** — Update `CHANGES.md`: add entries for C-15a, C-16, C-17 (Status, Scope, Dependencies, Governance, Leer antes); update the dependency tree; add the 3 housekeeping changes (C-15a, C-16, C-17) to the summary table; change "15 changes" to "18 changes" on line 457; update the "Primer change recomendado" footnote to reflect that MVP is done and the recommended next step is `c-18-housekeeping-fixes` or c-15a/16/17 if not yet applied.

**No BREAKING changes.** No schema migrations. No new endpoints. No Pydantic schema removals or renames. The `PagoResponse` addition (FE-005) is additive only — the new `proveedor_nombre` field defaults to `None` for any caller that was not populating it (e.g., older tests, third-party tooling), so backward compatibility is preserved. The TS contract regenerates from OpenAPI and gains a new optional field; consumers that do not reference the field are unaffected.

## Capabilities

### New Capabilities

None. This is a housekeeping change; no new spec capabilities are introduced. The frontend IA-button guard (FE-003) is already covered by existing requirements in `facturas-frontend` and `pagos-frontend` (the `disabled` while `isPending` scenario). FE-005 is additive to existing `pagos-backend` and `pagos-frontend` capabilities.

### Modified Capabilities

- `pagos-backend`: add a requirement to the `PagoResponse` schema that includes `proveedor_nombre: Optional[str]` populated by the service layer. This is an additive schema change; the existing `Read a single payment` and `List a supplier's payments` requirements are extended (not broken) by the new field.
- `pagos-frontend`: add a requirement that the edit-mode `PagoFormPage` displays the supplier's `nombre` from `PagoResponse.proveedor_nombre` (the field that the backend now populates), not the UUID fallback that was there as a workaround.

## Impact

**Frontend code (`facturas-proveedores-web/`):**

- `src/features/facturas/FacturasPage.tsx` — FE-001.
- `src/features/facturas/FacturaFormPage.tsx` — FE-003, FE-006.
- `src/features/pagos/PagosPage.tsx` — FE-001.
- `src/features/pagos/PagoFormPage.tsx` — FE-003, FE-005, FE-006.
- `src/features/proveedores/components/ProveedoresList.tsx` — FE-007, FE-008.
- `src/app/router.tsx` — FE-004.
- `public/pwa-192x192.png` — FE-002 (new file).
- `public/pwa-512x512.png` — FE-002 (new file).
- `public/pwa-512x512.maskable.png` — FE-002 (new file).
- `src/shared/api/api.ts` — regenerated from OpenAPI (FE-005: new optional `proveedor_nombre` on `PagoResponse`).
- Tests added: 1 per frontend fix that has a user-visible behavior (FE-001, FE-002, FE-003, FE-004, FE-005, FE-008). Style fixes (FE-006, FE-007) do not need new tests; their acceptance is "the affected call sites still type-check and behave identically" — verified by the existing test suite.

**Backend code (`facturas-proveedores-api/`):**

- `app/routers/proveedores.py` — MED-001.
- `app/repositories/pago_repository.py` — MED-004.
- `app/repositories/proveedor_repository.py` — MED-004.
- `app/schemas/pago.py` — FE-005 (add `proveedor_nombre: Optional[str] = None` to `PagoResponse`).
- `app/services/pago_service.py` — FE-005 (populate `proveedor_nombre` in the response serializer; in the create/get/list paths, the related `Proveedor` is already available via the `_get_owned_proveedor` lookup or via a single join; the cost is one extra column read per response).
- Tests added: 1 service test for FE-005 (asserts `PagoResponse.proveedor_nombre` is populated); 1 repository test for MED-004 (asserts deterministic ordering when `fecha` and `created_at` collide). Total new backend tests: 2.

**Docs:**

- `CHANGES.md` — META-001: add C-15a, C-16, C-17 entries; update dependency tree, summary table, and "Total" line; update the "Primer change recomendado" footnote.

**Specs (delta files inside this change's `specs/` folder):**

- `openspec/changes/c-18-housekeeping-fixes/specs/pagos-backend/spec.md` — FE-005: ADDED requirement for `proveedor_nombre` in `PagoResponse`.
- `openspec/changes/c-18-housekeeping-fixes/specs/pagos-frontend/spec.md` — FE-005: ADDED requirement for edit-mode supplier name display.

**Not impacted:**

- `knowledge-base/` — no rule changes. The hard rules in `AGENTS.md` (no saldo persisted, no `factura_id` on Pago, isolation by `usuario_id` → 404, snake_case Python, no `any` in TS) are preserved. The new tests enforce them.
- `pyproject.toml`, `requirements*.txt` — no new dependencies. FE-002 generates PNGs using a one-shot script (Node `Buffer` + a known valid PNG byte sequence) or by using a minimal npm script that runs once during this change; the script is NOT added to the runtime dependency tree.
- `docker-compose.yml`, `docker-compose.override.yml` — unchanged.
- `openspec/changes/archive/**` — immutable. The C-15a, C-16, C-17 archives are referenced by name only, not modified.
- `app/services/factura_service.py`, `app/services/proveedor_service.py` (except for the `PagoService._to_response` change in FE-005) — no business-logic changes.
- `app/routers/pagos.py` — no router change. FE-005 is at the schema + service layer; the router keeps its thin shape.

**Verification target after GREEN (the apply phase, not this proposal):**

- `cd facturas-proveedores-api && pytest tests/ -q --tb=line` → `0 failed, N+ passed` where `N >= 701` (c-17 baseline) + the 2 new tests for FE-005 and MED-004.
- `cd facturas-proveedores-web && npm run test -- --run` → `0 failed, M+ passed` where `M >= 359` (current baseline) + the new tests for FE-001, FE-002, FE-003, FE-004, FE-005, FE-008.
- `cd facturas-proveedores-web && npm run build` → completes with no Vite PWA warnings about missing icons.
- `openspec validate c-18-housekeeping-fixes` → clean.

## Out of scope (documented as known debt, not in this change)

These were flagged by the same audit but are explicitly deferred:

- **MED-002** — `_build_historial` in `app/services/proveedor_service.py` sorts O(n log n) but could be merged in O(n+m) since the two source lists are already date-ordered. Algorithmic improvement, not a bug. The current sort is correct and fast enough at MVP scale.
- **MED-003** — Some Pydantic schemas use `date.today()` for the not-future check instead of the explicit `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")` pattern that c-15a/16 established. The behavior is identical for the MVP's deployment timezone, but a contributor in a different timezone could ship a regression. Style fix, deferred.
- **MED-005** — `app/routers/proveedores.py` accesses `svc._repo` (the private repo attribute) directly in one path. The fix is to add a public method to the service. Small refactor, not urgent; no behavior change.
- **META-002** — `docs/` contains 693 lines of orphan content that was replaced by `knowledge-base/`. Decide later whether to delete or to keep as a historical snapshot.
- **META-003** — `npm run lint` script in `package.json` references an ESLint config that was never added. The script fails. Either add ESLint or remove the script. Decide later.
- **META-004** — The IA extractor (c-14) has ~90 lines duplicated between the Claude and OpenAI adapters. Refactor to a shared prompt template. Not a bug; both adapters are tested independently.
- **LOW-001..004, FE-009..011, META-005..006** — minor style / nits captured in the audit, not worth a housekeeping change. Will be picked up opportunistically in the next change that touches the same files.

Each deferred item is captured in a `known-debt.md` companion file in this change (mirroring c-16's and c-17's pattern) so the next change that touches the affected code can address them.

## Known constraints (carried forward from the project hard rules)

- **Strict TDD discipline.** Every task in `tasks.md` follows RED → GREEN → TRIANGULATE → REFACTOR. Each fix has a regression test that fails on the unfixed code and passes on the fixed code.
- **No co-authored-by, no AI attribution in commits** (per `AGENTS.md` global rules).
- **Conventional commits** (per `AGENTS.md` global rules).
- **No `saldo` / `estado` persisted** — the existing hard rule is preserved. The new code does not add columns to `Factura` or `Pago`.
- **No `factura_id` on `Pago`** — preserved. FE-005 does not introduce it.
- **Isolation by `usuario_id` → 404, not 403** — preserved. The FE-005 service-layer change does not weaken the isolation check.
- **snake_case Python, PascalCase TS components, no `any`** — preserved. FE-007 imports `formatMonto` (camelCase) in a TS file, as the existing pattern requires.
- **Pydantic validation in backend, never trust the frontend alone** — preserved. FE-005 adds an optional field, not a relaxed validation.
- **Postgres testcontainers, never SQLite** — preserved. The MED-004 regression test uses the existing testcontainer setup.
- **External services (Cloudinary, vision model) stay mocked** — preserved. The MED-004 / FE-005 tests do not touch external services.
- **11 fixes, one commit per fix** — each task in `tasks.md` is a single commit. The change's `Review Workload Forecast` (in the design) estimates ~200 lines of code diff + ~150 lines of new tests + a CHANGES.md update. Total well under the 400-line chained-PR threshold; single coherent PR recommended.
