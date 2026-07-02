# Design: c-17-fix-test-pollution

## Context

C-16 (archived 2026-06-28) shipped three buckets of housekeeping fixes: the settings proxy + lazy engine + `cache_clear()` removal (A.1, pre-applied), the alembic 0003 test rewrite (A.2), 2 spec section-header renames (B), and 7 `## Purpose: TBD` fills (C). c-16's closing baseline is `99 failed, 577 passed` for the full backend pytest suite (c-16 `known-debt.md:33`). The 99 failures are **pre-existing inter-file test pollution** that c-16 explicitly documented as out-of-scope debt for c-17 (`known-debt.md:17, 99-106`).

The 6 polluting test files and their failure counts (verbatim from c-16 `known-debt.md:38-45`):

| Test file | Failures | Pass in isolation? | Domain |
|---|---|---|---|
| `tests/test_pago_integration.py` | 28 | yes | Pago CRUD, multi-tenant, soft-delete |
| `tests/test_proveedor_integration.py` | 20 | yes | Proveedor CRUD, ownership isolation, `tiene_dependencias` |
| `tests/test_factura_integration.py` | 18 | yes | Factura CRUD, FIFO estado, file upload, IA `origen=IA` |
| `tests/test_ia_vision_integration.py` | 16 | yes | TestClient + mocked `anthropic`/`openai` SDK |
| `tests/test_perfil_integration.py` | 12 | yes | `PATCH /api/me`, `POST /api/me/avatar`, theme |
| `tests/test_ia_vision_no_persistence.py` | 7 | yes | `before_flush` listener asserting RN-IA-04 |

**Evidence the tests pass in isolation** (`known-debt.md:48-65`): `pytest tests/test_factura_integration.py::TestCreateFactura::test_create_minimal_factura` alone → PASSED. `pytest tests/test_ia_vision_integration.py::TestFacturaHappyPath::test_jpeg_returns_200_with_proposal` alone → PASSED. The same one-liner pattern works for every failing test. This is the canonical signature of **inter-file test pollution** — a file earlier in the suite leaves global state behind that a file later in the suite picks up.

**5 ranked suspect hypotheses** (from `known-debt.md:66-75`, unconfirmed):

