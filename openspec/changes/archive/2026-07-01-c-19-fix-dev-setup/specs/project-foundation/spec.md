## ADDED Requirements

### Requirement: Dev environment is liftable with a single `docker compose up` (from a fresh state)

The system SHALL be liftable end-to-end with the canonical sequence `docker compose down -v && docker compose up -d --build` followed by no manual steps. The two operational requirements are:

1. **The web container SHALL install its own `node_modules` inside the container for the container's OS, NOT bind-mount the host's `node_modules`.** Native binaries in Vite's dep tree (rollup, esbuild, `@tailwindcss/oxide`, lightningcss, etc.) are OS-specific; the Linux container needs `linux-x64-gnu` binaries while a Windows host has only `win32-x64-msvc`. The fix is to bind-mount `package.json` and `package-lock.json` (so the dev loop picks up source changes), and in the `command:` do `rm -rf /app/node_modules && npm ci` so the container installs deps for its own OS. The bind-mount of the host's `node_modules` is REMOVED from the `volumes:` block.
2. **The api container SHALL run `alembic upgrade head` before starting `uvicorn` so the database schema is current before the first request lands.** Migrations are idempotent (no-op when the DB is already at `head`), so this is safe to run on every container start. If migrations fail, uvicorn SHALL NOT start; Docker reports the container as `unhealthy` and the team sees the failure immediately.

The trade-off for Bug #1 is documented in `docker-compose.override.yml`'s header comment: the first `docker compose up --build` (or any start after a `package-lock.json` change) takes ~30-60s to install deps; subsequent restarts are fast because `node_modules` is cached in the image's writable layer. Editing `package.json` on the host requires a container restart to pick up the new dep (the bind-mount updates `package.json` in the container, but `node_modules` is not auto-updated). Hot reload for `src/` is unaffected because the source bind-mount is preserved.

#### Scenario: Fresh `docker compose down -v && docker compose up -d --build` brings all 3 services to a healthy state

- **WHEN** a contributor runs `docker compose down -v` (to drop the `postgres_data` volume) and then `docker compose up -d --build` on a Windows 11 + Docker Desktop host (the primary dev platform)
- **THEN** within 120 seconds, all 3 services are `Up`: `facturas_db` is `(healthy)`, `facturas_api` is `(healthy)` after running `alembic upgrade head` followed by `uvicorn`, and `facturas_web` is `Up` with the Vite dev server listening on port 5173 (no Rollup `Cannot find module` errors in the web container logs)

#### Scenario: `POST /api/auth/registro` returns 201 (not 500) after a fresh start, proving migrations ran

- **WHEN** a contributor curls `POST http://localhost:8000/api/auth/registro` with a valid user payload (`{"email": "...", "password": "...", "nombre": "..."}`) immediately after the stack reaches `(healthy)`
- **THEN** the api returns `201 Created` (not `500 Internal Server Error` with `relation "usuario" does not exist`), confirming the `alembic upgrade head` step in the api container's command ran the migration chain and the `usuario` table exists

#### Scenario: Web container does not crashloop on Windows host

- **WHEN** a contributor inspects `docker compose logs web` after a fresh `docker compose up -d --build` on a Windows host
- **THEN** the logs do NOT contain `Cannot find module @rollup/rollup-linux-x64-gnu` (or any other `Cannot find module` error referencing a Rollup/esbuild/Oxide native binary); the Vite dev server starts and stays running. The web container's `node_modules` was installed inside the container for `linux-x64-gnu`, not bind-mounted from the Windows host

#### Scenario: PWA assets are served in the production-like dev env

- **WHEN** a contributor curls `GET http://localhost:5173/pwa-192x192.png` and `GET http://localhost:5173/pwa-512x512.png`
- **THEN** both return `200`, confirming the web container's `public/` bind-mount is intact (only the `node_modules` bind-mount was removed in c-19)

#### Scenario: Migrations are idempotent on container restart

- **WHEN** the api container is restarted (e.g., `docker compose restart api`) after the first successful start
- **THEN** the `alembic upgrade head` step in the command is a no-op (the DB is already at `head`); uvicorn starts; the api returns to `(healthy)` within 15s

#### Scenario: A failed migration aborts the api container (fail-fast)

- **WHEN** the `alembic upgrade head` step fails (e.g., the database is unreachable, the migration has a syntax error, the `alembic_version` table is in an unexpected state)
- **THEN** uvicorn does NOT start; the api container's healthcheck reports `unhealthy`; `docker compose logs api` shows the alembic error; the team sees the failure immediately (no silent half-broken state)

### Requirement: The dev environment lifecycle is documented in `docker-compose.override.yml`

The `docker-compose.override.yml` file's header comment SHALL document the two dev-only behaviors from this capability (the bind-mount removal + `npm ci` wrapper, and the `alembic upgrade head` wrapper) so a contributor reading the file understands the trade-offs and the rationale.

#### Scenario: Header comment documents the web service `npm ci` wrapper

- **WHEN** a contributor reads the first 30 lines of `docker-compose.override.yml`
- **THEN** the header comment explicitly states that `node_modules` is NOT bind-mounted from the host, that the container runs `npm ci` inside the `command:` to install Linux-native binaries, and that the trade-off is a slower first start (with the Docker writable layer cache keeping subsequent restarts fast)

#### Scenario: Header comment documents the migration wrapper

- **WHEN** a contributor reads the `api` service's `command:` in `docker-compose.override.yml`
- **THEN** the comment explains that `alembic upgrade head` runs before `uvicorn`, that the chain uses `&&` (so a migration failure aborts the api), and that the chain is idempotent on restart
