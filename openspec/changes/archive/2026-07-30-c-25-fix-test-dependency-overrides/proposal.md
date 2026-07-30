## Why

The c-17 fix (`test-pollution-fix` capability) closed the inter-file pollution bug by requiring every `app.dependency_overrides[get_db]` fixture to import `get_db` from a router module instead of `app.core.deps`, and locked it in with hardcoded per-file contract tests in `tests/test_pollution_fix.py`. Three more files were added later (`test_auth_integration.py`, `test_cloudinary_preset_comprobante.py`, `test_cuenta_corriente_integration.py`) with the exact same buggy `from app.core.deps import get_db` pattern, and none of them are covered by the hardcoded guard — because the guard only ever watches files someone remembered to add. Separately, three alembic migration test files (`test_alembic_migration.py`, `test_alembic_migration_0004.py`, `test_alembic_migration_0005.py`) mutate `os.environ["DATABASE_URL"]` without restoring it, which is the mechanism that turns a dependency-override miss into a live connection failure. The suite currently passes only by alphabetical collection luck; reproduced adversarial ordering (`pytest tests/test_alembic_migration_0004.py tests/test_deps.py tests/test_cloudinary_preset_comprobante.py -q`) gives `15 passed, 5 errors`. This change closes both holes and replaces the hole-prone hardcoded guard with a generic sweep that catches any future violation automatically.

## What Changes

- Fix the three confirmed `get_db` override violations to import from their router module instead of `app.core.deps`:
  - `tests/test_auth_integration.py` → `from app.routers.auth import get_db`
  - `tests/test_cloudinary_preset_comprobante.py` → `from app.routers.cloudinary_preset import get_db`
  - `tests/test_cuenta_corriente_integration.py` → `from app.routers.proveedores import get_db` (import-line edit only — this file is owned by a concurrent change; nothing else in it is touched)
- Fix the `DATABASE_URL` restore gap in the three alembic fixtures that never restore the env var, following the proven snapshot/restore pattern already in `test_alembic_migration_0003.py`:
  - `tests/test_alembic_migration.py`
  - `tests/test_alembic_migration_0004.py`
  - `tests/test_alembic_migration_0005.py`
- Add a generic AST-based sweep test (new file, `tests/test_dependency_override_imports.py`) that scans every `tests/test_*.py` file for any `<expr>.dependency_overrides[<dep_name>] = ...` assignment, locates its enclosing function, and asserts the matching `ImportFrom` for `<dep_name>` starts with `app.routers.` — with a short, explicit exemption list (`test_deps.py`, which intentionally reloads `app.core.deps` and tests it directly). This closes the gap the hardcoded per-file tests in `tests/test_pollution_fix.py` cannot close (they only watch files someone remembered to add).
- Add a `DATABASE_URL` restore regression test to each of the three fixed alembic files, mirroring `test_alembic_migration_0003.py::test_database_url_restored_after_module`.
- Decide whether to keep or retire the existing hardcoded per-file contract tests in `tests/test_pollution_fix.py` now that the generic sweep supersedes their coverage (see design.md).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `test-pollution-fix`: extends the c-17 contract from a hardcoded, per-file allowlist to a generic sweep that structurally enforces "any `dependency_overrides` target must be imported from a router module" across the whole `tests/` directory, and extends the "no dangling env mutation" contract to all three previously-unrestored alembic fixtures (not just 0003).

## Impact

- Affected files: `facturas-proveedores-api/tests/test_auth_integration.py`, `test_cloudinary_preset_comprobante.py`, `test_cuenta_corriente_integration.py` (import line only), `test_alembic_migration.py`, `test_alembic_migration_0004.py`, `test_alembic_migration_0005.py`, plus one new file `tests/test_dependency_override_imports.py`.
- No production code (`app/`) is touched. No frontend code is touched. No new dependencies.
- Test-infrastructure only; closes a real, reproduced test-ordering hazard (`15 passed, 5 errors` under adversarial ordering) without changing any test's assertions or behavior.
