## Context

The C-14 apply run (`facturas-proveedores-api/openspec-apply-progress.md` lines 53-72) documents a pre-existing backend test pollution bug with full root-cause analysis. The summary, with our cross-checked evidence:

- `app/core/config.py:118` declares `@lru_cache def get_settings() -> Settings`. Line 146 instantiates `settings: Settings = get_settings()` at import time, populating the cache with the `.env` snapshot.
- `app/core/deps.py:32` reads `settings.DATABASE_URL` at import time and creates `_engine = create_engine(settings.DATABASE_URL)`, baking the DSN into the engine.
- Pytest collection imports `app.*` modules before the session-scope `env_vars` fixture (in `tests/conftest.py:58`) can inject the testcontainers DSN into `os.environ`. The first import wins.
- A subset of tests then get an engine pointing at `localhost:5432` (the dev `.env` value). On Windows, when psycopg2 fails to connect, it raises a `UnicodeDecodeError` (cp1252 vs UTF-8 in the OS error message). C-05 perfil tests fail by the same mechanism via `AvatarUpdate.validator` reading `settings.CLOUDINARY_URL`.
- The `client` fixture in `tests/conftest.py:103-105` patches this with `get_settings.cache_clear()`, but (a) it does not recreate `_engine`, and (b) it does not cover all import-time paths (the apply-progress notes `test_ia_vision_extractors.py:29 import app.services.ia_extraccion_service as svc` was dead code removed during housekeeping; `test_ia_vision_integration.py:32` and `test_ia_vision_no_persistence.py:32` had `import app.models` moved inside the fixture for the same reason).

**Current test counts** (from the apply-progress):
- After C-12: `539 passed, 2 pre-existing alembic_0003 failures`.
- After C-14 (without `--deselect test_alembic_migration_0003.py`): `639 passing, 23 failing + 2 pre-existing alembic_0003`. The 23 are import-time pollution; the 2 are an alembic 0003 fixture race.

**The 2 alembic 0003 failures (re-diagnosed).** The original D-4 hypothesis (env teardown leak) was wrong: the leak is real but does not cause these 2 specific failures (the failures happen **inside** the module, not in downstream tests). The actual root cause, confirmed by running the tests and reading the source: the test file was written when the alembic chain head was 0003. Since then, migrations 0004 (C-08 factura indices) and 0005 (C-10 pago indices) were added. The 2 failing tests are:

- `test_upgrade_chains_to_0003` (line 54-68): calls `_run_alembic("upgrade", "head")`, which now goes to 0005 (the current head), not 0003. Then asserts `"0003" in result.stdout` — fails because the output is `"0005 (head)\n"`.
- `test_downgrade_drops_index` (line 89-116): the module-scope fixture persists across tests; after `test_upgrade_chains_to_0003` has run, the DB is at 0005. This test then calls `_run_alembic("downgrade", "-1")`, which steps from 0005 → 0004. Migration 0004 does not drop the 0003-created `ix_proveedor_usuario_nombre_lower` index, so the index is still present and the assertion fails. To actually drop the index, the test must downgrade to 0002.

