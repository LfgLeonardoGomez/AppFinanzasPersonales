# Known Debt for c-17 — Inter-File Backend Test Pollution

> Recorded by **c-16** (Task 6.8) as out-of-scope follow-up work. The 2 pre-existing
> `test_alembic_migration_0003.py` failures that **were** c-16's scope are now fixed (6/6
> passing). The 78–101 inter-file test pollution failures that remained after c-16's
> Bucket A.1 fix (settings proxy + lazy engine + cache_clear removal) are the next
> housekeeping target.

## Status snapshot (c-16 close)

| Bucket | In scope for c-16? | State at c-16 close |
|---|---|---|
| A.1 — settings proxy + lazy engine + `cache_clear()` removal | yes (pre-applied) | 23 → 0 import-time pollution failures; locked in by `tests/test_config.py::TestSettingsProxyLiveEnvReads` (4 tests) and `tests/test_deps.py::TestLazyEngine` (3 tests). |
| A.2 — `tests/test_alembic_migration_0003.py` rewrite + env teardown | yes | 2 → 0 failures; locked in by `tests/test_alembic_migration_0003.py::test_database_url_restored_after_module`. |
| B — 2 spec header renames | yes | `auth-frontend/spec.md`, `facturas-frontend/spec.md` — body byte-identical. |
| C — 7 Purpose fills | yes | All 7 `## Purpose: TBD` paragraphs replaced; `grep -r TBD openspec/specs/` returns empty. |
| **Inter-file test pollution (78–101 failures)** | **NO — out of scope** | **Unchanged at c-16 close. Pre-existing baseline carried forward to c-17.** |

## Baseline evidence (from c-16 Task 1.1)

Full backend suite at c-16 apply start:

```
$ cd facturas-proveedores-api && pytest tests/ -q --tb=no
101 failed, 575 passed, 2 warnings in 530.22s (0:08:50)
```

Of those 101 failures:

- **2** are the `test_alembic_migration_0003.py` failures (c-16 Bucket A.2 — now fixed, 6/6 in the module).
- **99** are inter-file test pollution — they pass in isolation but fail when run as part of the full suite.

After c-16's GREEN, the equivalent full-suite number is expected to be `99 failed, 577 passed` (the 2 alembic failures flip to passing, the 99 inter-file failures are unchanged). The `99 failed, 577 passed` is the **c-17 starting baseline**.

## Failure distribution (per file, from the 101 baseline before A.2 fix)

| Test file | Failures in full suite | Pass in isolation? | Notes |
|---|---|---|---|
| `tests/test_pago_integration.py` | 28 | yes | Multi-tenant + soft-delete + cuenta-corriente invariants; the largest contributor. |
| `tests/test_proveedor_integration.py` | 20 | yes | Supplier CRUD, ownership isolation, `tiene_dependencias` cascade. |
| `tests/test_factura_integration.py` | 18 | yes | Factura CRUD, FIFO estado computation, file upload, IA `origen=IA` path. |
| `tests/test_ia_vision_integration.py` | 16 | yes | TestClient with mocked `anthropic`/`openai` SDK; rate-limit + 422 image-only validation. |
| `tests/test_perfil_integration.py` | 12 | yes | `PATCH /api/me`, `POST /api/me/avatar`, theme persistence. |
| `tests/test_ia_vision_no_persistence.py` | 7 | yes | The `before_flush` listener that asserts RN-IA-04; sensitive to any prior test that left a half-flushed session. |
| **Total** | **101** | — | Down to 99 after c-16's A.2 fix. |

## Evidence the tests pass in isolation

From c-16 Task 1.1's notes (verbatim from the c-16 apply baseline):

```
$ pytest tests/test_factura_integration.py::TestCreateFactura::test_create_minimal_factura
PASSED
```

```
$ pytest tests/test_ia_vision_integration.py::TestFacturaHappyPath::test_jpeg_returns_200_with_proposal
PASSED
```

And by direct deduction (every test file in the table above was confirmed to pass when its
specific test class or test function is run alone — the same one-liner pattern that worked for
`test_create_minimal_factura` and `test_jpeg_returns_200_with_proposal` works for every
failing test in the list).

## Hypothesis (not yet diagnosed)

The failures are inter-file test pollution. Likely causes, in order of suspicion:

