# fix-suite-and-specs Specification

> Umbrella housekeeping capability that resolves three pre-existing issues in a single change: (A) backend test pollution from the cached `Settings` singleton plus 2 pre-existing alembic 0003 fixture teardown failures; (B) 2 spec section-header normalizations from `## ADDED Requirements` to `## Requirements` (the established-spec convention; the `## ADDED Requirements` marker is reserved for active changes); (C) 7 `## Purpose: TBD` placeholders filled with reconstructed prose. No new business behavior, no schema migrations, no frontend changes, no dependency updates. The MVP is already production-ready from C-13 onward; this change cleans up CI noise and catalog hygiene.

## ADDED Requirements

### Requirement: `settings` is a read-through proxy that always reflects the current `os.environ`

The system SHALL expose `settings` from `app/core/config.py` as a module-level singleton object that, on every attribute access, constructs a fresh `Settings()` instance (which reads `os.environ` at construction time via pydantic-settings). The `get_settings()` function SHALL exist for explicit callers and SHALL NOT be decorated with `@lru_cache` (or any other cache). After this change, mutating `os.environ["X"]` between two `settings.X` reads SHALL yield the new value on the second read, with no fixture-side cache invalidation required.

#### Scenario: mutating DATABASE_URL between two reads is observed by the second read

- **WHEN** a test sets `os.environ["DATABASE_URL"] = "postgresql+psycopg2://first"`, reads `settings.DATABASE_URL`, then sets `os.environ["DATABASE_URL"] = "postgresql+psycopg2://second"` and reads `settings.DATABASE_URL` again
- **THEN** the first read returns `"postgresql+psycopg2://first"` and the second read returns `"postgresql+psycopg2://second"`, with no `cache_clear()` or `importlib.reload` between the two reads

#### Scenario: `get_settings()` is no longer cached

- **WHEN** the source of `app/core/config.py` is inspected
- **THEN** the line `def get_settings():` has no `@lru_cache` decorator on it (and no `functools.cache` / `functools.lru_cache` import is used by `get_settings`)

#### Scenario: existing call sites of `settings.X` keep working

- **WHEN** the test suite is run
- **THEN** every existing call site (`settings.DATABASE_URL`, `settings.CLOUDINARY_URL`, `settings.SECRET_KEY`, `settings.ACCESS_TOKEN_TTL_MIN`, `settings.VISION_PROVIDER`, `settings.FRONTEND_ORIGIN`, `settings.COOKIE_DOMAIN`) resolves to the current env value without code changes at the call site

### Requirement: SQLAlchemy engine construction in `app/core/deps.py` is lazy (defensive)

The system SHALL construct the SQLAlchemy engine in `app/core/deps.py` on first use, not at module-import time. After this change, importing `app.core.deps` SHALL NOT call `create_engine(...)`; the engine SHALL be built lazily by a `_get_engine()` function (or equivalent) and cached for the process lifetime. This is a belt-and-suspenders measure layered on top of the read-through settings proxy so that future import-time code paths cannot re-introduce the cached-`DATABASE_URL` bug.

#### Scenario: importing `app.core.deps` does not call `create_engine`

- **WHEN** a test does `import app.core.deps` and inspects the module before any request is served
- **THEN** no `create_engine` call has been issued (the module-level `_engine` reference is `None` or unset, and the engine is built on first `_get_engine()` call)

#### Scenario: the engine is still built and reachable at request time

- **WHEN** a request is served that needs a DB connection
- **THEN** `_get_engine()` returns a working `Engine` bound to the current `settings.DATABASE_URL`, and the rest of the test suite (which depends on the engine being available) continues to pass

### Requirement: `tests/conftest.py` no longer carries the `cache_clear()` hack

The system SHALL remove the `get_settings.cache_clear()` call from the `client` fixture in `tests/conftest.py` (lines 103-105 of the pre-change file). After the removal, importing `app.main` inside the `client` fixture MUST NOT need a cache invalidation step because `get_settings()` is no longer cached. The `client` fixture SHALL keep producing a working `TestClient`.

#### Scenario: the `cache_clear()` line is gone

- **WHEN** `tests/conftest.py` is inspected
- **THEN** the substring `get_settings.cache_clear` does not appear in the file (or any equivalent cache-invalidation call against `get_settings`)

#### Scenario: the test client still works without the cache invalidation

- **WHEN** the `client` fixture is used to serve a request (e.g. `GET /api/health`)
- **THEN** the response is 200 and the suite that depends on `client` continues to pass with no regression

#### Scenario: a regression test locks in the proxy behavior

- **WHEN** `tests/test_config.py` is inspected
- **THEN** it contains a new test (e.g. `test_settings_proxy_reads_live_env`) that mutates an env var between two `settings.X` reads and asserts the second read sees the new value — this test would FAIL if a future PR re-introduces `@lru_cache` on `get_settings()`

### Requirement: `tests/test_alembic_migration_0003.py` targets specific migration revisions and restores `DATABASE_URL` on teardown

The system SHALL make the alembic 0003 test module deterministic about which migration it tests and free of env teardown leaks. Two changes are applied together:

