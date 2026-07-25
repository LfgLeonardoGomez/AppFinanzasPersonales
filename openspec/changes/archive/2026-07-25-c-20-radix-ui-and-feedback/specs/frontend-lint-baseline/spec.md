# Frontend Lint Baseline Specification

## Purpose

This capability locks in the contract that the frontend (`facturas-proveedores-web`) lints cleanly and that the lint baseline is regression-guarded by an automated test. It resolves project decision D-24 (`knowledge-base/09_decisiones_y_supuestos.md:32`), which documented that `npm run lint` was broken due to an ESLint v10 / v9 config-format incompatibility and was deferred from earlier changes. The capability covers: the lint command runs, the lint command exits with code 0, the lint command emits zero warnings (matching the project's `--max-warnings 0` baseline), and an automated test in the test suite asserts the exit code so any future PR that re-introduces a lint failure is caught in CI.

The capability is intentionally narrow: it does not introduce new lint rules, does not change code style, and does not refactor existing components to satisfy stricter rules. It only restores the existing rule set to a working state and adds a regression guard.

## ADDED Requirements

### Requirement: npm run lint exits with code 0 and zero warnings

The `npm run lint` script in `facturas-proveedores-web/package.json` SHALL execute successfully: the process exit code SHALL be `0`, the standard output SHALL NOT contain the string "error" (case-insensitive) emitted by ESLint, and the standard output SHALL NOT contain any warning line (the script is configured with `--max-warnings 0`). The script SHALL use a pinned, working ESLint major version (v9.x) and a config format compatible with that version.

#### Scenario: lint passes on a clean checkout

- **WHEN** a developer runs `npm run lint` from `facturas-proveedores-web/` against the post-C-19 codebase
- **THEN** the command exits with code 0 and produces no error or warning output

#### Scenario: lint fails on a new lint error introduced in a future PR

- **WHEN** a future change introduces a TypeScript file with a `no-unused-vars` violation
- **THEN** `npm run lint` exits with a non-zero code and the violating file is named in the output

### Requirement: An automated test asserts the lint exit code

A test SHALL exist in `facturas-proveedores-web/tests/` (or equivalent test directory) that executes `npm run lint` as a child process and asserts the exit code is `0`. The test SHALL run as part of `npm test` and SHALL fail the suite if the lint command fails. The test SHALL be skipped (not failed, not deleted) if `node_modules` is not installed in the test environment (e.g. CI cache miss), so the test does not produce false failures from missing dependencies rather than from real lint breakage.

#### Scenario: lint-passing code keeps the regression test green

- **WHEN** the codebase is in a state where `npm run lint` would exit 0
- **THEN** the regression-guard test passes

#### Scenario: lint-failing code fails the regression test

- **WHEN** a developer introduces a file with a known lint violation and runs `npm test`
- **THEN** the regression-guard test fails with a message indicating the lint command failed, and the test output includes the first lines of the lint output for debugging

#### Scenario: regression test is skipped when node_modules is absent

- **WHEN** the test runs in an environment where `facturas-proveedores-web/node_modules/` does not exist
- **THEN** the test is marked skipped (not failed) and a clear message indicates the skip reason
