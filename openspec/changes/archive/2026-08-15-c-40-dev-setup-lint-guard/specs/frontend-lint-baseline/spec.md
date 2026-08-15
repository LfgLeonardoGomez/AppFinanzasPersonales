## MODIFIED Requirements

### Requirement: An automated test asserts the lint exit code

A test SHALL exist in `facturas-proveedores-web/tests/` (or equivalent test directory) that executes `npm run lint` as a child process and asserts the exit code is `0`. The test SHALL run as part of `npm test` and SHALL fail the suite if the lint command fails. The test SHALL be skipped (not failed, not deleted) if `node_modules` is not installed in the test environment (e.g. CI cache miss), so the test does not produce false failures from missing dependencies rather than from real lint breakage.

**The requirement that the test "SHALL run as part of `npm test`" SHALL hold in the containerized dev environment, not only on a host checkout.** Merely existing in the repository does not satisfy it. The test file SHALL be present inside the `web` container and SHALL be collected by the container's test run, and the ESLint configuration the test's child process depends on SHALL be resolvable inside that container. Between C-20 and this change the test satisfied the requirement on a host checkout while being silently excluded from the container suite — it was collected in neither environment the project actually ran, and asserted nothing.

Because the test is written to skip when `node_modules` is absent, a skipped result SHALL NOT be treated as satisfying this requirement. Verification of this capability SHALL assert that the test **executed and passed**, distinguishing `passed` from `skipped` in the suite report.

#### Scenario: lint-passing code keeps the regression test green

- **WHEN** the codebase is in a state where `npm run lint` would exit 0
- **THEN** the regression-guard test passes

#### Scenario: lint-failing code fails the regression test

- **WHEN** a developer introduces a file with a known lint violation and runs `npm test`
- **THEN** the regression-guard test fails with a message indicating the lint command failed, and the test output includes the first lines of the lint output for debugging

#### Scenario: regression test is skipped when node_modules is absent

- **WHEN** the test runs in an environment where `facturas-proveedores-web/node_modules/` does not exist
- **THEN** the test is marked skipped (not failed) and a clear message indicates the skip reason

#### Scenario: the guard is collected and executed by the container suite

- **WHEN** the frontend suite is run inside the `web` container after `docker compose up -d`
- **THEN** `tests/frontend-lint.test.ts` appears among the collected test files and its assertion is reported as **passed**, not skipped, because `node_modules` is installed inside the container by the service's `npm ci`

#### Scenario: the guard actually fails the container suite on a real lint violation

- **WHEN** a deliberate lint violation (for example an unused variable that `@typescript-eslint/no-unused-vars` rejects) is introduced into a file under `facturas-proveedores-web/src/` and the suite is run inside the `web` container
- **THEN** the suite fails and names `tests/frontend-lint.test.ts` as a failing test, proving the guard is live rather than merely collected; removing the violation SHALL return the suite to green

## ADDED Requirements

### Requirement: The lint baseline is measured, not assumed

The lint baseline this capability protects SHALL be a recorded measurement rather than an assumption. As of this change the measured baseline is: `npm run lint` exits **0** across **206** linted files with **0 errors and 0 warnings**, under ESLint **v9.39.5**, with the `lint` script configured as `eslint src --ext .ts,.tsx --report-unused-disable-directives --max-warnings 0`.

Two properties of that script are load-bearing and SHALL be preserved: `--max-warnings 0` makes warnings failures (so `react-hooks/exhaustive-deps`, `react-refresh/only-export-components` and `no-console`, all configured as warnings, are effectively errors), and the script's scope is `src` only — the `tests/` directory is NOT linted by it, so mounting `tests/` into the container does not widen lint coverage.

#### Scenario: the recorded baseline is reproducible on a host checkout

- **WHEN** a contributor runs `npm run lint` from `facturas-proveedores-web/` on a clean checkout with dependencies installed
- **THEN** the command exits 0 and reports no errors and no warnings

#### Scenario: a warning is treated as a failure

- **WHEN** a change introduces code that triggers a rule configured at the `warn` level, such as a bare `console.log` under `no-console`
- **THEN** `npm run lint` exits non-zero because `--max-warnings 0` promotes the warning to a failure, and the regression-guard test fails with it
