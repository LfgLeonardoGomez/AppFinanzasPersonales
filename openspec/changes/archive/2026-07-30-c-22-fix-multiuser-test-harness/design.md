# Design: c-22-fix-multiuser-test-harness

## Context

The backend authenticates exclusively through HttpOnly cookies (`access_token`, `refresh_token`). The integration suites, however, simulate identity with a hand-written header returned by `_register_and_login()`:

```python
token = login_resp.cookies.get("access_token")
return token, {"Cookie": f"access_token={token}"}
```

Every request then passes `headers=headers_a` or `headers=headers_b`. This works only if the client has no cookies of its own — and it does have them. `TestClient` (httpx) keeps a persistent jar, and the fixtures are `scope="module"`, so a single client accumulates the sessions of every login in the file.

Two failure modes were reproduced directly, not inferred:

- **Writes take identity from the jar.** A pago created with `headers=headers_a` persists with `usuario_id == id_B`. With the jar cleared and only the explicit header present, the same `POST` returns **401** — the header does not authenticate a write on its own.
- **The jar leaks across tests.** `test_cloudinary_preset_comprobante.py::test_unauthenticated_returns_401` **passes alone and fails inside its file**, because an earlier test's session is still in the jar.

The consequence is that the "foreign" resource in every isolation test was in fact created by the *same* user that later reads it, so the endpoint legitimately answers 200 and the `assert 404` fails. Verified with one client per user, the application is correct: B gets 404 on A's pago for `GET`/`PATCH`/`DELETE`, 404 on A's proveedor, and listings are properly scoped (A: 1, B: 0).

Scale of the migration:

| File | `headers=` call sites | logins | tests |
|---|---|---|---|
| `test_pago_integration.py` | 39 | 35 | 33 |
| `test_factura_integration.py` | 41 | 24 | 21 |
| `test_ia_vision_integration.py` | 22 | 0 | 20 |
| `test_cloudinary_preset_comprobante.py` | 7 | 6 | 6 |

`test_pollution_fix.py` needs no edit: its three failing meta-tests assert that those files pass in isolation, which follows once they do.

## Goals / Non-Goals

**Goals:**
- Make identity in tests unforgeable: one authenticated `TestClient` per user, session only in its own jar.
- Restore regla dura #3 as a real regression barrier across `GET`/`PATCH`/`DELETE`/list.
- Make `401` tests independent of execution order.
- Leave behind an executable guard so the header pattern cannot quietly return.
- Full suite green (expected 760/760) with migrated files also green in isolation.