1. **Primary fix — rewrite the 2 failing tests to target specific migration revision IDs instead of `head` and `-1`.** The chain has advanced from 0003 (when the file was written) to 0005 (current head). The tests now use `_run_alembic("upgrade", "0003")`, `_run_alembic("downgrade", "0002")`, and `_run_alembic("upgrade", "0003")` to isolate migration 0003's behavior regardless of future chain growth. This makes the 2 previously-failing tests pass.
2. **Belt-and-suspenders — restore `os.environ["DATABASE_URL"]` on teardown.** The module-scope `migration_engine_0003` fixture snapshots the original DSN, mutates the env to the module container's DSN, and restores the original (or pops it if it was unset) on teardown. A direct regression test asserts the env is restored after the module finishes.

#### Scenario: the 2 pre-existing alembic 0003 failures are gone

- **WHEN** `pytest tests/test_alembic_migration_0003.py -q` is run in isolation, and then again as part of the full suite
- **THEN** all 5 tests in the module pass (`test_upgrade_chains_to_0003`, `test_index_on_usuario_nombre_lower_exists`, `test_no_saldo_or_estado_column_after_migration`, `test_downgrade_drops_index`, `test_re_upgrade_restores_index`); the test names are preserved (no rename, no deletion) and the assertions still verify the index behavior and the chain head

#### Scenario: the tests target specific revisions, not the current head

- **WHEN** `tests/test_alembic_migration_0003.py` is inspected
- **THEN** every `_run_alembic(...)` call in the file uses an explicit revision ID (`"0003"` or `"0002"` or `"base"`) rather than the chain-relative keywords `"head"` or `"-1"`; this makes the tests immune to future chain growth (0006, 0007, ...)

#### Scenario: `DATABASE_URL` is restored after the module finishes

- **WHEN** the `migration_engine_0003` fixture enters and yields
- **THEN** on teardown, `os.environ["DATABASE_URL"]` is restored to the value it had before the fixture entered (or removed if it was unset); a direct regression test (e.g. `test_database_url_restored_on_teardown`) asserts this contract

#### Scenario: downstream tests are not poisoned by the module's env mutation

- **WHEN** `pytest tests/ -q` is run (full suite, no `--deselect`)
- **THEN** no test that runs after `test_alembic_migration_0003.py` fails because of a stale `DATABASE_URL`; the total failure count is `0` (down from `2` for this module, plus any import-time pollution failures resolved by D-1)

### Requirement: Two established spec section headers are normalized from `## ADDED Requirements` to `## Requirements`

The system SHALL rename the section header in two established spec files to reflect that their content is no longer being "added" but is now the established specification:

- `openspec/specs/auth-frontend/spec.md`: `## ADDED Requirements` → `## Requirements`
- `openspec/specs/facturas-frontend/spec.md`: `## ADDED Requirements` → `## Requirements`

The `## ADDED Requirements` header is the convention OpenSpec uses inside an active change to mark requirements that the change is adding. Once a change is archived, the spec's requirement section reverts to the standard `## Requirements` header. Two established specs (`auth-frontend`, `facturas-frontend`) have the `## ADDED Requirements` header in error after their originating changes were archived — the spec body is the established spec, not a delta. The rename is a one-line edit per file and preserves the section body verbatim.

The archived change directories under `openspec/changes/archive/` SHALL NOT be touched: the `## ADDED Requirements` header inside `openspec/changes/archive/<change>/specs/<capability>/spec.md` is correct as-is, because at the time the change was active, those requirements WERE being added.

#### Scenario: `auth-frontend/spec.md` carries `## Requirements` (not `## ADDED Requirements`)

- **WHEN** `openspec/specs/auth-frontend/spec.md` is inspected
- **THEN** the section header reads `## Requirements` (the established spec convention), not `## ADDED Requirements`; the body under the header is byte-identical to the pre-change state

#### Scenario: `facturas-frontend/spec.md` carries `## Requirements` (not `## ADDED Requirements`)

- **WHEN** `openspec/specs/facturas-frontend/spec.md` is inspected
- **THEN** the section header reads `## Requirements` (the established spec convention), not `## ADDED Requirements`; the body under the header is byte-identical to the pre-change state

#### Scenario: no other spec is affected

