## Why

The backend test suite has two pre-existing sources of pollution that mask regressions and inflate CI noise, and the OpenSpec spec catalog has accumulated housekeeping debt from archive pressure.

- **Backend test pollution (Bucket A, partial pre-applied)** — the C-14 apply run reported `639 passing, 23 failing + 2 pre-existing alembic_0003`. A subsequent re-diagnosis of the current baseline revealed the actual state is `575 passing, 101 failing + 2 pre-existing alembic_0003` (103 total failing). The 23 import-time pollution failures the C-14 apply run attributed to the `@lru_cache` on `get_settings()` have already been fixed by a partial application of c-16 in a prior session: `app/core/config.py` now uses a `_SettingsProxy`, `app/core/deps.py` builds the engine lazily, and `tests/conftest.py` no longer carries the `cache_clear()` hack. The regression test `test_settings_proxy_reads_live_env` in `tests/test_config.py` (4 tests in `TestSettingsProxyLiveEnvReads`) passes and locks in the D-1 contract. The 2 pre-existing alembic 0003 failures remain, with a re-diagnosed root cause (see D-4 in `design.md`): the tests use `head` and `-1` alembic commands that don't isolate migration 0003 from the now-0005 chain. The remaining 78–101 failures (78 in non-IA files, 16–23 in `test_ia_vision_integration.py`) are inter-file test pollution that this c-16 plan does NOT diagnose: all 101 tests pass when run in isolation (e.g. `pytest tests/test_factura_integration.py::TestCreateFactura::test_create_minimal_factura` passes) but fail when run in the full suite. This inter-file pollution is captured as known debt for c-17; c-16's verification target is "0 new regressions" (the 2 alembic 0003 failures from c-16's scope become 0; the 78–101 pre-existing inter-file pollution failures are not part of c-16's contract).
- **Spec hygiene (Buckets B + C)** — `openspec/specs/` currently has 7 capabilities carrying `## Purpose: TBD - created by archiving change c-XX. Update Purpose after archive.` (`pagos-frontend`, `cuenta-corriente-frontend`, `ia-vision-backend`, `pagos-backend`, `perfil-usuario-api`, `perfil-usuario-frontend`, `project-foundation`). These were deferred during archive pressure to ship C-13 / C-14 fast. Inconsistent naming: `facturas-api` and `proveedores-api` are the only two backend specs using the `-api` suffix while the rest of the backend capabilities use `-backend` (`auth-backend`, `cuenta-corriente-backend`, `pagos-backend`, `ia-vision-backend`, `perfil-usuario-api` is the user-profile domain, separate concern). The `cuenta-corriente-backend` spec already follows the `-backend` convention with a real Purpose.

This change resolves the buckets it can in a single, low-risk housekeeping pass. The Bucket A.1 (settings proxy + lazy engine + cache_clear removal) is already applied in a prior session and is being reconciled in this change. Bucket A.2 (the 2 alembic 0003 failures) is fixed by rewriting the tests to target specific migration revisions plus the env teardown fix. Buckets B (2 header renames) and C (7 Purpose fills) are filesystem/prose-only. The residual 78–101 inter-file test pollution failures are out of scope for c-16 and are documented as known debt for c-17. The functional MVP is already production-ready from C-13 onward — C-15 (IA frontend) and later are unblocked by this c-16 applying cleanly. No new business behavior is introduced.

## What Changes

**Bucket A — Backend test pollution fix (lazy settings + alembic 0003):**
- `app/core/config.py`: drop `@lru_cache` from `get_settings()`. Replace the frozen module-level `settings: Settings = get_settings()` with a module-level `Settings` proxy object that delegates every attribute access to a fresh `Settings()` instance reading the current `os.environ`. Result: `settings.DATABASE_URL` always reflects the current env, no cache to clear, no per-test fixture required.
- `app/core/deps.py`: the existing `_engine = create_engine(settings.DATABASE_URL)` module-level line becomes safe under the new proxy (each access reads the current env). No code change required IF the proxy is the only change, but a defensive `_get_engine()` lazy initializer is introduced as a belt-and-suspenders measure so the engine is built on first request, not at import.
- `tests/conftest.py`: remove the now-redundant `get_settings.cache_clear()` hack from the `client` fixture (line 104-105). Add a regression test asserting the proxy behavior: mutating `os.environ["DATABASE_URL"]` between two `settings.DATABASE_URL` reads yields the new value, not a cached one.
- `tests/test_alembic_migration_0003.py`: **rewrite the 2 failing tests to target specific migration revisions instead of `head` / `-1`.** Root cause (re-diagnosed after the A.1 fix was already in place): the test file was written when the alembic chain head was 0003. Since then, migrations 0004 (C-08 factura indices) and 0005 (C-10 pago indices) were added. The 2 failures are caused by the tests using `alembic upgrade head` (now goes to 0005) and `alembic downgrade -1` (only steps from 0005 → 0004, never reaches 0003 to drop the 0003 index). The env teardown leak is a real but separate defect that does not cause these 2 specific failures. The fix is to make the tests deterministic about which migration they test by passing explicit revision IDs (`0003` and `0002`). This makes the tests immune to future chain growth (0006, 0007, ...). The env teardown fix is applied as a belt-and-suspenders measure.

