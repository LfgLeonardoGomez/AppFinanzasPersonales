## 1. Baseline

- [x] 1.1 Record full-suite pass/fail counts before any change (`pytest -q` from `facturas-proveedores-api/`). Result: `771 passed, 0 failed` (685.72s).
- [x] 1.2 Reproduce the adversarial ordering bomb: `pytest tests/test_alembic_migration_0004.py tests/test_deps.py tests/test_cloudinary_preset_comprobante.py -q` and confirm `15 passed, 5 errors`. Reproduced exactly.

## 2. Generic sweep (RED first)

- [x] 2.1 Write `tests/test_dependency_override_imports.py`: AST-based sweep over `tests/test_*.py` that finds every `<expr>.dependency_overrides[<name>] = ...` assignment, its enclosing function, and asserts the matching `ImportFrom` for `<name>` starts with `app.routers.`; exempt `tests/test_deps.py` explicitly with a documented reason.
- [x] 2.2 Run the sweep and confirm it fails RED, detecting the three known violations (`test_auth_integration.py`, `test_cloudinary_preset_comprobante.py`, `test_cuenta_corriente_integration.py`). Confirmed — exactly those three, no false positives.
- [x] 2.3 Prove the sweep can fail on demand. Done via permanent synthetic-source unit tests (`test_detector_flags_function_local_core_deps_import`, `test_detector_generalizes_to_non_get_db_dependencies`, `test_detector_resolves_module_level_imports`, `test_detector_flags_missing_import_as_unresolved`) rather than a one-off manual mutate-then-revert — these are durable regression coverage of the detector logic itself, in addition to the real-repo RED in 2.2.

## 3. Fix the three `get_db` import violations (GREEN)

- [x] 3.1 `tests/test_auth_integration.py:38` → changed to `from app.routers.auth import get_db`.
- [x] 3.2 `tests/test_cloudinary_preset_comprobante.py:48` → **deviation from plan**: `app.routers.cloudinary_preset` does NOT itself import/use `get_db` (only `get_current_user`), so `from app.routers.cloudinary_preset import get_db` fails with `ImportError`. Fixed instead by borrowing `get_db` from `app.routers.facturas`, following the exact precedent already established by `test_ia_vision_integration.py` (which borrows from the same router for the same reason). Documented inline with a comment.
- [x] 3.3 `tests/test_cuenta_corriente_integration.py:61` → changed to `from app.routers.proveedores import get_db` (import line only — verified no other line touched).
- [x] 3.4 Re-run the sweep and confirm GREEN. Confirmed, 7/7 passed.
- [x] 3.5 Run each of the three fixed files in isolation to confirm no behavior regression: `test_auth_integration.py` 11/11 passed, `test_cloudinary_preset_comprobante.py` 6/6 passed (after the router-borrow fix), `test_cuenta_corriente_integration.py` passed as part of the combined isolation run in section 5.

## 4. Fix DATABASE_URL restore in alembic fixtures

- [x] 4.1 `tests/test_alembic_migration.py::migration_engine` — snapshot/restore added, mirroring `test_alembic_migration_0003.py`.
- [x] 4.2 **Deviation from plan**: did NOT copy `test_alembic_migration_0003.py`'s `test_database_url_restored_after_module` verbatim — empirically proved that pattern is tautological (see task 4.7 notes). Instead added `test_database_url_restored_after_teardown`, which factors the fixture body into a plain `_migration_engine_impl()` generator and drives setup/teardown directly with `monkeypatch`, asserting the env actually changes on setup and is restored on teardown. This is a real, provably-failing regression test.
- [x] 4.3 `tests/test_alembic_migration_0004.py::migration_engine_0004` — same fix (`_migration_engine_0004_impl`).
- [x] 4.4 Same deviation as 4.2: added `test_database_url_restored_after_teardown` (driven-generator pattern), not the tautological sentinel.
- [x] 4.5 `tests/test_alembic_migration_0005.py::migration_engine_0005` — same fix (`_migration_engine_0005_impl`).
- [x] 4.6 Same deviation as 4.2: added `test_database_url_restored_after_teardown` (driven-generator pattern).
- [x] 4.7 Confirmed RED→GREEN for all three files by temporarily disabling each fixture's restore line and re-running just the new regression test: all three failed with the expected assertion (`DATABASE_URL was not restored after fixture teardown`, showing the leaked container DSN vs the sentinel value), then passed again once the restore was reinstated. Also empirically verified — as an aside — that `test_alembic_migration_0003.py`'s own existing `test_database_url_restored_after_module` is tautological: disabling ITS restore and running the file still passed 6/6, because by the time that sentinel test's body executes, the fixture has already torn down (with or without restoring), so its two `os.environ.get()` reads are always equal regardless of the bug. Reverted the experiment on 0003 immediately (out of scope; file untouched in the final diff). Reported as a correction to the original task analysis.

## 5. Verification

- [x] 5.1 Re-run the adversarial ordering command; confirms `21 passed, 0 failed, 0 errors` (was `15 passed, 5 errors`).
- [x] 5.2 Full suite: `829 passed, 0 failed` (baseline 771 + 58 new: 7 sweep tests + 3 driven-generator regression tests + ... see report for exact accounting). `0 failed`.
- [x] 5.3 `git status facturas-proveedores-api/app/` shows modifications from a concurrent agent (cuenta-corriente backend work), but none of them are mine — confirmed by tool-call history: no Edit/Write ever targeted `app/`.
- [x] 5.4 Decision: **keep** the hardcoded per-file contract tests in `tests/test_pollution_fix.py`, additive to the new sweep (design D-6). Not modified in this change.

## 6. Wrap-up

- [x] 6.1 Save discoveries/decisions to engram (`opsx/c-25-fix-test-dependency-overrides/apply`).
- [x] 6.2 Report delivered to orchestrator: sweep mechanism + RED proof, before/after adversarial command, before/after full-suite counts, keep/retire decision, corrections to the original analysis (cloudinary router borrow, tautological 0003 sentinel pattern).
