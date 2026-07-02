# test-pollution-fix Specification

## Purpose

Test-infrastructure capability for the backend pytest suite. Locks in the contract that the inter-file test pollution documented in c-16 `known-debt.md:38-45` is eliminated: the full `pytest tests/ -q` suite reports `0 failed`, each identified pollution source has a regression test that fails if the fix is reverted, and the pollution history is documented for future maintainers. Covers the bisection protocol entry point, the per-polluter fix discipline (fix at the source, not the consumer), the per-fix regression test, the documentation of the pollution source, and the full-suite invariant. Test-infrastructure only — does not affect the production runtime.
## Requirements
### Requirement: Inter-file test pollution is diagnosed via the c-16 bisection protocol

The system SHALL apply the c-16 bisection protocol (`openspec/changes/archive/2026-06-28-c-16-fix-suite-and-specs/known-debt.md:78-90`) as the entry point for diagnosing each of the 6 polluting test files. The protocol is: pick one failing test → run it alone → run it with a prefix of the suite → add the next test file until the test starts failing (the most recently added file is the polluter) → bisect inside the polluter file → identify the polluting test → inspect the polluting test's fixtures → fix the polluting test. The protocol is applied once per polluting file; the polluting files are attacked in descending order of failure count (`test_pago_integration.py` first with 28 failures, `test_ia_vision_no_persistence.py` last with 7 failures).

#### Scenario: bisection starts with the largest polluting file

- **WHEN** the apply phase begins the bisection
- **THEN** the first polluter investigated is `tests/test_pago_integration.py` (28 failures, the largest bucket per c-16 `known-debt.md:38-45`); subsequent bisections proceed in the order `test_proveedor_integration.py` (20), `test_factura_integration.py` (18), `test_ia_vision_integration.py` (16), `test_perfil_integration.py` (12), `test_ia_vision_no_persistence.py` (7)

#### Scenario: the bisection identifies a polluting test by empirical prefix-narrowing

- **WHEN** the apply phase runs a candidate polluting test in progressively larger pytest prefixes (e.g. `pytest tests/<one_file>.py tests/<target>::TestX`, then add the next file, then the next, until the target test starts failing)
- **THEN** the file added just before the target test started failing is recorded as the polluter; the specific test inside the polluter is identified by repeating the same prefix-narrowing inside the polluter file (test by test, then method by method)

#### Scenario: the bisection is documented per polluting file

- **WHEN** the bisection identifies a polluting test
- **THEN** the apply phase records: the polluting file, the polluting test, what global state it mutates, what it leaves behind, and the first downstream assertion that fails because of the leak — this record lives in the corresponding `tasks.md` task notes and (if 3+ distinct root causes are found) in a `known-debt-resolved.md` file for downstream reference

### Requirement: Each identified pollution source has a regression test that locks the fix

The system SHALL add, for each identified pollution source, a regression test that fails if the same pollution is re-introduced (by accident, by a future PR, or by copy-paste from a working test file). The regression test takes one of two forms: (Option A, preferred) a new test module that runs the polluting file's tests in isolation *and then* the rest of the suite and asserts no regression; or (Option B, fallback) a unit test on the polluting fixture itself that asserts the right scope and the right teardown. The choice between A and B is made by the apply sub-agent based on the discovered fix.

#### Scenario: a polluting file's fix has an Option-A regression test

- **WHEN** the fix is applied to `tests/test_<polluter>.py`'s fixtures
- **THEN** a new test module `tests/test_<polluter>_no_pollution.py` (or similarly named) is added that invokes every test in `tests/test_<polluter>.py` in isolation (asserting they pass), then invokes a representative subset of the rest of the suite (e.g. 5-10 tests from other files), and asserts that no test fails when the polluting file runs before the rest

#### Scenario: a polluting file's fix has an Option-B regression test

- **WHEN** the fix is applied to a specific fixture (e.g. the module-scope `engine` fixture) and Option A is impractical
- **THEN** a unit test is added that inspects the fixture's scope (asserting it is `function` not `module` if that is the fix, or vice versa), its teardown (asserting `dispose()` is called, env is restored, etc.), and its body (asserting no direct mutation of `os.environ` without restoration)

