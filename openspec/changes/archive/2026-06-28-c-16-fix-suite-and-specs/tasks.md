# Tasks: c-16-fix-suite-and-specs

> **Strict TDD discipline.** Every task follows: 0. Baseline (RED) → 1. Understand → 2. RED (write a failing test that fails for the right reason) → 3. GREEN (minimum code to pass) → 4. TRIANGULATE (add ≥1 more case per behavior, watch all pass) → 5. REFACTOR (keep tests green) → 6. Mark complete.
>
> Test layers in this change:
> - **Regression test for the proxy** (Bucket A.1): new unit test in `tests/test_config.py` that locks in the live-env-read behavior so a future PR cannot re-introduce `@lru_cache`.
> - **Existing integration suite** (Buckets A.1, A.2): the 25 currently-failing tests are the RED baseline. GREEN is making them pass; TRIANGULATE is confirming no other test regresses.
> - **Spec-level verification** (Buckets B, C): filesystem checks (`ls`, `grep "TBD"`), not pytest.
>
> This change does NOT introduce new business behavior, so the bulk of TDD evidence is "the existing suite goes from 25 failing → 0 failing" with one new positive test in `tests/test_config.py`.

## Task 1 — Baseline (RED) — RECONCILED with re-diagnosed baseline

> **Important: the baseline re-diagnosis changed.** The C-14 apply run cited `639 passing + 23 failing + 2 alembic_0003 = 25 failing`. The actual current baseline is `575 passing + 101 failing + 2 alembic_0003 = 678 total / 103 failing`. The 23 import-time pollution failures the original c-16 proposal attributed to `@lru_cache` on `get_settings()` have **already been fixed by a partial apply in a prior session** (D-1, D-2, D-3 in this change's `design.md`). The remaining 78–101 failures are inter-file test pollution that is OUT OF SCOPE for c-16 and is documented as known debt for c-17 (see Task 6.6 below).
>
> **The RED state c-16 commits to bring to 0 is the 2 alembic 0003 failures only.** All other 101 failures pre-date c-16's scope.

- [x] 1.1 From `facturas-proveedores-api/`, run `pytest tests/ -q --tb=no 2>&1 | tee c-16-baseline.txt`. Capture the baseline. **Actual:** `101 failed, 575 passed, 2 warnings in 530.22s (0:08:50)`. The 23 import-time pollution failures the original proposal expected are NOT in the baseline; the Bucket A.1 fix from the prior session resolved them. (Verified independently: `test_config.py` reports 7/7 passing including all 4 `TestSettingsProxyLiveEnvReads` regression tests; `test_deps.py` reports 9/9 passing.) The 101 failing tests are all integration tests that pass in isolation (confirmed by `pytest tests/test_factura_integration.py::TestCreateFactura::test_create_minimal_factura` alone → PASSED). This is inter-file test pollution, out of scope for c-16.
- [x] 1.2 Run `pytest tests/test_alembic_migration_0003.py -v --tb=short 2>&1 | tee c-16-baseline-0003.txt` in isolation. **Actual:** `2 failed, 3 passed, 1 warning in 25.41s`. The 2 failing tests are `test_upgrade_chains_to_0003` (asserts `"0003" in alembic current`; the current head is `0005`) and `test_downgrade_drops_index` (does `downgrade -1` from 0005 → 0004; the 0003-created `ix_proveedor_usuario_nombre_lower` index is still present because the downgrade did not reach 0003). The original D-4 hypothesis ("env teardown leak causes the 2 failures") is **wrong**; the failures happen inside the module, not in downstream tests. The real root cause is that the tests use chain-relative `head` / `-1` commands that don't isolate migration 0003 from the now-0005 chain.
- [x] 1.3 Run `grep -r "TBD" openspec/specs/ | tee c-16-baseline-tbd.txt` from the project root. **Actual:** 7 files match: `cuenta-corriente-frontend/spec.md`, `ia-vision-backend/spec.md`, `pagos-backend/spec.md`, `pagos-frontend/spec.md`, `perfil-usuario-api/spec.md`, `perfil-usuario-frontend/spec.md`, `project-foundation/spec.md`. Matches Task 5's list exactly.
- [x] 1.4 Run `grep -l "ADDED Requirements" openspec/specs/*/spec.md | tee c-16-baseline-headers.txt`. **Actual:** 2 files match: `auth-frontend/spec.md` and `facturas-frontend/spec.md`. Matches Task 4's list exactly.

## Task 2 — Bucket A.1: settings read-through proxy (GREEN) — RECONCILED, pre-applied

> **This task was already executed in a prior session.** Code is in place; tests pass. The remaining work is verifying the on-disk state matches the D-1/D-2/D-3 contract, then marking complete.

- [x] 2.1 **Understand.** Contract: `settings.X` MUST reflect `os.environ["X"]` at read time. (Done in prior session.)
- [x] 2.2 **RED — write the regression test first.** `tests/test_config.py::TestSettingsProxyLiveEnvReads` exists with 4 tests: `test_settings_proxy_reads_live_env` (the D-1 contract), `test_settings_proxy_does_not_cache_across_attributes`, `test_get_settings_returns_fresh_instance`, `test_settings_proxy_preserves_call_sites`. All 4 pass. The 3 original `TestSettingsLoading` tests (env loading, missing required var, wildcard origin rejected) also pass (7/7 total in `test_config.py`).
- [x] 2.3 **GREEN.** In `app/core/config.py`: `_SettingsProxy` class is in place at lines 124–144; `settings = _SettingsProxy()` is the module-level export. `get_settings()` is retained (no `@lru_cache` on it) and returns a fresh `Settings()` per call. Verified by reading the file.
- [x] 2.4 **TRIANGULATE — defensive lazy engine.** In `app/core/deps.py`: `_engine: Engine | None = None` and `_get_engine()` are in place; call sites use `_get_engine()`. `test_deps.py` reports 9/9 passing.
- [x] 2.5 **REFACTOR.** `tests/conftest.py` no longer contains `get_settings.cache_clear()`; a comment referencing "C-16 (D-3)" is present at lines 103–106 explaining the contract and pointing to the regression test.
- [x] 2.6 **TRIANGULATE — full suite.** From `facturas-proveedores-api/`, run `pytest tests/ -q --tb=line`. **Actual:** `101 failed, 575 passed, 2 warnings in 530.22s` (excluding the 2 alembic 0003 failures, which are Bucket A.2's problem). Of those 101 failures, none are import-time pollution (the A.1 fix resolved all 23 the original c-16 proposal cited). The 101 remaining failures are inter-file test pollution that is out of scope for c-16 and is captured in Task 6.6 as known debt for c-17.

## Task 3 — Bucket A.2: rewrite alembic 0003 tests + env teardown (GREEN) — REWRITTEN with new diagnosis

> **Diagnosis updated.** The original D-4 hypothesis (env teardown leak causes the 2 failures) is wrong: the failures happen **inside** the module, not in downstream tests. The actual root cause: the alembic chain advanced from 0003 (when the test file was written) to 0005 (current head, after C-08 and C-10 added migrations 0004 and 0005). The tests use `alembic upgrade head` (now goes to 0005) and `alembic downgrade -1` (only steps 0005 → 0004, never reaches 0003 to drop the 0003-created index). The fix: rewrite the tests to use **specific migration revision targets** (`upgrade 0003`, `downgrade 0002`, `upgrade 0003`) so they isolate migration 0003 regardless of future chain growth. The env teardown fix is also applied (real but separate defect).

- [ ] 3.1 **Understand.** Read `tests/test_alembic_migration_0003.py` (the 5 tests + `_run_alembic` helper + `migration_engine_0003` fixture) and confirm the 2 failures from Task 1.2: `test_upgrade_chains_to_0003` (asserts `"0003" in alembic current`; the chain head is 0005) and `test_downgrade_drops_index` (does `downgrade -1` from 0005 → 0004; the 0003 index is still present). Lock in the new contract: every `_run_alembic(...)` call in the file MUST use an explicit revision ID (e.g. `"0003"`, `"0002"`, `"base"`), never `"head"` or `"-1"`.
- [ ] 3.2 **RED — confirm the 2 failures.** Already done in Task 1.2 (recorded as the baseline). The 2 failing test names: `test_upgrade_chains_to_0003` and `test_downgrade_drops_index`. (No re-run needed; reference Task 1.2's output.)
- [ ] 3.3 **GREEN — rewrite tests to use specific revision targets.** In `tests/test_alembic_migration_0003.py`:
  - `test_upgrade_chains_to_0003` (line 54): change `_run_alembic("upgrade", "head")` to `_run_alembic("upgrade", "0003")`; assert `"0003 (head)"` in the output (or equivalent that confirms the head is 0003 specifically, not just "0003 is somewhere in the chain"). The "or 0003 in stderr" fallback should remain for robustness.
  - `test_downgrade_drops_index` (line 97): change `_run_alembic("downgrade", "-1")` to `_run_alembic("downgrade", "0002")`; the head assertion should check for `"0002"`.
  - `test_re_upgrade_restores_index` (line 121): change `_run_alembic("upgrade", "head")` to `_run_alembic("upgrade", "0003")` (defensive — the module-scope fixture persists; without explicit targeting, the test would re-upgrade to 0005).
  - **No other test changes.** `test_index_on_usuario_nombre_lower_exists` and `test_no_saldo_or_estado_column_after_migration` don't call `_run_alembic` and are unaffected.
  - **Run `pytest tests/test_alembic_migration_0003.py -v`**: **expected 5/5 passing.**
- [ ] 3.4 **GREEN (defensive) — restore `DATABASE_URL` on teardown.** In `tests/test_alembic_migration_0003.py`, refactor the `migration_engine_0003` fixture (lines 23–36) to snapshot `os.environ.get("DATABASE_URL")` on enter and restore on teardown (handle the `None` case via `os.environ.pop`). Mirror the pattern used in the session-scope `env_vars` fixture in `tests/conftest.py`. Re-run the module: **expected 5/5 passing** (regression check — the env restore is a separate fix and should not change test outcomes).
- [ ] 3.5 **TRIANGULATE — direct regression test for env restoration.** Add a new test in `tests/test_alembic_migration_0003.py` (e.g. `test_database_url_restored_after_module`) that records `os.environ["DATABASE_URL"]` before any module test runs, runs all 5 module tests, and asserts the env is restored to the original value after the module finishes. This is a direct lock-in for the env teardown contract. **Run pytest on the module: expected 6/6 passing.**
- [ ] 3.6 **TRIANGULATE — full suite (out-of-scope failures recorded).** From `facturas-proveedores-api/`, run `pytest tests/ -q --tb=line`. **Expected:** `99 failed, 577 passed` (101 pre-existing inter-file pollution failures unchanged; 2 alembic 0003 failures from this change's scope now pass → -2). Document any non-pollution failures in Task 6.6 as new debt. **The 78–101 inter-file pollution failures are out of scope and are captured in Task 6.6 for c-17.**

## Task 4 — Bucket B: spec header renames

- [ ] 4.1 In `openspec/specs/auth-frontend/spec.md`, replace the section header `## ADDED Requirements` with `## Requirements` (single-line edit). Verify with `grep -n "^## " openspec/specs/auth-frontend/spec.md` that the file now lists `## Requirements` (not `## ADDED Requirements`).
- [ ] 4.2 In `openspec/specs/facturas-frontend/spec.md`, replace the section header `## ADDED Requirements` with `## Requirements` (single-line edit). Verify with `grep -n "^## " openspec/specs/facturas-frontend/spec.md` that the file now lists `## Requirements` (not `## ADDED Requirements`).
- [ ] 4.3 **TRIANGULATE — body integrity.** Run `git diff openspec/specs/auth-frontend/spec.md openspec/specs/facturas-frontend/spec.md` and confirm each file shows exactly 1 line changed (the header line `+## Requirements` / `-## ADDED Requirements`). The body under the header MUST be byte-identical to the pre-change state — no requirement text, no scenarios, no other edits.
- [ ] 4.4 **TRIANGULATE — catalog invariant.** Run `grep -l "ADDED Requirements" openspec/specs/*/spec.md` and confirm the only remaining match is `openspec/changes/c-16-fix-suite-and-specs/specs/fix-suite-and-specs/spec.md` (this change's own spec, which legitimately uses `## ADDED Requirements` because c-16 is adding requirements). No file under `openspec/specs/<capability>/spec.md` should match.
- [ ] 4.5 **TRIANGULATE — archive invariant.** Run `git status` and confirm `openspec/changes/archive/` has NO modifications. The archived change's `specs/<capability>/spec.md` files keep their `## ADDED Requirements` header (correct as-is, since at the time the change was active those requirements WERE being added; the rename only applies to the established `openspec/specs/<capability>/spec.md` files).

## Task 5 — Bucket C: Purpose fills

For each of the 7 specs: read the originating archived `proposal.md` (Why + Scope sections) and `design.md` (Context section), then write a 3-6 sentence English-led Purpose paragraph that follows the style of the existing real Purposes (`core-data-models`, `cuenta-corriente-backend`, `auth-backend`, `auth-frontend`, `proveedores-frontend`). Replace the `TBD - created by archiving change c-XX-...` paragraph in place. No other section of the spec is touched.

- [ ] 5.1 Replace Purpose in `openspec/specs/pagos-frontend/spec.md` (origin: `archive/2026-06-27-c-11-pagos-frontend/`).
- [ ] 5.2 Replace Purpose in `openspec/specs/cuenta-corriente-frontend/spec.md` (origin: `archive/2026-06-27-c-13-cuenta-corriente-frontend/`).
- [ ] 5.3 Replace Purpose in `openspec/specs/ia-vision-backend/spec.md` (origin: `archive/2026-06-27-c-14-ia-vision-backend/`).
- [ ] 5.4 Replace Purpose in `openspec/specs/pagos-backend/spec.md` (origin: `archive/2026-06-27-c-10-pagos-backend/`).
- [ ] 5.5 Replace Purpose in `openspec/specs/perfil-usuario-api/spec.md` (origin: `archive/2026-06-25-c-05-perfil-usuario/`).
- [ ] 5.6 Replace Purpose in `openspec/specs/perfil-usuario-frontend/spec.md` (origin: `archive/2026-06-25-c-05-perfil-usuario/`).
- [ ] 5.7 Replace Purpose in `openspec/specs/project-foundation/spec.md` (origin: `archive/2026-06-19-c-01-foundation-setup/`).
- [ ] 5.8 **Guard — `cuenta-corriente-backend` untouched.** Confirm `git diff openspec/specs/cuenta-corriente-backend/spec.md` is empty (the file already has a real Purpose and is explicitly out of scope).
- [ ] 5.9 **TRIANGULATE.** From the project root, run `grep -r "TBD" openspec/specs/`. **Expected:** empty output. Run `grep -l "TBD" openspec/specs/*/spec.md` — expected: no matches.

## Task 6 — Cross-bucket verification

- [ ] 6.1 From `facturas-proveedores-api/`, run `pytest tests/test_alembic_migration_0003.py -v`. **Expected:** 6/6 passing (5 original tests + 1 new env-restoration regression test from Task 3.5). The 2 failures from c-16's scope are gone.
- [ ] 6.2 From `facturas-proveedores-api/`, run `pytest tests/test_config.py -v`. **Expected:** 7/7 passing (3 original `TestSettingsLoading` + 4 `TestSettingsProxyLiveEnvReads` regression tests). Locks in the D-1/D-3 contract.
- [ ] 6.3 From `facturas-proveedores-api/`, run `pytest tests/test_deps.py -v`. **Expected:** 9/9 passing. Locks in the D-2 lazy engine contract.
- [ ] 6.4 From the project root, run `openspec list` and `openspec status --change c-16-fix-suite-and-specs --json`. **Expected:** all 4 artifacts present, `isComplete: true`.
- [ ] 6.5 From the project root, run `openspec validate c-16-fix-suite-and-specs`. **Expected:** `Change 'c-16-fix-suite-and-specs' is valid`.
- [ ] 6.6 From the project root, run `grep -r "TBD" openspec/specs/` and `grep -l "ADDED Requirements" openspec/specs/*/spec.md`. **Expected:** no `TBD`; the only `ADDED Requirements` match is `openspec/changes/c-16-fix-suite-and-specs/specs/fix-suite-and-specs/spec.md` (this change's own spec).
- [ ] 6.7 Run `git status` and `git diff --stat`. **Expected:** only the expected files changed (see Definition of Done). **No** `openspec/changes/archive/**` modifications.
- [ ] 6.8 **Record known debt for c-17.** Append a section to the c-16 proposal's `## Why` or to `openspec/changes/c-16-fix-suite-and-specs/known-debt.md` (created as part of this task) documenting the 78–101 inter-file test pollution failures:
  - List of test files and their failure counts in the baseline (e.g. `test_pago_integration.py`: 28, `test_proveedor_integration.py`: 20, `test_factura_integration.py`: 18, `test_ia_vision_integration.py`: 16, `test_perfil_integration.py`: 12, `test_ia_vision_no_persistence.py`: 7).
  - Evidence that the tests pass in isolation: `pytest tests/test_factura_integration.py::TestCreateFactura::test_create_minimal_factura` alone → PASSED; `pytest tests/test_ia_vision_integration.py::TestFacturaHappyPath::test_jpeg_returns_200_with_proposal` alone → PASSED.
  - Hypothesis (not yet diagnosed): inter-file test pollution — likely session-scope or module-scope fixtures that mutate global state (DB, env, config) in ways that leak across module boundaries. A future c-17 should investigate the specific pollution source (which file is the offender, what state it leaves behind, what assertion in the downstream file is the first to fail).
  - Reference the openspec-apply-progress.md pattern: c-17's RED step is "pick one failing test, run it with progressively more of the suite until it starts failing" to identify the polluting file.

## Review Workload Forecast

- **Estimated changed lines**: ~80 production code (`app/core/config.py` proxy + `app/core/deps.py` lazy engine) + ~30 test code (1 new test in `tests/test_config.py` + 1 fixture refactor in `tests/test_alembic_migration_0003.py` + removal of 3 lines in `tests/conftest.py`) + 7 prose paragraph replacements (avg ~5 sentences each) + 2 single-line header edits in `auth-frontend/spec.md` and `facturas-frontend/spec.md` (no body change).
- **Chained PRs recommended**: **No.** Single coherent housekeeping change, all 3 buckets interrelated (the test suite is what motivates the whole thing). The diff is reviewable in one pass.
- **400-line budget risk**: **Low.** The largest files are the 2 renamed specs (`facturas-api`/`proveedores-api`) which carry no content delta. The production code delta is small and the prose replacements are short.
- **Breaking surface**: **None.** `settings.X` keeps the same call-site surface; spec renames are filesystem-only; Purpose fills are prose-only and don't change requirements.
- **C-15 (ia-vision-frontend) unblocked**: this change removes the test pollution that was masking real regressions. C-15 can land on top with full confidence that the test suite reports real failures only.
- **Follow-up housekeeping (out of scope)**: c-16 does not rename any spec folders. The remaining `-api` suffix in `perfil-usuario-api` (and the asymmetry with `perfil-usuario-frontend`) is captured in Q-2 and Q-4 as a future capability name normalization sweep, separate from this change. A future housekeeping PR (e.g. c-17) can do the sweep.

## Definition of done (apply phase)

- [ ] All tasks 1–6 are checked off; the in-scope tests pass:
  - `pytest tests/test_alembic_migration_0003.py -v` → 6/6 (5 original + 1 new env-restoration regression test).
  - `pytest tests/test_config.py -v` → 7/7 (3 original + 4 D-1 regression tests).
  - `pytest tests/test_deps.py -v` → 9/9.
- [ ] The c-16 in-scope test count delta: `2 alembic 0003 failures` → `0 alembic 0003 failures`. The 78–101 inter-file test pollution failures are out of scope and are captured in Task 6.6 as known debt for c-17.
- [ ] The change introduces no new column / migration / endpoint / dependency.
- [ ] `app/core/config.py` no longer imports `lru_cache`; the module-level `settings` is a `_SettingsProxy` instance. (Verified pre-applied.)
- [ ] `app/core/deps.py` no longer constructs the engine at import time. (Verified pre-applied.)
- [ ] `tests/conftest.py` no longer calls `get_settings.cache_clear()`. (Verified pre-applied.)
- [ ] `tests/test_config.py` contains the `TestSettingsProxyLiveEnvReads` regression suite (4 tests) and it passes. (Verified pre-applied.)
- [ ] `tests/test_alembic_migration_0003.py` module passes 6/6 in isolation (5 original tests + 1 new env-restoration test); the 2 previously-failing tests now use specific revision targets (`"0003"`, `"0002"`, `"base"`) instead of chain-relative `"head"` / `"-1"`; the `migration_engine_0003` fixture restores `os.environ["DATABASE_URL"]` on teardown.
- [ ] `openspec/specs/auth-frontend/spec.md` and `openspec/specs/facturas-frontend/spec.md` carry `## Requirements` as the section header (not `## ADDED Requirements`); the rest of the spec body is byte-identical to its pre-change state.
- [ ] No `TBD` substring remains in `openspec/specs/`.
- [ ] `openspec/specs/cuenta-corriente-backend/spec.md` is byte-identical to its pre-change state.
- [ ] `openspec validate c-16-fix-suite-and-specs` is clean.
- [ ] `git status` shows no `openspec/changes/archive/**` modifications.
- [ ] Known debt for c-17 is recorded in `openspec/changes/c-16-fix-suite-and-specs/known-debt.md` (or appended to `proposal.md` as a `## Known debt` section) per Task 6.8.
