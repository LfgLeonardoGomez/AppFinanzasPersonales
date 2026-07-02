# Proposal: c-17-fix-test-pollution

## Why

The backend test suite has **78–101 pre-existing inter-file test pollution failures** that c-16 documented as out-of-scope known debt. c-16's full-suite baseline is `99 failed, 577 passed` (`openspec/changes/archive/2026-06-28-c-16-fix-suite-and-specs/known-debt.md:1-2, 33`). The 6 polluting files and their failure counts (from `known-debt.md:38-45`) are:

| Test file | Failures in full suite | Pass in isolation? |
|---|---|---|
| `tests/test_pago_integration.py` | 28 | yes |
| `tests/test_proveedor_integration.py` | 20 | yes |
| `tests/test_factura_integration.py` | 18 | yes |
| `tests/test_ia_vision_integration.py` | 16 | yes |
| `tests/test_perfil_integration.py` | 12 | yes |
| `tests/test_ia_vision_no_persistence.py` | 7 | yes |
| **Total** | **101** (99 after c-16 A.2 fix) | — |

Every one of those failing tests passes when run alone (evidence in `known-debt.md:48-65`) — they only fail when run as part of the full `pytest tests/ -q` suite. This is the canonical signature of **inter-file test pollution**: a file earlier in the suite leaves global state behind that a file later in the suite picks up.

`known-debt.md:66-75` ranks the 5 suspect hypotheses:

