# Tasks: c-22-fix-multiuser-test-harness

> Test-only change. No file under `app/` may be modified, except the temporary
> mutation in task 6.1 which MUST be reverted within the same task.

## 1. Baseline

- [x] 1.1 Record the starting state: run the full backend suite and capture the exact pass/fail counts and the list of failing test ids
- [x] 1.2 Confirm the four target files fail as expected and that `test_pollution_fix.py`'s 3 failures are the meta-tests for the integration files

## 2. Shared harness (conftest)

- [x] 2.1 Add a per-user authenticated client factory to `tests/conftest.py` that registers + logs in a user and returns the client together with its `usuario_id` and email, with the session living only in that client's own cookie jar (D1)
- [x] 2.2 Preserve the per-login unique `X-Forwarded-For` so the per-IP rate limiter is not tripped when a test creates several users
- [x] 2.3 Add an `anon_client` fixture whose cookie jar is guaranteed empty, for 401 assertions (D2)
- [x] 2.4 Verify the factory produces distinct `usuario_id`s and that a resource created through a client reports that client's `usuario_id`

## 3. Guard against the broken pattern

- [x] 3.1 Add the guard test: an explicit `Cookie` header for user A while the jar holds user B does not reliably authenticate as A (D3)
- [x] 3.2 Document in the guard's docstring why hand-written `Cookie` headers are unsafe under cookie auth, citing both failure modes (writes take the jar's identity; the jar leaks across tests in a module)

## 4. Migrate the small suite first

- [x] 4.1 Migrate `test_cloudinary_preset_comprobante.py` to the new fixtures, removing every `headers=` auth argument
- [x] 4.2 Confirm `test_unauthenticated_returns_401` now passes both alone and with its file
- [x] 4.3 Run the file in isolation and then the full suite; both must be no worse than the 1.1 baseline

## 5. Migrate the integration suites

- [x] 5.1 Migrate `test_pago_integration.py` (39 `headers=` call sites, 33 tests); keep every non-auth assertion byte-identical
- [x] 5.2 Run `test_pago_integration.py` alone and then the full suite before continuing
- [x] 5.3 Migrate `test_factura_integration.py` (41 call sites, 21 tests)
- [x] 5.4 Run `test_factura_integration.py` alone and then the full suite before continuing
- [x] 5.5 Migrate `test_ia_vision_integration.py` (22 call sites, 20 tests)
- [x] 5.6 Run `test_ia_vision_integration.py` alone and then the full suite before continuing
- [x] 5.7 Review the full diff for any assertion whose expected value changed; an isolation test must still assert 404, never a relaxed status

## 6. Prove the tests can fail (mutation check)

- [x] 6.1 Temporarily disable the ownership comparison in `PagoService._get_owned_pago` and `_get_owned_proveedor`, run the migrated isolation tests, confirm they turn RED, then revert the mutation immediately and confirm GREEN again (D4)
- [x] 6.2 Record in the apply summary which tests went red under mutation; any isolation test that stayed green is not real coverage and must be strengthened

## 7. Close out

- [x] 7.1 Confirm `test_pollution_fix.py` passes with no edits to it; if it does not, stop and report a second pollution source rather than patching the meta-test
  - **DEVIATION**: the file DID require an edit, but not for a pollution source. Its 3 isolation meta-tests went green untouched, as predicted. However it also holds fixture-name contract tests (`_imported_get_db_from(text, "fac_client")`) that assert the integration fixtures import `get_db` from a router module. Renaming `fac_client`/`pago_client` → `fac_app`/`pago_app` broke the lookup by name. Edit was a pure rename (12 references); the c-17 contract being asserted is unchanged.
  - **c-17 regression caught by this contract**: `test_multiuser_harness.py` was initially written with `from app.core.deps import get_db` — the exact pattern c-17 bans. It passed alone and failed with 10 connection errors in the full suite, because `test_deps.py` reloads `app.core.deps` and the override key stops matching the routers' `get_db`. Fixed to import from `app.routers.pagos`.
- [x] 7.2 Run the full backend suite and confirm zero failures (expected 760/760)
- [x] 7.3 Run each migrated file in isolation one final time and confirm zero failures
- [x] 7.4 Confirm `git status` shows no modifications under `app/`