- **WHEN** `grep -l "ADDED Requirements" openspec/specs/*/spec.md` is run after the rename
- **THEN** the only match is `openspec/changes/c-16-fix-suite-and-specs/specs/fix-suite-and-specs/spec.md` (this change's own spec, which legitimately uses `## ADDED Requirements` because c-16 is adding requirements)

#### Scenario: archives are untouched

- **WHEN** `git diff --stat openspec/changes/archive/` is run
- **THEN** the output is empty; no archived change's `specs/<capability>/spec.md` is modified (its `## ADDED Requirements` header is correct as-is for the historical change it documents)

### Requirement: Seven `## Purpose: TBD` placeholders are filled with reconstructed prose

The system SHALL replace each `## Purpose\n\nTBD - created by archiving change c-XX. Update Purpose after archive.` paragraph in the seven specs listed below with a real `## Purpose` paragraph reconstructed from the originating archived change's `proposal.md` (Why + Scope) and `design.md` (Context). The replacement SHALL follow the style of existing real Purposes (`core-data-models`, `cuenta-corriente-backend`, `auth-backend`, `auth-frontend`, `proveedores-frontend`): English-led, 3-6 sentences, no bullet lists inside the Purpose paragraph itself, with the cross-reference to the originating change ID preserved as a discovery aid.

The seven specs to fill:

1. `openspec/specs/pagos-frontend/spec.md` (origin: `archive/2026-06-27-c-11-pagos-frontend/`)
2. `openspec/specs/cuenta-corriente-frontend/spec.md` (origin: `archive/2026-06-27-c-13-cuenta-corriente-frontend/`)
3. `openspec/specs/ia-vision-backend/spec.md` (origin: `archive/2026-06-27-c-14-ia-vision-backend/`)
4. `openspec/specs/pagos-backend/spec.md` (origin: `archive/2026-06-27-c-10-pagos-backend/`)
5. `openspec/specs/perfil-usuario-api/spec.md` (origin: `archive/2026-06-25-c-05-perfil-usuario/`)
6. `openspec/specs/perfil-usuario-frontend/spec.md` (origin: `archive/2026-06-25-c-05-perfil-usuario/`)
7. `openspec/specs/project-foundation/spec.md` (origin: `archive/2026-06-19-c-01-foundation-setup/`)

`openspec/specs/cuenta-corriente-backend/spec.md` already has a real Purpose and SHALL NOT be modified.

#### Scenario: `pagos-frontend/spec.md` has a real Purpose

- **WHEN** `openspec/specs/pagos-frontend/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD - created by archiving change c-11-pagos-frontend. Update Purpose after archive.` and instead contains a 3-6 sentence English-led paragraph that references C-11 and describes the supplier-scoped payments UI, the `RN-PAG-01` invariant (no `factura_id`), and the dependency on the `pagos-backend` HTTP contract

#### Scenario: `cuenta-corriente-frontend/spec.md` has a real Purpose

- **WHEN** `openspec/specs/cuenta-corriente-frontend/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD` and instead contains a paragraph describing the read-only cuenta-corriente PWA view, the on-demand `{ saldo, facturas_con_estado, historial }` triple from C-12, the `RN-SALDO` / `RN-FIFO` / `RN-HIST` render-only invariants (no client-side recomputation), and the cross-feature TanStack Query cache invalidation

#### Scenario: `ia-vision-backend/spec.md` has a real Purpose

- **WHEN** `openspec/specs/ia-vision-backend/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD` and instead contains a paragraph describing the `VisionExtractor` abstraction, the `Claude` and `OpenAI` implementations, the two additive endpoints (`POST /api/facturas/extraer-ia`, `POST /api/pagos/extraer-ia`), and the `RN-IA-01` through `RN-IA-06` invariants

#### Scenario: `pagos-backend/spec.md` has a real Purpose

- **WHEN** `openspec/specs/pagos-backend/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD` and instead contains a paragraph describing the `Pago` CRUD HTTP API, the supplier-scoped payment pool that feeds the FIFO algorithm, and the `RN-PAG-01` through `RN-PAG-05` invariants

#### Scenario: `perfil-usuario-api/spec.md` has a real Purpose

- **WHEN** `openspec/specs/perfil-usuario-api/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD` and instead contains a paragraph describing the `PATCH /api/me` and `POST /api/me/avatar` profile endpoints, the Cloudinary signed-preset upload flow, and the `tema_preferido` / `telefono` / `nombre_negocio` update surface

#### Scenario: `perfil-usuario-frontend/spec.md` has a real Purpose

- **WHEN** `openspec/specs/perfil-usuario-frontend/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD` and instead contains a paragraph describing the editable profile page, the light/dark theme switch persisted via `PATCH /api/me`, and the `RequireAuth` route guard

#### Scenario: `project-foundation/spec.md` has a real Purpose

- **WHEN** `openspec/specs/project-foundation/spec.md` is inspected
- **THEN** the `## Purpose` section is no longer `TBD` and instead contains a paragraph describing the C-01 scaffolding: the two repos (`facturas-proveedores-api`, `facturas-proveedores-web`), the layered backend structure (`app/core|models|schemas|repositories|services|routers`), the PWA feature-based frontend structure, the testcontainers-based test harness, the Alembic initialization, and the Docker Compose dev environment

#### Scenario: `cuenta-corriente-backend/spec.md` is byte-identical to its pre-change state

- **WHEN** `openspec/specs/cuenta-corriente-backend/spec.md` is inspected
- **THEN** the file is unchanged from its pre-change content (it already has a real Purpose and is not part of the 7 fills)

#### Scenario: no `TBD` substring remains in any spec

- **WHEN** `grep -r "TBD" openspec/specs/` is run
- **THEN** the output is empty (no spec under `openspec/specs/` carries a `TBD` placeholder)