1. **Module-scope or session-scope fixtures that mutate global state** (DB connection, env, config) and leak across module boundaries. Most likely offender: a session/engine that outlives a test that closes the connection out from under it.
2. **`os.environ` mutation that does not get restored.** C-16 added the env-snapshot/restore pattern to `tests/test_alembic_migration_0003.py` and `tests/conftest.py::env_vars`, but the 6 polluting test files may not have the same discipline.
3. **A half-flushed SQLAlchemy session left in the dependency cache** (FastAPI's `app.dependency_overrides` + the lazy engine from c-16) that subsequent tests pick up.
4. **Testcontainers port collision**: a `PostgresContainer` in each integration test picks a random port, but if two containers are alive simultaneously (e.g. module-scope vs session-scope) one can be killed mid-test by the other.
5. **Pydantic `Settings()` re-instantiation per attribute access (c-16 D-1)**: micro-cost, but if a test reads a setting that triggers validation against env that was just mutated, the new instance may differ from what earlier tests expected.

The hypothesis is unconfirmed — the specific pollution source and the specific leaked state are **empirically unknown**. The five hypotheses are ranked, not verified.

**The cost of NOT fixing this is concrete:**

- **CI noise masks regressions.** When 78–101 tests fail on every push, a new regression has to shout over that noise. False negatives from the suite are the worst kind: the suite reports "failing" when the regression is in a polluter, not in the code under test.
- **C-15 (ia-vision-frontend) and later are blocked.** The next change to land on the backend will inherit the 78–101 pollution failures. Every new test added on top will add its own inter-file interactions, making the pollution worse with each change.
- **Developer trust erodes.** A suite that fails 78–101 times for reasons unrelated to the code under test is a suite that gets `pytest-deselect`-ed around, locally run in subsets, and ultimately ignored.

**No production code is intended to change.** The fix targets the **test infrastructure**: fixtures, session/module scoping, the `conftest.py` pattern, and the import-time discipline of the polluting test files. **Exception:** if the bisection reveals a real production bug (e.g., a SQLAlchemy session leak, a module-scope mutation of a global), the fix may touch production code, and the change is documented in the proposal at that point.

## What Changes

**The bisection protocol (the entry point):**

The change adopts the **c-16 RED step** (`known-debt.md:78-90`) verbatim as its first action. The protocol is mechanical:

1. Pick one failing test — start with the first failing assertion in `test_pago_integration.py` (the largest bucket at 28 failures).
2. Run it alone — confirms it passes.
3. Run it with a prefix of the suite — e.g. `pytest tests/test_alembic_migration_0003.py tests/test_pago_integration.py::TestX` — passes.
4. Add the next test file — the moment the test starts failing, the most recently added file is the **polluter**.
5. Bisect inside the polluter file — the same way, test by test, until the polluting test is identified.
6. Inspect the polluting test's fixtures — what global state does it mutate? What does it leave behind? What assertion in the downstream file is the first to fail?
7. Fix the polluting test — typically "snapshot/restore env", "dispose the session", "scope the fixture to `function`", or "use `monkeypatch` instead of direct mutation".

Repeat for each of the 6 polluting files. Expect ~30 min per polluter per `known-debt.md:90`.

**The fix (TBD until bisection completes):**

The actual fix is **empirically discovered** by the bisection. The proposal commits to:

- Fix at the **pollution source**, not at the consumer. A consumer-side workaround (skip, xfail, refactor) is explicitly rejected as the primary fix.
- Each fix is locked in with a **regression test**: either a new test that asserts the polluting fixture is now snapshot/restore'd, or a new test module that runs the polluting file's tests in isolation *and then* the rest of the suite and asserts no regression.
- The 78–101 failures may **collapse to a single root cause** (e.g., one leaked session) or **split into 2–3 distinct causes** (e.g., one env-mutation issue + one rate-limit issue + one fixture-scope issue). The apply phase is structured to discover this empirically; the proposal does not pre-commit to a count.
- The c-16 protected tests (`test_alembic_migration_0003.py` 6/6, `test_config.py` 7/7, `test_deps.py` 9/9) MUST NOT regress. These are the regression-guard tests for the c-16 changes; they remain green throughout this change.

**A new capability:**

A new capability `test-pollution-fix` is introduced to capture the contract that the inter-file pollution is gone, the regression tests exist, and the pollution source is documented. The capability is test-infrastructure-only — it does not affect the production runtime.

**No BREAKING changes.** No new endpoints, no schema migrations, no dependency changes, no frontend changes, no spec renames, no spec prose fills (those were c-16's Buckets B and C). This change is strictly test-infrastructure.

## Capabilities

### New Capabilities

- `test-pollution-fix`: backend test-infrastructure capability that locks in the contract "the pytest suite has zero inter-file pollution failures" and "each fix has a regression test that proves it stays fixed". The capability covers: the bisection protocol entry point, the per-polluter fix (whatever it turns out to be), the per-fix regression test, the documentation of the pollution source (which file was the offender, what state it left behind, what the fix was), and the full-suite invariant (`pytest tests/ -q` reports `0 failed`).

### Modified Capabilities

<!-- None. The 6 polluting test files are test-infrastructure only and do not have associated spec capabilities. The fixtures and conftest.py are not "requirements" of any spec — they are implementation details of the test harness. The new `test-pollution-fix` capability is the only contract this change introduces. -->

## Impact

**Code (test infrastructure only, by default):**

- `facturas-proveedores-api/tests/conftest.py` — likely a refactor: split the session-scope `env_vars` fixture so it snapshots more aggressively, or add a function-scope wrapper that the polluting fixtures can opt into. The exact change is TBD until the bisection.
- `facturas-proveedores-api/tests/test_pago_integration.py` — likely the **first polluter identified** (28 failures, largest bucket). Possible fix: move `import app.models` from module top to inside the `engine` fixture (the pattern already adopted in `tests/test_ia_vision_integration.py` and `tests/test_ia_vision_no_persistence.py` per c-16's c-14 apply notes), and/or wrap the module-scope `engine` fixture with explicit `dispose()` + `teardown` discipline.
- `facturas-proveedores-api/tests/test_proveedor_integration.py`, `tests/test_factura_integration.py`, `tests/test_ia_vision_integration.py`, `tests/test_perfil_integration.py`, `tests/test_ia_vision_no_persistence.py` — the other 5 polluting files, each gets a targeted fix once the bisection identifies it. The exact change is TBD per file.
- `facturas-proveedores-api/app/core/rate_limit_ia.py` — **possible** production-code change if the bisection reveals that the module-level `_ia_attempts: dict` (line 34) is being exhausted by inter-test usage that doesn't call `reset_ia_rate_limit_store()`. The fix would be a `function`-scope reset or a `teardown`-based discipline. Documented as a possible exception, not a confirmed fix.
- `facturas-proveedores-api/app/core/deps.py` — **possible** production-code change if the bisection reveals a half-flushed session in the dependency cache. The fix would be a per-request session teardown. Documented as a possible exception, not a confirmed fix.

**New tests:**

- `facturas-proveedores-api/tests/test_<polluter>_no_pollution.py` (or similar) — a new test module per identified polluter that runs the polluting file's tests in isolation *and then* the rest of the suite, asserting no regression. This is the regression-guard for the fix.

**Specs:**

- A new `specs/test-pollution-fix/spec.md` is added to `openspec/specs/` (mirrors the c-16 `fix-suite-and-specs` umbrella pattern). No other spec is modified.

**Not impacted:**

- `facturas-proveedores-web/` (frontend) — untouched.
- `openspec/changes/archive/**` — immutable.
- `app/services/**`, `app/routers/**`, `app/repositories/**`, `app/models/**` — no business-logic changes unless the bisection finds a real production bug (the documented exception above).
- `pyproject.toml`, `requirements*.txt` — no new dependencies (no pytest plugins, no testcontainers changes).
- `knowledge-base/`, `AGENTS.md`, `CHANGES.md` — not updated by this change (no new patterns introduced that need cataloging; the existing AGENTS.md rule "Tests with Postgres real/container (NEVER SQLite)" is preserved).

**Verification target after GREEN:**

- `cd facturas-proveedores-api && pytest tests/ -q --tb=line` → `0 failed, 676 passed` (or whatever the actual passing count is after fixes; what matters is `0 failed`).
- `pytest tests/test_alembic_migration_0003.py` → 6/6 (c-16 protected).
- `pytest tests/test_config.py` → 7/7 (c-16 protected).
- `pytest tests/test_deps.py` → 9/9 (c-16 protected).
- `openspec validate c-17-fix-test-pollution` clean.
- The pollution source for each of the 6 polluting files is documented in the apply phase's per-polluter task and (if discovered) in a follow-up `known-debt-resolved.md` for downstream reference.

## Known constraints (carried forward from c-16)

- **Strict TDD discipline.** Every task in `tasks.md` follows RED → GREEN → TRIANGULATE → REFACTOR. Every fix has a regression test.
- **No co-authored-by, no AI attribution in commits** (per `AGENTS.md` global rules).
- **Conventional commits** (per `AGENTS.md` global rules).
- **No `pytest-deselect`** of the polluting tests as a fix — that hides the regression. The fix is to make them pass legitimately.
- **No SQLite** — Postgres testcontainers only (per AGENTS.md rule #9).
- **External services (Cloudinary, vision model) stay mocked** (per AGENTS.md rule #9) — no change to the existing test mocks.