**Bucket B — Spec section-header normalizations (established-spec convention):**
- `openspec/specs/auth-frontend/spec.md`: rename `## ADDED Requirements` → `## Requirements` (single-line edit, body byte-identical).
- `openspec/specs/facturas-frontend/spec.md`: rename `## ADDED Requirements` → `## Requirements` (single-line edit, body byte-identical).
- Archives under `openspec/changes/archive/` are NOT touched (their `## ADDED Requirements` header is correct as-is, because at the time the change was active, those requirements WERE being added).

**Bucket C — Fill 7 `Purpose: TBD` placeholders:**
- `openspec/specs/pagos-frontend/spec.md` (C-11)
- `openspec/specs/cuenta-corriente-frontend/spec.md` (C-13)
- `openspec/specs/ia-vision-backend/spec.md` (C-14)
- `openspec/specs/pagos-backend/spec.md` (C-10)
- `openspec/specs/perfil-usuario-api/spec.md` (C-05)
- `openspec/specs/perfil-usuario-frontend/spec.md` (C-05)
- `openspec/specs/project-foundation/spec.md` (C-01)
- Each Purpose is reconstructed from the archived proposal/design of the originating change (c-01, c-05, c-10, c-11, c-13, c-14). Style matches the existing real Purposes (`core-data-models`, `cuenta-corriente-backend`, `proveedores-api`/`proveedores-backend`, `auth-backend`, `auth-frontend`, `facturas-api`/`facturas-backend`).
- `cuenta-corriente-backend/spec.md` already has a real Purpose — **NOT touched**.

**No BREAKING changes.** No new endpoints, no schema migrations, no dependency changes, no frontend changes.

## Capabilities

### New Capabilities
- `fix-suite-and-specs`: umbrella housekeeping capability covering all three buckets (lazy settings, alembic 0003 fix, 2 spec renames, 7 Purpose fills). This is the only capability this change introduces; the 9 specs it affects (2 renames + 7 Purpose fills) are documented here as requirements of this capability, not as new or modified capabilities of their own. Rationale: keeps the housekeeping self-contained and makes the c-16 archive a single coherent unit. OpenSpec still tracks the 2 renamed capabilities as a filesystem-level rename in this spec.

### Modified Capabilities
<!-- None. The 2 renames and 7 Purpose fills are bookkeeping operations documented as requirements of `fix-suite-and-specs`; they do not change the REQUIREMENTS of the renamed/filled capabilities, only the metadata (folder name for renames, prose for Purposes). OpenSpec's archive will apply the filesystem rename and the prose replacement as part of archiving `fix-suite-and-specs`. -->

## Impact

**Code (Bucket A only):**
- `facturas-proveedores-api/app/core/config.py` — drop `@lru_cache`, replace `settings: Settings = get_settings()` with a `Settings` proxy class. Backward compatible: existing call sites (`settings.DATABASE_URL`, `settings.CLOUDINARY_URL`, etc.) keep working because the proxy exposes the same attribute surface.
- `facturas-proveedores-api/app/core/deps.py` — defensive lazy engine initializer (low-risk belt-and-suspenders; primary fix is the proxy).
- `facturas-proveedores-api/tests/conftest.py` — remove the `cache_clear()` hack; add a regression test for proxy behavior.
- `facturas-proveedores-api/tests/test_alembic_migration_0003.py` — restore `os.environ["DATABASE_URL"]` on teardown.

**Specs (Buckets B + C):**
- 2 single-line header edits (`## ADDED Requirements` → `## Requirements`) in `openspec/specs/auth-frontend/spec.md` and `openspec/specs/facturas-frontend/spec.md`. Body byte-identical to pre-change state.
- 7 `## Purpose` paragraphs replaced in place (no other section touched).

**Not impacted:**
- Archives under `openspec/changes/archive/` — immutable. References to `facturas-api` / `proveedores-api` in archived proposals/designs/tasks are historical and correct.
- Frontend repo `facturas-proveedores-web/`.
- Production runtime — the proxy has the same observable behavior as a one-shot `Settings()` when the env is stable; per-test re-instantiation cost is negligible (microseconds, no I/O).
- `knowledge-base/`, `AGENTS.md`, `CHANGES.md` — not updated by this change (a follow-up PR may sync them).

**Verification target after GREEN:**
- `pytest tests/ -q --tb=line` from `facturas-proveedores-api/`: `0 failing` (current baseline: 2 failing in `test_alembic_migration_0003.py` from chain-advanced tests; the 23 import-time pollution failures from C-14 are already eliminated by the A.1 fix that was applied in a prior session and is being reconciled in this change).
- `openspec list` and `openspec validate c-16-fix-suite-and-specs` clean.
- 7 specs carry a real `## Purpose` (grep `TBD` in `openspec/specs/` returns nothing).
- 2 specs carry `## Requirements` as the section header (no `## ADDED Requirements` matches in `openspec/specs/*/spec.md` apart from this change's own spec under `openspec/changes/`).
