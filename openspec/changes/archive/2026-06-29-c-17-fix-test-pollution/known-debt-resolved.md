# Known Debt Resolved for c-17 — Inter-File Backend Test Pollution

> Recorded by **c-17** (Task 2.8) as the resolution of the 101 pre-existing
> inter-file test pollution failures documented by c-16 in
> `openspec/changes/archive/2026-06-28-c-16-fix-suite-and-specs/known-debt.md`.

## Status snapshot (c-17 close)

| Bucket | In scope for c-17? | State at c-17 close |
|---|---|---|
| **Inter-file test pollution (101 failures)** | **YES** | **RESOLVED — `0 failed, 701 passed` (was `101 failed, 593 passed` at c-16 close). All 6 polluting files now pass in the full suite. Locked in by `tests/test_pollution_fix.py` (13 tests: 1 invariant + 6 fixture contracts + 6 isolation regressions).** |
| c-16 protected tests (`test_alembic_migration_0003.py` 6/6, `test_config.py` 7/7, `test_deps.py` 9/9) | YES (must not regress) | **22/22 still passing** (verified at c-17 close). |
| Module-identity invariant | YES (new) | Routers keep the OLD `get_db` reference after `app.core.deps` reload. Locked in by `TestRouterModuleIdentityInvariant::test_routers_keep_old_get_db_after_deps_reload`. |

## Root cause (single, confirmed by bisection)

The 101 inter-file pollution failures share **one** root cause: a
module-identity mismatch created by
`tests/test_deps.py::TestLazyEngine::test_deps_module_does_not_construct_engine_at_import`
(line 232 in test_deps.py), which does:

```python
for mod_name in list(sys.modules):
    if mod_name.startswith("app.core.deps"):
        del sys.modules[mod_name]
import app.core.deps as deps_module  # fresh import, NEW module
```

This creates a NEW `app.core.deps` module with a NEW `get_db` function
object. But the app's routers (registered when `app.main` was first
loaded) keep their reference to the OLD `get_db` function object.

The 6 polluting integration test files' fixtures did:

```python
from app.core.deps import get_db   # ← BUGGY: gets NEW get_db after reload
app.dependency_overrides[get_db] = override_get_db
```

