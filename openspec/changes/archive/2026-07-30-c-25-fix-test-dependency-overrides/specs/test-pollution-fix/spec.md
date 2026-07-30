## ADDED Requirements

### Requirement: Any dependency-override target is generically enforced to import from a router module

The system SHALL provide a structural (AST-based) sweep test, distinct from the c-17 hardcoded per-file contract tests, that scans every `tests/test_*.py` file for any assignment of the shape `<expr>.dependency_overrides[<dependency_name>] = <value>`, locates the enclosing function, and asserts that `<dependency_name>` is imported in that function (or at module scope) from a module whose path starts with `app.routers.` — never from `app.core.deps`. The sweep applies to any overridden dependency, not only `get_db`. Files or functions listed in an explicit, minimal exemption list (currently only `tests/test_deps.py`, which intentionally tests `app.core.deps` including its `sys.modules` reload) are excluded, with the reason for the exemption documented in the sweep's source.

#### Scenario: the sweep catches a violation not covered by any hardcoded per-file test

- **WHEN** a test file other than the ones enumerated in `tests/test_pollution_fix.py` sets `app.dependency_overrides[get_db] = ...` after `from app.core.deps import get_db`
- **THEN** the generic sweep test fails, identifying the offending file, the offending function, and the wrong import module — independent of whether that file was ever added to the hardcoded per-file contract list

#### Scenario: the sweep passes for a compliant override

- **WHEN** a test file sets `app.dependency_overrides[get_db] = ...` after `from app.routers.<name> import get_db`
- **THEN** the generic sweep test passes for that file

#### Scenario: the exempted file is not flagged

- **WHEN** the sweep scans `tests/test_deps.py`
- **THEN** the sweep does not fail on that file's `from app.core.deps import get_db` imports, because the file is in the sweep's explicit exemption list

#### Scenario: the sweep generalizes beyond `get_db`

- **WHEN** a future test file sets `app.dependency_overrides[get_current_user] = ...` (or any other dependency) importing the target from `app.core.deps` instead of a router module
- **THEN** the generic sweep test fails on that violation too, without requiring any change to the sweep itself

### Requirement: Every migration test fixture that mutates DATABASE_URL restores it on teardown

The system SHALL ensure that every module-scoped pytest fixture in `tests/test_alembic_migration*.py` that sets `os.environ["DATABASE_URL"]` to a disposable testcontainer DSN restores the pre-fixture value once its container is torn down (popping the key if it was originally unset, setting it back otherwise), following the pattern already proven in `tests/test_alembic_migration_0003.py`. This applies to `tests/test_alembic_migration.py`, `tests/test_alembic_migration_0004.py`, and `tests/test_alembic_migration_0005.py`, in addition to the already-compliant `test_alembic_migration_0003.py`.

#### Scenario: DATABASE_URL is restored after test_alembic_migration.py's module finishes

- **WHEN** all tests in `tests/test_alembic_migration.py` have run and the module-scoped `migration_engine` fixture has torn down
- **THEN** `os.environ.get("DATABASE_URL")` equals the value captured before the fixture's `PostgresContainer` was entered

#### Scenario: DATABASE_URL is restored after test_alembic_migration_0004.py's module finishes

- **WHEN** all tests in `tests/test_alembic_migration_0004.py` have run and the module-scoped `migration_engine_0004` fixture has torn down
- **THEN** `os.environ.get("DATABASE_URL")` equals the value captured before the fixture's `PostgresContainer` was entered

#### Scenario: DATABASE_URL is restored after test_alembic_migration_0005.py's module finishes

- **WHEN** all tests in `tests/test_alembic_migration_0005.py` have run and the module-scoped `migration_engine_0005` fixture has torn down
- **THEN** `os.environ.get("DATABASE_URL")` equals the value captured before the fixture's `PostgresContainer` was entered

#### Scenario: an adversarial collection order no longer detonates the suite

- **WHEN** `pytest tests/test_alembic_migration_0004.py tests/test_deps.py tests/test_cloudinary_preset_comprobante.py -q` is run from `facturas-proveedores-api/`
- **THEN** all tests pass (`0 failed`, `0 errors`); no test in that run fails with `psycopg2.OperationalError: connection refused`