**Non-Goals:**
- No application changes. Routers, services, repositories and cookie handling are correct and stay untouched.
- No rewrite of assertions unrelated to authentication (amount validation, FIFO, `factura_id` rejection, etc.) — they are migrated as-is.
- Not fixing the `307` redirect on trailing-slash paths (`/api/proveedores/` → `/api/proveedores`). It is a real wart, observed while diagnosing, but it is an application/routing concern and belongs in its own change.
- No change to the testcontainers/Postgres strategy (regla dura #9 stands).

## Decisions

### D1: One `TestClient` per user, identity in the jar — not per-request headers

A factory returns a freshly logged-in client per user. Identity is whatever that client's jar holds, which is exactly how a browser behaves.

```python
def make_user_client(app) -> AuthedClient:   # returns (client, usuario_id, email)
```

Call sites lose the `headers=` argument entirely: `client_a.post("/api/pagos", json=...)`.

*Alternatives considered:*
- **Clear `client.cookies` before every request and keep the header.** Rejected: it needs discipline at 109 call sites, and a single forgotten call silently reintroduces the bug with no visible symptom — the exact property that let this survive undetected.
- **Bearer tokens in tests.** Rejected: the API does not accept them. Tests would stop exercising the real cookie path, which is the thing that broke in production and that c-22's sibling work (`test_auth_cookies.py`) now pins.
- **Function-scoped client fixture.** Rejected on its own: it fixes cross-test leakage but not the two-users-in-one-test case, which is the majority of the failures.

### D2: A distinct `anon_client` fixture for 401 assertions

Unauthenticated tests receive a client that has never logged in, rather than reusing a shared one and trusting it to be clean.

*Alternative considered:* calling `client.cookies.clear()` inside each 401 test. Rejected for the same reason as D1 — it is a convention, not a mechanism, and conventions are what failed here.

### D3: The guard test documents the failure mode, it does not merely forbid it

A single test issues a request with an explicit `Cookie` header for user A while the jar holds user B, and asserts the resulting identity is not reliably A. It carries a comment explaining *why* the pattern is unsafe.

*Alternative considered:* a lint rule or grep-based check banning `"Cookie":` in tests. Rejected as the primary mechanism: it enforces a spelling, not a behavior, and would not have caught the jar-leak variant in the 401 tests. Cheap enough to add later as a belt-and-suspenders measure.

### D4: Prove each migrated isolation test can fail before trusting it

The migration's whole point is that these tests were green while asserting nothing. Re-greening them proves nothing by itself. Once migrated, ownership enforcement is temporarily disabled in the service layer and the suite MUST go red; then it is restored. This is a deliberate mutation check, run once, with the mutation reverted immediately — the same technique that validated the cookie regression tests in the sibling work.

*Alternative considered:* trusting a green run. Rejected — that is precisely the trap this change exists to undo.

### D5: Migrate file by file, verifying each in isolation and in the full suite

Order: `test_cloudinary_preset_comprobante.py` (6 tests, smallest, exercises the 401/jar-leak mode) → `test_pago_integration.py` → `test_factura_integration.py` → `test_ia_vision_integration.py`. Each file must pass alone *and* in the full suite before moving on, so a regression is attributable to one file.

### D6: Helper placement in `tests/conftest.py`

All four suites need it and `conftest.py` is already the shared fixture home. A dedicated `tests/helpers/` module would add an import path for a helper with exactly one consumer group. If it grows past the client factory, it can be extracted later.

## Risks / Trade-offs

- **A careless rewrite weakens assertions instead of strengthening them** → D4's mutation check is the control: if disabling the ownership check does not turn the suite red, the migration failed regardless of how green it looks.
- **109 `headers=` call sites is a large mechanical diff, easy to hide a semantic slip in** → migrate one file at a time (D5), keep non-auth assertions byte-identical, and review the diff for any assertion whose expected value changed.
- **Per-user clients mean more logins, and login runs argon2** → each `TestClient` is cheap, but registration/login cost is real. Mitigation: reuse a user's client across the test rather than re-authenticating per request; only create as many users as the scenario needs. If suite time regresses noticeably, revisit fixture scope.
- **Rate limiting is per-IP and the suite already works around it with a unique `X-Forwarded-For` per login** → the factory must preserve that behavior, or parallel user creation will start tripping the limiter.
- **`test_pollution_fix.py` is expected to go green untouched; if it does not**, there is a second, independent pollution source that this change has not addressed → treat that as a separate finding and report it rather than patching the meta-test.

## Migration Plan

1. Add the client factory and `anon_client` fixture to `tests/conftest.py`.
2. Add the guard test (D3).
3. Migrate the four files in D5 order; after each, run the file alone and then the full suite.
4. Run the D4 mutation check across the migrated isolation tests; confirm red, revert, confirm green.
5. Confirm `test_pollution_fix.py` passes without edits.

Rollback is trivial: the change is additive in `conftest.py` and mechanical in the test files; reverting the commit restores the previous suite exactly.

## Open Questions

- Should the trailing-slash `307` be filed as its own change now, or left documented here until it causes a concrete problem? It is invisible to the frontend (axios uses the non-redirecting paths) but it is a live foot-gun for any HTTP client that drops headers across redirects.
