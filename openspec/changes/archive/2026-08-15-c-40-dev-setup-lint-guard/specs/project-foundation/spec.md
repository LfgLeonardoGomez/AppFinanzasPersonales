## ADDED Requirements

### Requirement: The `web` container mounts every path the frontend quality gates read

The `web` service's `volumes:` block in `docker-compose.override.yml` SHALL bind-mount every path that a frontend quality gate reads at runtime.

This is load-bearing because the `dev` target of `facturas-proveedores-web/Dockerfile` contains no `COPY` instruction: the `web` container's `/app` directory consists of exactly the declared `volumes:` entries plus the `node_modules` installed by the `npm ci` in its `command:`. Any path absent from that mount list is absent from the container.

At minimum the block SHALL include:

1. `./facturas-proveedores-web/eslint.config.js:/app/eslint.config.js:ro` — without it, `npm run lint` inside the container fails with `ESLint couldn't find an eslint.config.js file.` regardless of the state of the source code.
2. `./facturas-proveedores-web/tests:/app/tests:ro` — without it, Vitest collects no test files from that directory and every regression-guard placed there is silently excluded from the container suite.

Mounts SHALL be read-only (`:ro`), consistent with the other source mounts in the same block: ESLint does not write its configuration and Vitest does not write test sources.

The `web` service SHALL NOT bind-mount the whole `facturas-proveedores-web/` directory onto `/app` as a way of satisfying this requirement, because doing so would shadow the container's `node_modules` with the host's and reintroduce the native-binary crashloop that the existing requirement "Dev environment is liftable with a single `docker compose up`" forbids.

#### Scenario: The container exposes the ESLint configuration

- **WHEN** a contributor runs `docker exec facturas_web test -f /app/eslint.config.js` after `docker compose up -d`
- **THEN** the command exits 0, confirming the configuration file is present inside the container

#### Scenario: The container exposes the frontend test directory

- **WHEN** a contributor runs `docker exec facturas_web ls /app/tests` after `docker compose up -d`
- **THEN** the directory exists and lists `frontend-lint.test.ts` and `design-system-guard.test.ts`

#### Scenario: `npm run lint` runs to completion inside the container

- **WHEN** a contributor runs `npm run lint` inside the `web` container against the current codebase
- **THEN** ESLint resolves its configuration and exits 0, and the output does NOT contain `ESLint couldn't find an eslint.config.js file.`

#### Scenario: The container test suite collects the guard directory

- **WHEN** a contributor runs the frontend suite inside the `web` container
- **THEN** the collected test files include both files under `tests/`, so the suite reports 94 files and 706 tests instead of the 92 files and 703 tests collected before this requirement was enforced

#### Scenario: The host `node_modules` is still not shadowing the container's

- **WHEN** a contributor inspects `docker compose logs web` after a fresh `docker compose up -d --build` on a Windows host, with the new mounts in place
- **THEN** the logs do NOT contain `Cannot find module @rollup/rollup-linux-x64-gnu` or any other native-binary resolution error, confirming the added mounts are path-scoped and did not shadow `/app/node_modules`

### Requirement: The mount list is documented as an extensible contract

The header comment of `docker-compose.override.yml` SHALL state that the `web` service's `dev` Docker target copies no source, that `/app` therefore equals the declared mount set, and that any newly added path a quality gate reads — a new root-level configuration file, or a new test directory — MUST be added to the `web` service's `volumes:` block or it will be invisible inside the container.

This requirement exists because the omission it documents recurred: the `tests/` directory was unmounted when the lint regression-guard was written, and a second guard was later added to the same directory and inherited the same invisibility without anyone noticing. Documenting the two specific paths is not sufficient; the rule that generates them SHALL be recorded.

#### Scenario: A contributor reads the mount contract before adding a guard

- **WHEN** a contributor reads the header comment of `docker-compose.override.yml`
- **THEN** the comment explicitly states that the `dev` target performs no `COPY`, that `/app` contains only the mounted paths plus the container-installed `node_modules`, and that a new quality-gate path must be added to `volumes:` to be visible in the container

#### Scenario: The rationale for the two current mounts is recorded

- **WHEN** a contributor reads the `web` service's `volumes:` block
- **THEN** the `eslint.config.js` and `tests` entries carry a comment explaining that without them `npm run lint` cannot resolve its configuration and the regression-guards under `tests/` are never collected
