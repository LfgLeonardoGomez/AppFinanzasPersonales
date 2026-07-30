## Context

c-17 fixed the inter-file test pollution caused by `tests/test_deps.py` reloading `app.core.deps` (`del sys.modules["app.core.deps"]` + re-import), which creates a fresh `get_db` function object. Fixtures that key their `app.dependency_overrides[get_db] = ...` off `app.core.deps.get_db` silently stop matching once that reload happens earlier in the run, so the request falls through to the real (lazy) engine — which is bound to whatever `DATABASE_URL` was last set. c-17's fix was correct in mechanism (import `get_db` from a router module, since router modules keep their original reference) but its regression guard (`tests/test_pollution_fix.py`) is a hardcoded list of `TestXFixtureContract` classes, one per known polluting file at the time. Three files added after c-17 landed (`test_auth_integration.py`, `test_cloudinary_preset_comprobante.py`, `test_cuenta_corriente_integration.py`) reintroduced the exact same `from app.core.deps import get_db` pattern and nothing caught it, because the guard is enumerative, not structural.

Independently, three alembic migration test modules (`test_alembic_migration.py`, `test_alembic_migration_0004.py`, `test_alembic_migration_0005.py`) set `os.environ["DATABASE_URL"]` to their own disposable testcontainer DSN inside a module-scoped fixture and never restore it. Once that container is torn down at the end of the module, the env var still points at a dead DSN. This is the second half of the bomb: it's what makes an override miss fatal (`connection refused`) instead of silently reusing whatever `DATABASE_URL` happened to be live before.

Reproduced today: `pytest tests/test_alembic_migration_0004.py tests/test_deps.py tests/test_cloudinary_preset_comprobante.py -q` → `15 passed, 5 errors`. The full suite currently passes only because pytest's default alphabetical collection order happens to put `test_cloudinary_preset_comprobante.py` before `test_deps.py`.

## Goals / Non-Goals

**Goals:**
- Fix all three confirmed `get_db`-from-`app.core.deps` violations.
- Fix all three confirmed `DATABASE_URL`-not-restored violations, using the proven `test_alembic_migration_0003.py` pattern.
- Add a structural (AST-based) sweep that enforces the c-17 contract across the whole `tests/` tree going forward, generically — not per-file.
- Prove the sweep is a real detector (it must fail red against a known violation before the fixes land, and pass green after).
- Decide, and record the decision, on whether the pre-existing hardcoded per-file contract tests in `tests/test_pollution_fix.py` still earn their keep now that the sweep supersedes their coverage.

**Non-Goals:**
- No production code changes (`app/` stays untouched — confirmed via `git status` at the end).
- No new test dependencies (no `pytest-randomly`, no AST-linting libraries beyond stdlib `ast`).
- No change to any test's assertions or behavior — only the `get_db` import source and the `DATABASE_URL` restore contract.
- No fix to `test_cuenta_corriente_integration.py` beyond its single import line (owned by a concurrent change).

## Decisions

**D-1: Generic sweep via stdlib `ast`, not `re`/string matching.**
The existing hardcoded tests already use `ast.walk` (`_imported_get_db_from` in `test_pollution_fix.py`) to be robust against multi-line imports and formatting. The sweep generalizes the same technique: instead of hand-picking `(file, function_name)` pairs, it (a) parses every `tests/test_*.py` file, (b) walks all `ast.Subscript` nodes matching the shape `<expr>.dependency_overrides[<name>] = <value>` inside an `ast.Assign`, (c) finds the enclosing `FunctionDef`/`AsyncFunctionDef` for each match, and (d) requires an `ImportFrom` for `<name>` in that function's body (or accessible in the function's closure — see D-3) whose module starts with `app.routers.`. This is strictly more general than string-grepping `dependency_overrides[get_db]` because it will also catch a future `get_current_user` or rate-limiter override, per the task's explicit requirement ("write the sweep so it catches ANY overridden dependency").

Alternative considered: keep extending the hardcoded per-file list. Rejected — that is the literal failure mode being fixed; a generic detector is required by the task.

