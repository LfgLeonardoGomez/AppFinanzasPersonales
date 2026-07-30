# Proposal: c-22-fix-multiuser-test-harness

## Why

The backend suite reports **17 failures** (743 passing) and every one of them sits on the guarantee that matters most in this system: **regla dura #3 — a resource belonging to another user must return 404**. The failing tests are named `test_get_foreign_pago_returns_404`, `test_list_user_isolation`, `test_create_foreign_proveedor_returns_404`, `test_unauthenticated_returns_401`.

A red suite on tenant isolation demands an answer to one question before anything else: **is this a real data leak?** It is not. Measured, not inferred:

- Driving the API with **one `TestClient` per user** (identity carried only by that client's own cookie jar), user B gets **404** on A's pago for `GET`, `PATCH` and `DELETE`, **404** on A's proveedor, and B's list returns **0 items** while A's returns 1. Authorization in the service layer is correct and `_get_owned_pago` / `_get_owned_proveedor` behave exactly as specified.

The defect is in the **test harness**. `_register_and_login()` returns a hand-written header `{"Cookie": f"access_token={token}"}` and the tests simulate a second user by passing that header per request. Meanwhile the module-scoped `TestClient` keeps a **live httpx cookie jar** holding the most recent login. Two consequences, both reproduced:

1. **On `POST`, the jar wins over the explicit header.** A pago created with `headers=headers_a` comes back with `usuario_id == id_B`. The "foreign" resource was never foreign — it was created by the same user that later reads it, so the endpoint correctly answers 200 and the `assert 404` fails. Clearing the jar and sending only the explicit header yields **401**, proving the header does not authenticate a `POST` on its own.
2. **The jar leaks across tests in a module.** `test_unauthenticated_returns_401` **passes when run alone and fails when run with its file**: an earlier test logged in, the jar still holds that cookie, and the supposedly anonymous request arrives authenticated.

So these 17 tests have not been verifying tenant isolation. They were green while asserting nothing, which is the most expensive kind of test: it buys confidence without buying coverage. Fixing them restores a real regression barrier around the project's most security-sensitive invariant.

## What Changes

- **Replace the hand-written `Cookie` header pattern with one authenticated `TestClient` per user.** A shared helper builds a client whose identity lives exclusively in its own cookie jar, so "user A" and "user B" cannot silently collapse into the same identity. This is the only mechanism that makes multi-user assertions trustworthy under cookie auth.
- **Give anonymous requests a client with a guaranteed-empty jar**, so `401` tests assert absence of session rather than inheriting one from a previous test.
- **Migrate the affected suites** to the new helper: `test_pago_integration.py`, `test_factura_integration.py`, `test_ia_vision_integration.py`, `test_cloudinary_preset_comprobante.py`.
- **Restore the meta-tests in `test_pollution_fix.py`** (they assert the three integration files pass in isolation; they go green once the underlying files do). The c-17 pollution guarantee is re-established on top of correct tests.
- **Add a guard test that fails if the broken pattern returns** — asserting that a request carrying an explicit `Cookie` header while a foreign session sits in the jar does not silently authenticate as the jar's user. Without this, the next person writes the same helper again.
- **No application code changes.** Authorization, routers, services and cookie handling stay untouched; this change only fixes how the suite talks to them.

## Capabilities

### New Capabilities
- `multiuser-test-isolation`: how the backend suite establishes, separates and asserts distinct authenticated identities under cookie-based auth, including anonymous requests and the prohibition on hand-written `Cookie` headers.

### Modified Capabilities
<!-- None. No application requirement changes; the app already satisfies regla dura #3. -->

## Impact

- **Affected code**: test-only. `facturas-proveedores-api/tests/test_pago_integration.py`, `test_factura_integration.py`, `test_ia_vision_integration.py`, `test_cloudinary_preset_comprobante.py`, plus a shared helper (`tests/conftest.py` or a dedicated `tests/helpers/auth_client.py`) and a new guard test. `tests/test_pollution_fix.py` is expected to go green without edits.
- **Not affected**: `app/` in its entirety — no router, service, repository or cookie logic changes.
- **Risk**: low in blast radius, but the migration touches the auth setup of four suites; a careless rewrite could weaken assertions instead of strengthening them. Every migrated test must be shown to fail when the invariant it guards is broken.
- **Expected outcome**: 760/760 green, with the isolation tests actually exercising isolation.
- **Related**: `openspec/specs/test-pollution-fix/spec.md` (c-17) established suite-level determinism; this change sits alongside it and depends on its guarantees holding.