#### Scenario: a regression test fails if the pollution is re-introduced

- **WHEN** a future PR reverts the fix (e.g., removes the `dispose()` call, broadens the fixture scope, removes the env restoration)
- **THEN** the regression test from this requirement fails; the test is the canary for the fix

### Requirement: The full pytest suite reports zero failures

The system SHALL bring `pytest tests/ -q --tb=line` from `facturas-proveedores-api/` from the c-16 closing baseline of `99 failed, 577 passed` to `0 failed` (with the same or higher passing count, since fixes do not delete tests). The full suite is the canonical invariant; partial runs (e.g. `pytest tests/test_pago_integration.py`) may still pass in isolation but are not sufficient.

#### Scenario: full suite reports 0 failed after all fixes

- **WHEN** all identified pollution sources have been fixed and their regression tests are in place
- **THEN** running `pytest tests/ -q --tb=line` from `facturas-proveedores-api/` reports `0 failed`; the passing count is at least 577 (the c-16 closing baseline) plus the new regression tests added in this change

#### Scenario: partial runs are not sufficient to claim GREEN

- **WHEN** an apply sub-agent claims GREEN based on `pytest tests/test_<one_file>.py` passing in isolation
- **THEN** the claim is rejected; the full suite is the only acceptable GREEN signal; partial runs are diagnostic only

### Requirement: The c-16 protected tests do not regress

The system SHALL preserve the c-16 protected test results throughout this change: `tests/test_alembic_migration_0003.py` (6/6 passing), `tests/test_config.py` (7/7 passing), and `tests/test_deps.py` (9/9 passing). These 22 tests are the regression-guard for c-16's three buckets (A.1 settings proxy, A.2 alembic 0003 rewrite, and the conftest.py / deps.py cleanups). They MUST stay green; any regression in them is a blocker for this change.

#### Scenario: c-16 protected tests still pass after each fix

- **WHEN** any fix from this change is applied (a fixture change in `conftest.py`, a session/module-scope refactor, a production-code touch in `app/core/rate_limit_ia.py` or `app/core/deps.py`)
- **THEN** the apply sub-agent re-runs `pytest tests/test_alembic_migration_0003.py tests/test_config.py tests/test_deps.py -v` and confirms 6+7+9 = 22 still pass before claiming GREEN for the fix

#### Scenario: a c-16 protected test that regresses is a blocker

- **WHEN** a fix in this change causes any of the 22 c-16 protected tests to fail
- **THEN** the fix is rolled back, the regression is diagnosed, and the apply sub-agent either (a) finds an alternative fix that does not regress c-16, or (b) escalates to the orchestrator with a recommendation to split the c-16-touching change into a separate housekeeping change

### Requirement: The fix targets the pollution source, not the failing consumer

The system SHALL apply each fix to the file or fixture that **leaves the global state behind** (the polluter), not to the file whose tests **fail because of the leak** (the consumer). Consumer-side workarounds are explicitly rejected: `pytest.mark.xfail`, `pytest.mark.skip`, `pytest --deselect`, monkey-patching the consumer test to reset state on enter, and refactoring the consumer's assertions to tolerate the leak are NOT acceptable as the primary fix. The one allowed exception: if the bisection reveals that the consumer test is itself writing to shared state without cleanup (e.g., a `monkeypatch` that does not get restored), the fix is at the consumer; the apply sub-agent records this case explicitly.

#### Scenario: a fix is at the polluting fixture, not the consumer

- **WHEN** the bisection identifies that `tests/test_pago_integration.py`'s module-scope `engine` fixture does not call `engine.dispose()` on teardown, and this leaked engine causes `tests/test_factura_integration.py`'s tests to fail
- **THEN** the fix is in `tests/test_pago_integration.py` (adding `engine.dispose()` to the teardown), not in `tests/test_factura_integration.py` (which keeps its assertions unchanged)

#### Scenario: a consumer-side workaround is rejected