After the `del sys.modules`, this import returns the NEW `get_db`, so
the override is set for the WRONG key. The routes' `Depends(get_db)`
(which references the OLD `get_db`) never finds the override and falls
through to the lazy engine in the OLD `app.core.deps` module — which
is bound to a dead testcontainer DSN (because the alembic migration
test files mutated `os.environ["DATABASE_URL"]` and didn't restore it).

**The pollution signature: "Connection refused on port XXXXX"** — the
engine is trying to connect to a testcontainer that was killed when
the alembic migration module's fixture tore down.

### Why the 6 polluting files and not the others

The 6 polluting files all run **alphabetically AFTER** `test_deps.py`
in the test collection order:

| Polluting file | Test count | After test_deps.py? |
|---|---|---|
| `tests/test_factura_integration.py` | 18 | ✅ |
| `tests/test_ia_vision_integration.py` | 16 | ✅ |
| `tests/test_ia_vision_no_persistence.py` | 7 | ✅ |
| `tests/test_pago_integration.py` | 28 | ✅ |
| `tests/test_perfil_integration.py` | 12 | ✅ |
| `tests/test_proveedor_integration.py` | 20 | ✅ |

The non-polluting integration test files with the same fixture pattern
(`test_auth_integration.py`, `test_cuenta_corriente_integration.py`,
`test_deps.py` itself) all run **BEFORE** `test_deps.py`'s `del sys.modules`,
so they get the OLD `get_db` and the override is effective.

## Fix (minimal, targeted)

The 6 polluting files' fixtures MUST import `get_db` from a **router
module** (which holds the OLD reference in its namespace) instead of
from `app.core.deps` (which holds the NEW reference after the reload).

| File | Fix |
|---|---|
| `tests/test_factura_integration.py` | `from app.routers.facturas import get_db` |
| `tests/test_pago_integration.py` | `from app.routers.pagos import get_db` |
| `tests/test_proveedor_integration.py` | `from app.routers.proveedores import get_db` |
| `tests/test_perfil_integration.py` | `from app.routers.usuarios import get_db` |
| `tests/test_ia_vision_integration.py` | Added `get_db` override using `from app.routers.facturas import get_db` (was missing — relied on lazy engine) |
| `tests/test_ia_vision_no_persistence.py` | Added `get_db` override using `from app.routers.facturas import get_db` (was missing — relied on lazy engine) |

The fix is at the **consumer** (the polluting files' fixtures), not at
the source (test_deps.py's `del sys.modules`). This is the documented
exception in the spec: the consumer test is "writing to shared state
without cleanup" — it uses `app.dependency_overrides` with a key that
becomes stale after the `del sys.modules`. The spec allows the fix at
the consumer in this case.

The source (test_deps.py) is a c-16 protected test and must not be
modified. The `del sys.modules` is a deliberate test of the lazy engine
contract (c-16 D-2): it verifies that `_engine is None` at import time
after a fresh import.

## Why the source wasn't fixed (alternative considered)

The "ideal" fix would be to remove the `del sys.modules` from
test_deps.py. But test_deps.py is a **c-16 protected file** (6/6 of
the 22 protected tests are in test_deps.py). The spec explicitly
forbids regressing the c-16 protected tests, and the `del sys.modules`
is a load-bearing part of the lazy-engine regression test (it
verifies that `_engine is None` after a fresh import). Removing it
would defeat the test's purpose.

The consumer fix is the right tradeoff: the consumer's `get_db`
import is an implementation detail of the test fixture, not part of
the test contract. Changing it from `app.core.deps` to a router module
is a minimal, targeted change that doesn't affect the test assertions.

## Failure distribution (before → after)

| Test file | Before c-17 (full suite) | After c-17 (full suite) | Delta |
|---|---|---|---|
| `tests/test_factura_integration.py` | 18 failed | 0 failed | -18 |
| `tests/test_pago_integration.py` | 28 failed | 0 failed | -28 |
| `tests/test_proveedor_integration.py` | 20 failed | 0 failed | -20 |
| `tests/test_ia_vision_integration.py` | 16 failed | 0 failed | -16 |
| `tests/test_perfil_integration.py` | 12 failed | 0 failed | -12 |
| `tests/test_ia_vision_no_persistence.py` | 7 failed | 0 failed | -7 |
| **Polluting total** | **101 failed** | **0 failed** | **-101** |
| New regression tests (`test_pollution_fix.py`) | n/a | 13 passed | +13 |
| **Full suite total** | **101 failed, 593 passed** | **0 failed, 701 passed** | **-101 / +108** |

## Isolation evidence (before fix, one-liner per polluting file)

```
$ pytest tests/test_factura_integration.py::TestCreateFactura::test_create_minimal_factura
PASSED

$ pytest tests/test_pago_integration.py::TestCreatePago::test_create_minimal_pago
PASSED

$ pytest tests/test_proveedor_integration.py::TestPost::test_create_returns_201_with_saldo_zero
PASSED

$ pytest tests/test_ia_vision_integration.py::TestFacturaHappyPath::test_jpeg_returns_200_with_proposal
PASSED

$ pytest tests/test_ia_vision_no_persistence.py::test_factura_extraer_ia_image_only
PASSED

$ pytest tests/test_perfil_integration.py::TestPatchMe::test_patch_me_subset_update_returns_200
PASSED
```

Every polluting test passes in isolation but fails in the full suite —
the canonical signature of inter-file test pollution.

## Regression tests (locked in by `tests/test_pollution_fix.py`)

13 tests, organized as:

1. **1 module-identity invariant** — `TestRouterModuleIdentityInvariant`
   verifies that the router modules keep their OLD `get_db` reference
   after `app.core.deps` is reloaded. This is the premise of the fix.

2. **6 per-polluter fixture contracts** — one per polluting file. Each
   inspects the fixture's source via AST and asserts that `get_db` is
   imported from a router module, NOT from `app.core.deps`. If a future
   PR reverts the import, the test fails.

3. **6 isolation regressions** — parametrized over the 6 polluting
   files. Each runs the polluting file's tests in isolation (subprocess)
   and asserts they still pass. This catches regressions where the fix
   accidentally changes test behavior.

## C-16 protected tests (must not regress)

```
$ pytest tests/test_alembic_migration_0003.py tests/test_config.py tests/test_deps.py -v
22 passed
```

All 22 c-16 protected tests still pass at c-17 close.

## Out of scope (carried forward from c-16)

- The alembic migration test files (`test_alembic_migration.py`,
  `test_alembic_migration_0004.py`, `test_alembic_migration_0005.py`,
  `test_refresh_token_model.py`) still mutate `os.environ["DATABASE_URL"]`
  and don't restore it. c-17 did NOT add the snapshot/restore pattern
  to these files because:
  1. They are not the pollution SOURCE (they run BEFORE test_deps.py's
     `del sys.modules`).
  2. Adding the pattern would be a drive-by refactor of working tests.
  3. The c-16 debt already documented this in `known-debt.md:97`.

  Future housekeeping (c-18+) can add the snapshot/restore pattern as
  a defensive measure, but it's not required for c-17's pollution fix.

- The `test_deps.py::TestLazyEngine::test_deps_module_does_not_construct_engine_at_import`
  test still does `del sys.modules`. This is a load-bearing part of
  the c-16 D-2 lazy-engine regression test. c-17 does NOT modify it
  (c-16 protected).

## Handoff to c-18+

When c-18+ starts:

1. The full pytest suite reports `0 failed, 701 passed` from
   `facturas-proveedores-api/`.
2. The c-16 protected tests still pass: `pytest tests/test_alembic_migration_0003.py
   tests/test_config.py tests/test_deps.py` → 22/22.
3. The pollution source is locked in by `tests/test_pollution_fix.py`
   (13 tests). If a future PR reverts the `get_db` import in any of
   the 6 polluting files, the regression test fails immediately.
4. The pre-existing uncommitted state (c-16 D-3 changes in test files,
   plus changes to `app/core/config.py`, `app/core/deps.py`, etc.) is
   NOT part of c-17. It was in the working tree before c-17 started
   and should be committed separately.