**D-2: Exemption list is explicit and minimal.**
`tests/test_deps.py` is the one file that legitimately imports `get_db` from `app.core.deps`, because it is testing `app.core.deps` itself (including the `del sys.modules` reload). The sweep hardcodes a tiny `EXEMPT_FILES = {"test_deps.py"}` constant with a comment explaining why, rather than trying to infer "is this file testing app.core.deps" structurally — that inference would be more fragile than a one-line, well-commented exemption.

**D-3: Overridden-dependency detection walks the whole file, not just the immediate function.**
`app.dependency_overrides[X] = fn` and `from app.routers.Y import X` are usually in the same fixture function (confirmed in every current fixture — `int_client`, `cc_client`, `cloud_app`, `pago_app`, `fac_app`, `ia_client`, `auth_client`). The sweep's first pass looks for the import inside the enclosing function; if not found there, D-3 also checks module-level imports (since a violation could in principle import at module scope). This keeps the sweep from producing false positives if a future fixture factors the import out of the function body, while still catching the real violation shape (import and override in the same function, wrong module).

**D-4: `DATABASE_URL` restore reuses the exact `test_alembic_migration_0003.py` pattern.**
Snapshot `os.environ.get("DATABASE_URL")` before entering the `PostgresContainer` context manager, restore it after `engine.dispose()` (pop if it was originally unset, otherwise set it back). This is a proven pattern already reviewed and merged in c-16; no new design needed, just applying it consistently to the three files that were missed.

**D-5: One regression test per fixed alembic file, standing outside the fixture's scope.**
Mirrors `test_alembic_migration_0003.py::test_database_url_restored_after_module`: it does not depend on the module-scoped fixture, snapshots `DATABASE_URL` at its own start, asserts the value is unchanged by end-of-module. Because pytest evaluates module-level code and fixture setup/teardown before running each test function, and the regression test has no dependency on the leaking fixture, it correctly observes "did a sibling module's fixture in this same file leave `DATABASE_URL` dirty."

**D-6: Keep the hardcoded per-file contract tests in `test_pollution_fix.py`, additive not replacing.**
Decision: retain them. Rationale: they carry tailored failure messages naming the exact router module each file should import from (e.g. "`app.routers.pagos`"), which is more actionable for a developer reading a failure than the sweep's generic message. The sweep is the safety net that catches files nobody remembered to special-case; the hardcoded tests remain useful documentation-as-tests for the files already known. This is not redundant coverage — it is defense in depth, and the marginal cost (a handful of fast AST-based assertions) is negligible. The sweep is what actually closes the hole; the hardcoded tests are kept for their diagnostic value, not as the primary guard.

## Risks / Trade-offs

- [Risk] The sweep's AST walk could produce a false positive on a legitimate pattern not yet seen (e.g. an override target imported via `import app.routers.pagos as r; r.get_db`). → Mitigation: today's codebase has exactly one override target (`get_db`) across every fixture and every fixture imports it via `from X import get_db`; the sweep is scoped to that exact shape. If a new pattern appears, the sweep will need a follow-up, but it will fail *loud* (a new violation not caught, not a false failure blocking legitimate work) since a missed pattern degrades to "not checked," not "checked and wrong."
- [Risk] Editing `test_cuenta_corriente_integration.py` while another agent is mid-edit on the same file. → Mitigation: touch only the single import line (line 61), re-read the file immediately before editing to get the latest state, and do not touch anything else in the file.
- [Trade-off] Keeping both the generic sweep and the hardcoded tests adds a small amount of duplicate coverage. → Accepted per D-6: the diagnostic value of the hardcoded messages outweighs the marginal test-runtime cost.

## Migration Plan

1. Write the generic sweep test first; confirm it fails red (detects the three known violations) before touching any fixture.
2. Fix the three `get_db` imports; confirm the sweep goes green.
3. Fix the three alembic `DATABASE_URL` restores + add their regression tests; confirm each passes.
4. Run the exact adversarial ordering command from the task and the full suite; both must be green.
5. No rollback complexity — this is a test-only change; reverting is a plain `git revert`.

## Open Questions

None — all decisions above are locked for this change.