- **WHEN** the apply sub-agent is tempted to add `pytest.mark.xfail` to a consumer test, or to refactor a consumer's assertion to tolerate the leak
- **THEN** the workaround is rejected; the fix must be at the pollution source; the only allowed exception is the documented case where the consumer test is itself the source of the leak

### Requirement: The pollution source is documented

The system SHALL document, for each of the 6 polluting test files, the pollution source after the fix is applied. The documentation captures: which file was the offender, what specific test (or fixture) was the offender, what global state it mutated, what state it left behind, what the first downstream assertion that failed was, and what the fix was. The documentation lives in the apply phase's per-polluter task notes in `tasks.md`. If the apply phase discovers 3 or more distinct root causes, the documentation is also written to a `openspec/changes/c-17-fix-test-pollution/known-debt-resolved.md` file for downstream reference (a mirror of c-16's `known-debt.md` pattern, but for the resolution rather than the debt).

#### Scenario: each polluting file has its pollution source documented

- **WHEN** the apply phase fixes a polluting file
- **THEN** the corresponding `tasks.md` task (e.g. Task 3.2 for `test_pago_integration.py`) records in its notes: the offending test name, the offending fixture name, the state mutation (e.g. `os.environ["DATABASE_URL"] = ...` without restoration), the leaked state (e.g. the module-scope engine reference held in `app.dependency_overrides[get_db]`), the first downstream assertion that failed (e.g. `psycopg2.OperationalError: connection refused`), and the fix (e.g. `engine.dispose()` on teardown + env restoration)

#### Scenario: distinct root causes are captured in known-debt-resolved.md

- **WHEN** the apply phase has identified 3 or more distinct root causes across the 6 polluting files
- **THEN** a `openspec/changes/c-17-fix-test-pollution/known-debt-resolved.md` file is created that mirrors the c-16 `known-debt.md` shape (failure distribution table, isolation evidence, ranked root causes, fix-per-polluter table) so that future maintainers can debug similar pollution without re-running the bisection

#### Scenario: the pollution source documentation is preserved across c-17's archive

- **WHEN** c-17 is archived
- **THEN** the per-task notes in the archived `tasks.md` (and the `known-debt-resolved.md` if it was created) become the canonical reference for the pollution history; a future maintainer reading `openspec/changes/archive/<c-17-archive>/` finds the documentation and does not have to re-diagnose

### Requirement: No new dependencies, no frontend changes, no spec renames

The system SHALL NOT add new Python packages (no `pytest-xdist`, no `pytest-replay`, no `pytest-randomly`, no testcontainers changes), SHALL NOT modify `facturas-proveedores-web/`, and SHALL NOT rename or refile any spec under `openspec/specs/`. The change is strictly test-infrastructure. The one allowed exception: production code in `facturas-proveedores-api/app/` MAY be touched if the bisection reveals a real production bug, and the touch is documented per the design's D-5.

#### Scenario: no new Python package is added

- **WHEN** the apply phase resolves dependencies
- **THEN** `pyproject.toml` and any `requirements*.txt` files are byte-identical to their pre-change state; no new package is added; no existing package is upgraded

#### Scenario: the frontend repo is untouched

- **WHEN** the change is applied
- **THEN** `git diff --stat facturas-proveedores-web/` is empty; the frontend code, tests, and config are unchanged

#### Scenario: no spec under `openspec/specs/` is renamed or refiled

- **WHEN** the change is applied
- **THEN** the directory listing of `openspec/specs/` is the same as before c-17, with one addition: a new `openspec/specs/test-pollution-fix/spec.md` (the capability for this change); no existing spec folder is renamed, no existing spec file is moved, no other spec's content is modified

#### Scenario: a production-code change is documented if it happens

- **WHEN** the apply phase touches any file under `facturas-proveedores-api/app/` (production code)
- **THEN** the touch is recorded in the corresponding `tasks.md` task notes with: the file path, the line number, the change, the regression test that locks the new behavior, and the rationale (citing the bisection evidence that the production bug was the cause of the inter-file pollution)