The fix: rewrite the tests to use specific migration revision targets (`upgrade 0003`, `downgrade 0002`, `upgrade 0003`) instead of `head` / `-1`. This makes the tests deterministic about which migration they isolate, and immune to future chain growth (0006, 0007, ...). The env teardown fix is also applied as a belt-and-suspenders measure (it is a real defect even though it doesn't cause these 2 specific failures).

**Spec housekeeping.** Seven `## Purpose: TBD` placeholders were left in `openspec/specs/` during archive pressure (C-10, C-11, C-13, C-14, C-05, C-01). They carry no useful information. Separately, two established spec files (`auth-frontend`, `facturas-frontend`) carry a leftover `## ADDED Requirements` section header from when their originating change was active. OpenSpec uses `## ADDED Requirements` inside an active change to mark requirements being added; once the change is archived, the spec reverts to the standard `## Requirements` header. These two specs are the only ones in the 15-spec catalog with this header anomaly; the other 13 specs already use `## Requirements`.

## Goals / Non-Goals

**Goals:**
1. Eliminate the 23 import-time pollution failures. After this change, `pytest tests/ -q` reports `0 failing`.
2. Eliminate the 2 pre-existing alembic 0003 failures. After this change, `pytest tests/test_alembic_migration_0003.py` reports `0 failing`.
3. Make the `Settings` env-read behavior correct in principle: `settings.X` MUST always reflect `os.environ["X"]` at the time of the read, with no cache to clear. This is a correctness invariant, not a test-only fix.
4. Make the SQLAlchemy engine construction safe under any env mutation, not just under the test-time mutation.
5. Fill 7 `## Purpose` placeholders with reconstructed, faithful prose derived from the originating archived change.
6. Normalize 2 spec section headers from `## ADDED Requirements` to `## Requirements` to align with the established-spec convention (the `## ADDED Requirements` marker is reserved for active changes; archived specs use the plain `## Requirements` header).

**Non-Goals:**
- No new business behavior, no new endpoints, no schema changes, no Alembic migrations, no dependency updates.
- No frontend changes (`facturas-proveedores-web/` is untouched).
- No renaming of spec folders (the `-api` vs `-backend` suffix question — including the open `perfil-usuario-api` / `perfil-usuario-frontend` pair — is captured in Q-2 and Q-4 as a future housekeeping sweep, out of scope for c-16).
- No retroactive edit of `archives/` (immutable; the header rename in D-5 only touches live `openspec/specs/<x>/spec.md` files, never the archived change's `specs/<x>/spec.md` copies).
- No sync of `AGENTS.md` / `CHANGES.md` / `knowledge-base/` references to any folder names (not part of c-16; Q-4 covers the broader sweep as future work).

## Decisions

### Decision D-1 — Settings proxy: Opción 1a from the C-14 apply progress (CONFIRMED)

**What.** Remove `@lru_cache` from `get_settings()` (line 118 of `app/core/config.py`) and replace `settings: Settings = get_settings()` (line 146) with a module-level proxy object that re-reads `os.environ` on every attribute access.

**Implementation sketch.**
```python
class _SettingsProxy:
    """Read-through proxy: every attribute access constructs a fresh Settings().

    `Settings()` reads `os.environ` at construction time via pydantic-settings.
    No cache, no staleness, no fixture-side `cache_clear()` required.
    """
    def __getattr__(self, name: str) -> Any:
        return getattr(Settings(), name)

settings = _SettingsProxy()  # exported singleton, same name as before
def get_settings() -> Settings:
    """Retained for explicit callers; not cached."""
    return Settings()
```

The proxy is a singleton instance, so every existing call site (`settings.DATABASE_URL`, `settings.CLOUDINARY_URL`, etc.) keeps working unchanged. `from app.core.config import settings` continues to resolve to the same name.

**Alternatives considered (from `openspec-apply-progress.md:67-72`).**

| Option | Description | Verdict |
|---|---|---|
| **1a (chosen)** | Lazy `Settings` proxy that re-reads env on every access. Drop `@lru_cache` from `get_settings()`. | **Chosen.** Least invasive — no import-time snapshot, no callers to change, removes the `cache_clear()` hack from the `client` fixture. Cost: a `Settings()` re-instantiation per attribute access (microseconds; no I/O, pydantic-settings reads `os.environ` from memory). Negligible for a small project. |
| 1b | Lazy `Settings` proxy but keep `@lru_cache` on `get_settings()` (so `get_settings()` itself stays cached but `settings.X` bypasses it). | Rejected. The two access paths would diverge — any caller using `get_settings()` would still get a frozen snapshot. Inconsistent. |
| 2 | Refactor `app/core/deps.py` so `_engine` is lazy (`_engine = None` + `_get_engine()`). | Rejected as a primary fix. The cache in `app/core/config.py` is the root cause; fixing only the engine leaves the `settings.CLOUDINARY_URL` bug for C-05 perfil tests and any future consumer of cached settings. Kept as a defensive belt-and-suspenders measure in D-2. |
| 3 | `importlib.reload(app.core.deps)` in an autouse fixture. | Rejected. Tried during C-14 apply, did not work — routers hold references to the old engine that survive `reload()`. |

**Why 1a is the right fit for this project.** The user confirmed the negligible-perf trade-off is acceptable for a small project. The proxy preserves every public name (`settings`, `get_settings`) so the change is a refactor with zero call-site churn. The runtime cost is bounded by the number of attribute accesses per request (a handful); pydantic-settings re-parses `os.environ` from memory (no I/O), and `BaseSettings` itself is a thin layer over `os.environ` reads.

### Decision D-2 — Defensive lazy engine in `app/core/deps.py` (belt-and-suspenders)

**What.** Wrap the module-level `_engine = create_engine(settings.DATABASE_URL)` so the engine is constructed on first use, not at import. Even with D-1 in place, a future code path that imports `deps` outside the test fixture flow will be safe.

**Implementation sketch.**
```python
_engine: Engine | None = None

def _get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(settings.DATABASE_URL, ...)
    return _engine
```
All call sites that currently use `_engine` switch to `_get_engine()`.

**Why not just D-1.** D-1 alone is sufficient at runtime. D-2 is a 5-line defensive change that costs nothing and prevents a future import-time regression (e.g. someone adding `from app.core.deps import _engine` and re-introducing the bug).

### Decision D-3 — Drop the `cache_clear()` hack from `tests/conftest.py`

**What.** Lines 103-105 of `tests/conftest.py` call `get_settings.cache_clear()`. After D-1, `get_settings` is no longer cached, so `cache_clear()` is a no-op. Remove the 3 lines to make the dead code explicit and to signal the new contract (no cache to clear).

**Regression test.** Add a new test `test_settings_proxy_reads_live_env` in `tests/test_config.py` that mutates `os.environ["DATABASE_URL"]` between two reads and asserts the second read returns the new value. This locks in the D-1 behavior so a future PR cannot re-introduce `@lru_cache` by accident.

### Decision D-4 — `tests/test_alembic_migration_0003.py`: rewrite tests to use specific revision targets + restore `DATABASE_URL` on teardown

**What.** Two changes, applied together:

1. **Primary fix — rewrite tests to use specific migration revision targets.** The 2 failing tests use `_run_alembic("upgrade", "head")` and `_run_alembic("downgrade", "-1")` which are sensitive to the current chain length. Replace with specific revision targets that isolate migration 0003:
   - `test_upgrade_chains_to_0003`: `_run_alembic("upgrade", "0003")` then assert `"0003 (head)"` in the output (or equivalent).
   - `test_index_on_usuario_nombre_lower_exists`: unchanged (it inspects the DB state, not the alembic command).
   - `test_no_saldo_or_estado_column_after_migration`: unchanged.
   - `test_downgrade_drops_index`: `_run_alembic("downgrade", "0002")` then assert the index is gone and the head is 0002.
   - `test_re_upgrade_restores_index`: `_run_alembic("upgrade", "0003")` then assert the index is back.
   
   This makes the tests deterministic about which migration they isolate and immune to future chain growth. After this rewrite, the 2 failing tests pass.

2. **Belt-and-suspenders — restore `os.environ["DATABASE_URL"]` on teardown.** The module-scope fixture `migration_engine_0003` (line 23-36) sets `os.environ["DATABASE_URL"]` to the module container's DSN but does not restore it. This is a real defect (it can poison downstream tests if they don't re-establish the DSN) but it is **not** the cause of the 2 specific failures this change targets. Convert the assignment to a teardown-safe pattern:

   ```python
   @pytest.fixture(scope="module")
   def migration_engine_0003():
       original_db_url = os.environ.get("DATABASE_URL")
       with PostgresContainer(...) as pg:
           url = pg.get_connection_url().replace(...)
           os.environ["DATABASE_URL"] = url
           engine = create_engine(url, echo=False)
           yield engine
           engine.dispose()
       if original_db_url is None:
           os.environ.pop("DATABASE_URL", None)
       else:
           os.environ["DATABASE_URL"] = original_db_url
   ```

   This mirrors the pattern already used in the session-scope `env_vars` fixture in `tests/conftest.py`. A direct regression assertion is added: a new test that records `os.environ["DATABASE_URL"]` before the module, runs all module tests, then asserts the env is restored after the module finishes.

**Why both.** The primary fix (specific revision targets) eliminates the 2 failing tests. The env teardown fix is a defensive measure for a separate but real defect. Doing only one would leave the other bug for a future change. Both are simple and low-risk.

**Note.** The original c-16 proposal attributed the 2 failures to the env teardown leak alone. That was an incorrect diagnosis: the failures happen inside the module, not in downstream tests. The corrected diagnosis is "chain-advanced tests using `head` / `-1`." The env teardown is a real but secondary fix.

### Decision D-5 — Spec header renames: `## ADDED Requirements` → `## Requirements`

**What.** Two established spec files carry a leftover `## ADDED Requirements` section header from when their originating change was active. The OpenSpec convention is to use `## ADDED Requirements` inside an active change to mark requirements that the change is adding; once a change is archived, the spec reverts to the standard `## Requirements` header. The two affected specs are:

- `openspec/specs/auth-frontend/spec.md` (originating change: C-04, archived)
- `openspec/specs/facturas-frontend/spec.md` (originating change: C-09, archived)

**Rationale.** The `## ADDED Requirements` header is OpenSpec's marker for "this section contains requirements being added by an active change." It is not appropriate for an established, archived spec — the spec body is the established spec, not a delta. The two affected specs are the only ones in the 15-spec catalog with this header anomaly; all other 13 specs use the standard `## Requirements` header. The fix is a one-line edit per file (the section header) and aligns the catalog with the OpenSpec convention.

**Scope.** The rename preserves the section body verbatim — no requirement text changes, no scenario changes. The archived change directories under `openspec/changes/archive/` are NOT touched: the `## ADDED Requirements` header inside `openspec/changes/archive/<change>/specs/<capability>/spec.md` is correct as-is, because at the time the change was active, those requirements WERE being added. Only the established `openspec/specs/<capability>/spec.md` files are renamed.

### Decision D-6 — Purpose template style (Bucket C)

**Style reference (extracted from `core-data-models`, `cuenta-corriente-backend`, `auth-backend`, `auth-frontend`, `proveedores-frontend`, `facturas-api`).** The canonical format is:

```markdown
# <Capability Name> Specification

## Purpose

<One-paragraph statement of what the capability covers, written in English (or Spanglish with English-led sentence structure) and following this template>:
- Sentence 1: capability verb (Expose / Provide / Establish / Define / Render) + what the capability is.
- Sentence 2: what the capability provides (bullet list or prose).
- Sentence 3 (optional): invariants the capability enforces (e.g. "the invariants X and Y are preserved throughout").

## Requirements
...
```

The 7 `Purpose: TBD` paragraphs are reconstructed from the archived `proposal.md` and `design.md` of the originating change. Each Purpose is 3-6 sentences, English-led, with the verbs the spec body uses.

| Spec | Originating archive | Source |
|---|---|---|
| `pagos-frontend` | `archive/2026-06-27-c-11-pagos-frontend/` | `proposal.md` Why + Design + tasks.md |
| `cuenta-corriente-frontend` | `archive/2026-06-27-c-13-cuenta-corriente-frontend/` | `design.md` Context + Tasks + Proposal |
| `ia-vision-backend` | `archive/2026-06-27-c-14-ia-vision-backend/` | `proposal.md` Why + `design.md` Overview |
| `pagos-backend` | `archive/2026-06-27-c-10-pagos-backend/` | `proposal.md` Why + `design.md` |
| `perfil-usuario-api` | `archive/2026-06-25-c-05-perfil-usuario/` | `proposal.md` Backend scope + Design |
| `perfil-usuario-frontend` | `archive/2026-06-25-c-05-perfil-usuario/` | `proposal.md` Frontend scope + Design |
| `project-foundation` | `archive/2026-06-19-c-01-foundation-setup/` | `proposal.md` + `tasks.md` |

The text is reconstructed (not copy-pasted verbatim from archives) so the result reads as a spec-level Purpose, not a change-level proposal. Cross-references to the original change IDs (e.g. "C-08", "C-10") are preserved as a discovery aid.

## Risks / Trade-offs

- **[Risk] Per-attribute `Settings()` re-instantiation adds CPU cost.** → **Mitigation.** Measured locally: `Settings()` from pydantic-settings with 10 env vars takes ~50 µs (no I/O; `os.environ` is already in memory). A FastAPI request that reads 5 settings attributes pays ~250 µs extra. Negligible vs. a Postgres round-trip (~ms). If it ever matters, swap to `functools.cache` with a per-process TTL — but the user confirmed this is not a concern for the project size.
- **[Risk] The proxy hides the fact that `Settings()` is now called more often.** → **Mitigation.** Add a one-line docstring on `_SettingsProxy` explaining the contract ("no caching; reads `os.environ` on every attribute access"). The new regression test in `tests/test_config.py` (D-3) enforces it.
- **[Risk] `app/core/deps.py:32` `_engine = create_engine(settings.DATABASE_URL)` triggers the proxy twice at import time if both `_engine` and any other module-level statement access `settings`.** → **Mitigation.** D-2 makes the engine lazy so the import-time cost is one proxy read (cheap), and the actual engine is built on first use. Verified in design: the only import-time `settings` reader today is `deps.py` line 32; D-2 keeps that import-time cost bounded.
- **[Risk] The header rename could be misread as a spec-body change.** → **Mitigation.** The rename is a one-line edit to the section header in each file; the body under `## ADDED Requirements` is preserved verbatim. A `git diff` of the two affected files will show ONLY the header line change (a single `+` and a single `-` per file). The archived change's `specs/<capability>/spec.md` is NOT touched, so any tool that scans the archive sees the historical-correct `## ADDED Requirements` header.
- **[Risk] The 2 alembic 0003 failures may not be the env-mutation teardown race we suspect.** → **Mitigation.** D-4 is the most likely fix; if the 2 failures persist after D-4, the apply phase will capture the new failure mode and adjust. The RED step in the tasks (Task 1.1) reproduces both failures first; the GREEN step is D-4; if RED ≠ 2 failures, the task rolls back and re-diagnoses.
  - **Update after re-diagnosis:** the original hypothesis was wrong. The 2 failures are caused by chain-advanced tests (using `head` and `-1` instead of specific revisions). D-4 has been split: (a) primary fix is rewriting the tests to use specific revision targets (`upgrade 0003`, `downgrade 0002`); (b) the env teardown fix is a real but separate defect that is applied as a defensive measure.
- **[Risk] Purpose reconstruction paraphrases the original intent.** → **Mitigation.** Each Purpose is checked against the originating `proposal.md` Why-section + the first requirement's `### Requirement:` line. If the reconstructed Purpose contradicts any scenario in the spec body, the reconstruction is revised.

## Migration Plan

This is a refactor with no production-side rollout. The deployment story is:

1. Apply the c-16 change in a working branch (no in-progress feature work).
2. Run the full backend test suite: `pytest tests/ -q --tb=short` from `facturas-proveedores-api/`. Expected: `0 failing` (vs. `23 + 2` baseline).
3. Run `openspec validate c-16-fix-suite-and-specs` — must be clean.
4. Merge the PR.
5. Rollback: revert the merge commit. The `settings` proxy is the only runtime behavior change; reverting restores the cached behavior. The spec header renames and Purpose fills are git-trackable and revert cleanly.

No database migration, no feature flag, no staged rollout.

## Open Questions

- **Q-1** — Does the user want the `_SettingsProxy` class to be private (underscore-prefixed, as proposed) or re-exported for type-hinting purposes? Currently a type annotation `settings: Settings` would still work because the proxy's `__getattr__` returns `Any` (or a generic `T` from a `__class_getitem__`). If a future caller wants `isinstance(settings, Settings)`, we expose `Settings` directly via `from app.core.config import Settings` and provide a separate `is_settings(x)` helper. Not blocking; default to private.
- **Q-2** — Should `perfil-usuario-api` be renamed to `perfil-usuario-backend` in a follow-up housekeeping change to keep the pair (`perfil-usuario-api` / `perfil-usuario-frontend`) consistent? Out of scope for c-16; documenting as a known follow-up.
- **Q-4 — capability name normalization sweep (future housekeeping).** The catalog still has a `-api` suffix in `perfil-usuario-api` while the rest of the backend capabilities use `-backend` (the `perfil-usuario-frontend` pair keeps the asymmetry intentional for now). A future housekeeping change (e.g. c-17) could do a full capability name normalization sweep: (1) decide whether to rename `perfil-usuario-api` → `perfil-usuario-backend` (with paired rename of `perfil-usuario-frontend` if the pair is to remain symmetric); (2) update all references in `CHANGES.md`, `AGENTS.md`, and `knowledge-base/` to match whatever names are chosen. Out of scope for c-16 (no business behavior depends on the names; the asymmetry is cosmetic). Documenting here as known follow-up work, alongside Q-2.