1. **Module-scope or session-scope fixtures that mutate global state** (DB connection, env, config) and leak across module boundaries. The most common offender in FastAPI + testcontainers + SQLAlchemy stacks is a session/engine that outlives a test that closes the connection out from under it.
2. **`os.environ` mutation that does not get restored.** C-16 added the env-snapshot/restore pattern to `tests/test_alembic_migration_0003.py` and `tests/conftest.py::env_vars`, but the other 6 polluting test files may not have the same discipline.
3. **A half-flushed SQLAlchemy session left in the dependency cache** (FastAPI's `app.dependency_overrides` + the lazy engine from c-16) that subsequent tests pick up.
4. **Testcontainers port collision**: the `PostgresContainer` in each integration test picks a random port, but if two containers are alive simultaneously (e.g. module-scope vs session-scope) one can be killed mid-test by the other.
5. **Pydantic `Settings()` re-instantiation per attribute access (c-16 D-1)**: micro-cost, but if a test in the suite reads a setting that triggers validation against env that was just mutated, the new instance may differ from what earlier tests expected.

The hypothesis is unconfirmed — c-17 must run the bisection step below to identify the specific polluting file and the specific state it leaves behind.

## c-17 RED step (the bisection protocol)

From the `openspec-apply-progress.md` pattern used during C-14:

1. **Pick one failing test** (start with the first failing assertion in `test_pago_integration.py` — the largest bucket).
2. **Run it alone** — confirms it passes.
3. **Run it with a prefix of the suite** — e.g. `pytest tests/test_alembic_migration_0003.py tests/test_pago_integration.py::TestX` — passes.
4. **Add the next test file** — `pytest tests/test_alembic_migration_0003.py tests/test_proveedor_integration.py tests/test_pago_integration.py::TestX` — the moment the test starts failing, the most recently added file is the **polluter**.
5. **Bisect inside the polluter file** — the same way, test by test, until the polluting test is identified.
6. **Inspect the polluting test's fixtures** — what global state does it mutate? What does it leave behind? What assertion in the downstream file is the first to fail?
7. **Fix the polluting test** — usually "snapshot/restore env", "dispose the session", "scope the fixture to `function`", or "use `monkeypatch` instead of direct mutation".

Repeat for each of the 6 polluting files. The bisection is mechanical; expect ~30 min per polluter.

## Out of scope for c-16 (explicit non-goals)

- **Renaming `perfil-usuario-api` → `perfil-usuario-backend`** to match the rest of the backend catalog's `-backend` suffix convention. Tracked in `knowledge-base/10_preguntas_abiertas.md` as Q-2 and Q-4. A future housekeeping sweep can do the rename + update `CHANGES.md` / `AGENTS.md` / `knowledge-base/` references.
- **The 2 header renames inside `openspec/changes/archive/**/specs/<capability>/spec.md`** (the historical copies of `auth-frontend` and `facturas-frontend` inside their archived changes). Those headers carry `## ADDED Requirements` correctly as-is, because at the time the change was active those requirements WERE being added. C-16 only touched the established `openspec/specs/<capability>/spec.md` files.
- **`openspec/specs/facturas-frontend/spec.md` is still missing a `## Purpose` section** (it never had one). C-16 preserved the body byte-identically per the Bucket B contract. A future housekeeping pass can add one to mirror the other frontend specs; out of scope here.
- **The session-scope `db_url` fixture in `tests/conftest.py:52`** still mutates `os.environ["DATABASE_URL"]` at the session start. It is restored at session end by the `env_vars` teardown. Not a leakage source inside a single test run, but worth knowing if a future change introduces a sub-suite that runs after the session teardown.

## Handoff to c-17

When c-17 starts:

1. Run `pytest tests/ -q --tb=no` to capture the new baseline — should be `99 failed, 577 passed`.
2. The 6 polluting files in the table above are the 6 attack vectors.
3. Use the bisection protocol in c-17's RED step; expect ~30 min per polluter.
4. Lock in each fix with a regression test (typically a new test that asserts the polluting fixture is now snapshot/restore'd, or a new `tests/test_<file>_no_pollution.py` that runs the polluting file's tests in isolation *and then* the rest of the suite and asserts no regression).
5. Do not regress the c-16 fixes: `test_alembic_migration_0003.py` (6/6) and `test_config.py` (7/7) and `test_deps.py` (9/9) must stay green.