1. **Module/session-scope fixtures that mutate global state** (DB, env, config) and leak across module boundaries. Most common offender in FastAPI + testcontainers + SQLAlchemy: a session/engine that outlives a test that closes the connection out from under it.
2. **`os.environ` mutation that does not get restored.** C-16 added env-snapshot/restore discipline to `tests/test_alembic_migration_0003.py` and `tests/conftest.py::env_vars`, but the 6 polluting files may not have the same discipline.
3. **A half-flushed SQLAlchemy session left in the dependency cache** (FastAPI's `app.dependency_overrides` + the c-16 lazy engine) that subsequent tests pick up.
4. **Testcontainers port collision**: a `PostgresContainer` in each integration test picks a random port, but if two containers are alive simultaneously (module-scope vs session-scope) one can be killed mid-test by the other.
5. **Pydantic `Settings()` re-instantiation per attribute access (c-16 D-1)**: micro-cost, but if a test reads a setting that triggers validation against env that was just mutated, the new instance may differ from earlier tests' expected values.

**The current `tests/conftest.py`** (110 lines) has:

- `pg_container` — session-scope, ephemeral Postgres container.
- `db_url` — session-scope, sets `os.environ["DATABASE_URL"]` (NOT restored until session end).
- `env_vars` — session-scope, autouse, snapshots `os.environ` and sets test env; restores on session end.
- `client` — session-scope, builds a FastAPI `TestClient`.

The 6 polluting test files all use the pattern of `@pytest.fixture(scope="module") def engine(db_url)` (a NEW engine on top of the same testcontainer DSN) and `@pytest.fixture(scope="module") def <name>_client(engine, env_vars)` that calls `app.dependency_overrides[get_db] = ...` and `with TestClient(app)`. They also share a `reset_rate_limit_store()` / `reset_ia_rate_limit_store()` call to clear the in-memory rate-limit module-level dicts. The `test_ia_vision_integration.py` and `test_ia_vision_no_persistence.py` files moved `import app.models` from the top of the file to inside the `engine` fixture (c-16 c-14 apply notes); the other 4 polluting files still have `import app.models` at module top.

**Module-level mutable state in production code** that could be pollution source:

- `app/core/rate_limit_ia.py:34` — `_ia_attempts: dict[uuid.UUID, deque] = defaultdict(deque)`. Cleared by `reset_ia_rate_limit_store()` which is called by some polluting fixtures but possibly not all.
- `app/core/deps.py` — the lazy `_get_engine()` (c-16 D-2) holds a single `Engine` per process. Module-scope `engine` fixtures in the 6 polluting files create their own engines on top of the same DSN; the lazy engine in `app.core.deps` is still the one the routers use, so it must be the SAME engine the fixtures create (they're both bound to the testcontainer DSN).

## Goals / Non-Goals

**Goals:**

1. **Bring the full pytest suite to `0 failed`.** After this change, `pytest tests/ -q` from `facturas-proveedores-api/` reports `0 failed` (currently `99 failed` after c-16).
2. **Lock in each fix with a regression test.** A future PR that re-introduces the same pollution (by accident or by copy-paste) MUST be caught by a test, not by manual re-diagnosis.
3. **Fix at the pollution source, not at the consumer.** A consumer-side workaround (`xfail`, `skip`, `deselect`, refactor-of-the-failing-test-only) is explicitly rejected. The fix targets the file or fixture that leaves the state behind.
4. **Document the pollution source.** For each of the 6 polluting files, the apply phase records: which test was the offender, what state it left behind, what the fix was. This documentation is captured in a per-polluter task sub-section in `tasks.md` (and optionally a `known-debt-resolved.md` for downstream reference).
5. **Preserve the c-16 protected tests.** `test_alembic_migration_0003.py` (6/6), `test_config.py` (7/7), `test_deps.py` (9/9) MUST stay green throughout this change.
6. **Embrace the discovery-driven nature of the work.** The proposal does not pre-commit to a fix count; the apply phase empirically discovers whether the 99 failures collapse to 1 root cause or split into 2–3.

**Non-Goals:**

- No new test framework (no `pytest-xdist`, no `pytest-replay`, no `pytest-randomly`).
- No pytest plugin changes (the existing `pytest`, `pytest-asyncio`, `testcontainers`, `psycopg2-binary` stay as-is).
- No new pytest fixtures in `tests/conftest.py` unless discovered necessary (the fix is to make the existing fixtures behave correctly, not to add new layers).
- No refactor of WORKING tests (the failing test files may get targeted edits to their fixtures, but their assertions stay the same).
- No production runtime changes — the rate-limit store, the dependency cache, the session lifecycle, the SQLAlchemy engine, and every other production component keep their current public behavior. **Exception:** if the bisection reveals a real production bug (e.g., a session that is never closed, a module-level dict that grows unboundedly), the fix MAY touch production code, and the change is documented in the proposal's "Possible production code changes" section at the time of discovery.
- No frontend changes (`facturas-proveedores-web/` is untouched).
- No spec renames, no Purpose fills (c-16 already did those buckets).
- No renaming of `perfil-usuario-api` → `perfil-usuario-backend` (Q-2 / Q-4 in `knowledge-base/10_preguntas_abiertas.md`, out of scope for c-17).
- No retroactive edit of `openspec/changes/archive/**`.

## Decisions

### D-1 — The c-16 bisection protocol is the entry point (applied as RED in Task 1)

**What.** The change adopts the protocol from c-16 `known-debt.md:78-90` verbatim as its first action. The protocol is mechanical:

1. Pick one failing test (start with the first failing assertion in `test_pago_integration.py` — the largest bucket at 28 failures).
2. Run it alone — confirms it passes.
3. Run it with a prefix of the suite — passes.
4. Add the next test file — the moment the test starts failing, the most recently added file is the **polluter**.
5. Bisect inside the polluter file — test by test until the polluting test is identified.
6. Inspect the polluting test's fixtures — what global state does it mutate? What does it leave behind?
7. Fix the polluting test.

**Why this protocol and not a fix-everything-in-advance approach.** The 5 ranked suspects are guesses, not diagnoses. A pre-committed fix based on a guess risks:

- Fixing the wrong root cause and leaving 60+ failures untouched.
- Introducing a "fix" that masks the real pollution (e.g., adding a `try/except` around the failing assertion) and creates a future footgun.
- Committing to a refactor of working code that has nothing to do with the pollution.

The bisection is mechanical (steps 1–6 are scripted pytest invocations), takes ~30 min per polluter per c-16's estimate, and produces an **empirically verified** root cause per polluting file. Once the root cause is known, the fix is a small, targeted edit.

**Why start with `test_pago_integration.py`.** It has the most failures (28). If the pollution is "all 99 failures share a single root cause that hits all 6 files in the same way," fixing it for `test_pago_integration.py` may fix all 6 in one shot. If the pollution is per-file (each file has its own leak), starting with the largest bucket is the highest expected payoff.

**Why not use a bisection tool (e.g., `git bisect`).** This is not a regression in code (no commit broke the tests) — it's a structural property of the test suite that has been there since before c-16. `git bisect` is the wrong tool. The pytest-prefix bisection is the right tool.

### D-2 — Each fix gets a regression test that locks the contract

**What.** For each identified pollution source, the apply phase adds a test that:

- **Option A (preferred):** runs the polluting file's tests in isolation *and then* the rest of the suite and asserts no regression. New test module, e.g. `tests/test_<polluter>_no_pollution.py`. This is the "negative-space" test: it asserts that the polluting file does not break later tests AND that later tests do not break the polluting file.
- **Option B (fallback):** a unit test on the polluting fixture itself that asserts the right scope (e.g., `function` not `module`) and the right teardown (e.g., `dispose()` is called, env is restored). This is the "white-box" test on the fixture contract.

**Why both options, not just one.** Option A is the highest-confidence test (it proves the regression doesn't reappear) but is slow (it re-runs the polluting file's tests). Option B is fast and targeted but only proves the fixture contract, not the end-to-end behavior. The apply sub-agent picks the option that fits the discovered fix.

**Why not just one big end-to-end test.** A single "all tests pass" test is what the full pytest run already does — adding it as a separate test is redundant. The per-polluter regression test is more targeted: it points at the specific fix.

### D-3 — Fix at the pollution source, not at the consumer

**What.** The fix targets the **file or fixture that leaves the state behind**, not the file whose tests fail because of the leaked state. Concretely: if `test_factura_integration.py`'s tests fail because `test_pago_integration.py`'s module-scope engine fixture doesn't dispose the engine on teardown, the fix is in `test_pago_integration.py`'s `engine` fixture, not in `test_factura_integration.py`'s tests.

**Why this matters.** A consumer-side workaround (`xfail`, `skip`, "this test is flaky, re-run until it passes") hides the regression. The pollution source is still there, still leaking, and will still cause a real failure in production code that follows the same pattern. Fixing the source means fixing the underlying discipline, which generalizes to any future test file that would have triggered the same leak.

**The one exception.** If the bisection reveals that the consumer test is the one writing to shared state (e.g., a `monkeypatch` that doesn't get cleaned up), the fix is at the consumer. The apply sub-agent records which case applies and explains the trade-off in the task notes.

### D-4 — The 99 failures may collapse to 1 root cause or split into 2–3

**What.** The proposal does not pre-commit to a count of root causes. The apply phase is structured to discover this empirically:

- If the first fix (in `test_pago_integration.py`) flips all 99 failures to passing, the work is done. One root cause.
- If the first fix flips only `test_pago_integration.py`'s 28 failures, the next-largest file (`test_proveedor_integration.py`, 20 failures) gets bisected. The fix may share a root cause (e.g., both files' fixtures miss the same teardown step) or may be independent (e.g., one is a session-cache issue, the other is an env-mutation issue).
- The apply phase continues until every polluting file's failures are at 0.

**Why not pre-commit to a count.** Pre-committing invites the apply sub-agent to invent fixes for non-existent root causes. Empirically discovering the count keeps the work honest: if there are 3 root causes, there are 3 fixes; if there is 1, there is 1.

**The 5 ranked suspects are a starting point, not a checklist.** The apply sub-agent may discover the actual root cause is #4 (testcontainers port collision) and not #1 (module-scope fixtures), in which case the work is on conftest.py and on the container setup, not on individual test files. The proposal accommodates this.

### D-5 — Possible production code changes are documented at discovery, not pre-committed

**What.** If the bisection reveals a real production bug, the fix MAY touch production code. The two most likely candidates identified by reading the code:

- `app/core/rate_limit_ia.py:34` — the module-level `_ia_attempts: dict[uuid.UUID, deque]`. This is a module-level mutable that grows during a test run. If a polluting test exhausts a user's budget and doesn't call `reset_ia_rate_limit_store()`, all subsequent tests for that user get 429s.
- `app/core/deps.py` — the lazy `_get_engine()` (c-16 D-2). If a polluting test's module-scope `engine` fixture conflicts with the lazy engine (same DSN, different `Engine` instance, different connection pool), some tests may bind to one and others to the other, causing cross-pool state to leak.

**Why pre-identify but not pre-commit.** Pre-identifying gives the apply sub-agent a head start: if the bisection is stuck, these are the two production-code locations to inspect. Not pre-committing because the actual fix may not need to touch them.

**Hard rule.** Any production code change is documented in a `## Production code changes` section in the apply phase's task notes, with: the file, the line, the change, the regression test, and the rationale. The proposal does NOT pre-authorize any specific production code change.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| The bisection takes longer than 30 min/polluter (the 6 polluting files × 30 min = 3 hours lower bound) | The estimate is from c-16. If the bisection hits a wall on the first file (e.g., the pollution is session-scope and the prefix is not narrowing it), the apply sub-agent falls back to "log all module-level mutable state, identify the mutation that correlates with the first failing test, trace back to the polluting fixture" — a more manual but bounded approach. Expected upper bound: 2 hours per polluter. |
| The fix requires changes to `tests/conftest.py` that regress c-16's 22 protected tests | The c-16 protected tests (`test_alembic_migration_0003.py` 6/6, `test_config.py` 7/7, `test_deps.py` 9/9) are run after every fix in `tasks.md` (the cross-bucket verification task). If they regress, the fix is rolled back. |
| The fix requires changes to a session-scope fixture that affects ALL 50+ test files, not just the 6 polluting ones | The fix is scoped to the specific fixture (e.g., add a `teardown` step that was missing) without changing the fixture's scope or its public contract. The c-16 protected tests + a sampled subset of the 50+ other test files (e.g., `test_factura_service.py`, `test_pago_service.py`, `test_cuenta_corriente_service.py`) are run as a regression check. |
| The actual root cause is a testcontainers port collision (#4 hypothesis) | The fix may need to switch from session-scope `pg_container` to function-scope, or to use a single testcontainers instance shared across all files (already the case, per `conftest.py:25-38`). If port collision is the real cause, the fix is on the container startup, not on individual test files. |
| The fix touches production code (e.g., `rate_limit_ia.py`) and the regression is hard to test | The production-code change is locked in with a unit test on the new behavior (e.g., "the rate-limit store is reset between requests" or "the session is closed after the response"). The integration test continues to pass because the public behavior is unchanged. |
| The 5 ranked suspects are all wrong, and the real cause is a 6th unknown | The bisection protocol is suspect-agnostic: it identifies the polluting file and the polluting test by empirical prefix-narrowing, regardless of which suspect hypothesis the fix turns out to be. The ranked suspects are a starting heuristic for what to look at, not a constraint on what can be found. |
| The 99 failures split into many small root causes (one per test, not one per file) | Highly unlikely (the file-level distribution is a strong signal that the pollution is fixture-level, not test-level). If it happens, the work expands; the proposal accommodates this by not pre-committing to a fix count. |

## Migration Plan

This is a test-infrastructure-only change. The deployment story:

1. Apply the c-17 change in a working branch (no in-progress feature work).
2. Run the full backend test suite: `pytest tests/ -q --tb=line` from `facturas-proveedores-api/`. Expected: `0 failed`.
3. Run the c-16 protected tests: `pytest tests/test_alembic_migration_0003.py tests/test_config.py tests/test_deps.py` — all 22 still pass.
4. Run `openspec validate c-17-fix-test-pollution` — must be clean.
5. Run `git diff --stat` and confirm no `facturas-proveedores-web/` changes, no `openspec/changes/archive/**` changes, no `pyproject.toml` changes.
6. Merge the PR.
7. Rollback: revert the merge commit. Test-only changes revert cleanly. If production code was touched (the exception case), reverting restores the original production behavior and the failing tests come back.

No database migration, no feature flag, no staged rollout. Test-only changes are safe to merge and roll back as atomic units.

## Open Questions

- **Q-C17-1 (resolved at propose time):** Is the capability name `test-pollution-fix` apt, or should it be `test-suite-isolation` or `inter-file-fixtures`?
  - **Decision:** `test-pollution-fix`. The change is explicitly about fixing inter-file pollution, not about general test suite isolation. `test-suite-isolation` is a broader scope that could imply a full pytest plugin re-architecture, which is out of scope. `inter-file-fixtures` is narrower than the actual change (the bisection may find non-fixture causes, e.g., production-code state). The c-16 precedent for this kind of umbrella is `fix-suite-and-specs`; `test-pollution-fix` follows the same kebab-case, action-oriented naming.
- **Q-C17-2 (open):** Should the apply phase produce a `known-debt-resolved.md` file (mirroring c-16's `known-debt.md` pattern) for downstream reference?
  - **Recommendation:** yes, if the apply phase discovers 3 or more distinct root causes (the file is useful as a debugging reference for future maintainers). If the root causes collapse to 1, the per-task notes are sufficient. The apply sub-agent decides.
- **Q-C17-3 (open):** If the bisection hits a real production bug (the documented exception), should the production-code fix be its own change, or inlined into c-17?
  - **Recommendation:** inline if the production-code fix is ≤ 20 lines and is provably the cause of the pollution (the bisection shows it). Otherwise, split it into a separate change (e.g., c-18) and let c-17 mark the pollution as "blocked on c-18". The orchestrator decides at apply time.
- **Q-C17-4 (open):** Should the `test_pago_integration.py` and other polluting test files be refactored to use a shared `_client_factory` fixture (extracted to `tests/_factories.py` or `conftest.py`) to prevent future copy-paste of the broken pattern?
  - **Recommendation:** no, not in this change. The fix is to make the existing fixtures behave correctly. A refactor to share fixtures is a separate, larger refactor that should be its own change (c-18+). C-17 stays focused on the pollution fix.
