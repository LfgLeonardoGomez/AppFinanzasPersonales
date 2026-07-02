# Known debt — c-18-housekeeping-fixes

> Companion file mirroring c-16's and c-17's pattern. Captures the
> items that the audit found but were explicitly deferred to a
> future housekeeping pass (c-19+) or for opportunistic fixing in
> the next change that touches the same code.

## Issues addressed in c-18 (with file:line references)

| ID | Severity | File | What was fixed |
|----|----------|------|----------------|
| FE-001 | CRITICAL | `facturas-proveedores-web/src/features/facturas/FacturasPage.tsx:49`, `…/pagos/PagosPage.tsx:42` | `window.location.href` → `useNavigate()` |
| FE-002 | CRITICAL | `facturas-proveedores-web/public/` (3 new PNG files) | PWA icons generated via one-shot Node script |
| FE-003 | CRITICAL | `…/facturas/FacturaFormPage.tsx`, `…/pagos/PagoFormPage.tsx` | IA button `disabled` while mutation is `isPending` (Option A — lift mutation) |
| FE-004 | HIGH | `…/app/router.tsx` (extracted to `…/app/HomePage.tsx`) | 7 `<a href>` → `<Link to>` |
| FE-005 | HIGH | `facturas-proveedores-api/app/schemas/pago.py`, `…/routers/pagos.py`; `…/web/src/features/pagos/PagoFormPage.tsx`; `…/web/src/shared/api/api.d.ts` | `proveedor_nombre: Optional[str]` added to `PagoResponse` |
| FE-006 | MEDIUM | `…/facturas/FacturaFormPage.tsx:82`, `…/pagos/PagoFormPage.tsx:117` | Inline `import('@shared/api/api').X` → top-level type imports |
| FE-007 | MEDIUM | `…/proveedores/components/ProveedoresList.tsx:27-33` | Local `formatSaldo` removed; use shared `formatMonto` |
| FE-008 | MEDIUM | `…/proveedores/components/ProveedoresList.tsx:46-67` | Delete dialog opens BEFORE the mutation fires |
| MED-001 | MEDIUM | `facturas-proveedores-api/app/routers/proveedores.py:79` | `__import__("decimal").Decimal("0.00")` → top-level `from decimal import Decimal` |
| MED-004 | MEDIUM | `facturas-proveedores-api/app/repositories/pago_repository.py:50`, `…/proveedor_repository.py:216` | Add `id ASC` tiebreak to `order_by` |
| META-001 | META | `CHANGES.md` | Add C-15a, C-16, C-17 entries; bump total to 18 changes |

## Issues deferred (file:line references + rationale)

| ID | File | Description | Why deferred |
|----|------|-------------|--------------|
| MED-002 | `app/services/proveedor_service.py` (`_build_historial`) | Sort is O(n log n) but could be O(n+m) merge since the two source lists are already date-ordered | Algorithmic improvement, not a bug. Current sort is correct and fast at MVP scale |
| MED-003 | Various schemas (use `date.today()` directly) | Some Pydantic schemas use `date.today()` for the not-future check instead of the explicit `zoneinfo.ZoneInfo("America/Argentina/Buenos_Aires")` pattern that c-15a/16 established | Behavior is identical for the MVP's deployment timezone; a contributor in a different timezone could ship a regression — but style fix only |
| MED-005 | `app/routers/proveedores.py` (uses `svc._repo`) | The router accesses the private `_repo` attribute directly in one path. The fix is to add a public method to the service | Small refactor, not urgent; no behavior change |
| META-002 | `docs/` | Contains 693 lines of orphan content that was replaced by `knowledge-base/` | Decide later whether to delete or to keep as a historical snapshot |
| META-003 | `package.json` (the `lint` script) | `npm run lint` script references an ESLint config that was never added. The script fails | Either add ESLint or remove the script. Decide later |
| META-004 | `app/services/ia_extraccion_service.py` (~90 lines) | The IA extractor has duplication between the Claude and OpenAI adapters | Refactor to a shared prompt template. Not a bug; both adapters are tested independently |
| LOW-001..004 | various | Minor style / nits | Opportunistic fix in the next change that touches the same files |
| FE-009..011 | various | Frontend small fixes | Opportunistic fix in the next change that touches the same files |
| META-005..006 | various | Docs / small meta items | Opportunistic fix in the next change that touches the same files |

## c-17 protected test baseline (must stay green)

22 tests in:
- `tests/test_alembic_migration_0003.py` (6)
- `tests/test_config.py` (7)
- `tests/test_deps.py` (9)

These are the "regression-guard" tests from c-17 (test pollution fixes).
c-18 preserves them (the change does not touch `app/core/config.py`,
the alembic migration, or the deps module).

## New tests added in c-18

| Task | Test file | New tests |
|------|-----------|-----------|
| FE-001 | `FacturasPage.test.tsx`, `PagosPage.test.tsx` | 4 (2 per page) |
| FE-002 | `src/shared/pwa-icons.test.ts` | 4 (icon existence + manifest resolution) |
| FE-003 | `FacturaFormPage.test.tsx`, `PagoFormPage.test.tsx` | 4 (2 per page) |
| FE-004 | `HomePage.test.tsx` | 3 |
| FE-005 backend | `tests/test_fe005_pago_response.py` | 6 |
| FE-005 frontend | `src/features/pagos/FE005.test.tsx` | 2 |
| FE-008 | `ProveedoresList.test.tsx` | 3 (dialog opens, mutation fires only on confirm, no mutation on cancel) |
| MED-004 | `tests/test_med004_ordering.py` | 2 |

**Total new tests**: 28 (12 backend, 16 frontend).
**Total tests after c-18**: 715 backend (was 701) + 381 frontend (was 359) = 1096.
