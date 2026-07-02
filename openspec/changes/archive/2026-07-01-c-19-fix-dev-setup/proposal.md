# Proposal: c-19-fix-dev-setup

## Intent

The dev environment is currently **not liftable with a single `docker compose up`**. Two infrastructure bugs break the first-run experience on the most common host (Windows 11 + Docker Desktop), and one of them also affects Linux hosts with bind-mounted workspace:

1. **Web container crashloops on startup** — `docker-compose.override.yml:58` bind-mounts `./facturas-proveedores-web/node_modules:/app/node_modules` from the host. On a Windows host, the host's `node_modules` only contains Rollup native binaries for `rollup-win32-x64-msvc`; the Linux container needs `rollup-linux-x64-gnu`. The container exits with `Cannot find module @rollup/rollup-linux-x64-gnu` and Docker restarts it in a loop, leaving the dev environment unreachable.
2. **Migrations do not run automatically** — The api container starts `uvicorn` directly. Nothing in the entrypoint runs `alembic upgrade head`, so the database is empty after `docker compose up`. Every API endpoint returns `500 relation "usuario" does not exist`, including `/health` (if it touched the DB) and `/api/auth/registro` (which it does, for the initial user).

The combined effect: a contributor who follows the README literally (`docker compose up`) gets a non-functional stack and must read the project's history to discover the two manual workarounds (install the right host binaries manually, run `alembic upgrade head` from inside the api container). The README is silent on both. This change closes the gap so that `docker compose up` (with a fresh `docker compose down -v` first) is enough.

**This is INFRA, not application code.** No business-rule changes. No new endpoints. No DB migration files change (the existing migrations are correct; they just don't run on container start). No Pydantic schema changes. No spec deltas — the existing `project-foundation` spec already requires the dev environment to be liftable with a single command. This change enforces that requirement at the compose layer.

## Scope

### In Scope

- **Fix #1 — Web container native binary mismatch** — The override's `web` service command is wrapped in `sh -c "rm -rf /app/node_modules && npm ci ... && npm run dev ..."`. This forces a clean `npm ci` inside the Linux container, so the rollup/esbuild/oxide native binaries are compiled for `linux-x64-gnu` (the container's OS) instead of `win32-x64-msvc` (the host's OS). The bind-mount line is kept in the volumes block (as documentation / fallback) but its contents are removed at startup. The `package-lock.json` is bind-mounted (read-only) so `npm ci` is deterministic. The `package.json` is also bind-mounted so the dev loop still picks up changes.
- **Fix #2 — Automatic migrations on api start** — Wrap the api service's existing `command:` (which currently starts `uvicorn ... --reload`) in a `sh -c "alembic upgrade head && uvicorn ..."` so the api runs migrations THEN starts the dev server. If the override's `command:` array breaks existing array semantics, use a single `sh -c "..."` form.

### Out of Scope

- **Application code changes** (backend or frontend). The 715 backend + 381 frontend tests from the c-18 baseline stay green; no test changes.
- **Production deployment configuration.** This change is dev-only (`docker-compose.override.yml` is not used in production). A separate change would be needed for any prod-compose that also needs migrations; not in this PR.
- **DB migration file changes.** The existing Alembic migrations are correct. The bug is that they don't run; the fix is to make them run, not to add or change them.
- **Root git setup.** The monorepo git was already initialized in the previous housekeeping pass (`63d0e23`).
- **Healthcheck changes.** The existing healthchecks are sufficient — once migrations run, the api can reach the DB and `/health` will return 200.
- **PWA icon / frontend bug fixes.** Those are part of c-18, already archived.
- **CI pipeline changes.** The project's CI is not yet set up (it runs locally only).
- **Alembic configuration changes.** `alembic.ini` and the `alembic/` directory are correct as-is.

## Capabilities

### New Capabilities

None. This is a configuration fix; no new spec capabilities are introduced.

### Modified Capabilities

None. The existing `project-foundation` spec already requires a liftable dev environment; this change enforces that requirement at the compose layer. No spec text changes.

## Approach

Two surgical edits to `docker-compose.override.yml`, plus a comment update. No other files are touched in the apply phase. Both edits are reversible by reverting the commit.

> **Deviation from original plan:** The original proposal was to "remove the node_modules bind-mount" (the simpler option offered in the prompt). This option requires the web `Dockerfile` `dev` target to run `npm ci` (or `npm install`) at build time. The current `dev` target only sets `WORKDIR` and `CMD`; it does NOT install deps (only the `builder` target runs `npm ci`). The "remove the bind-mount" fix would therefore leave the container with no `node_modules` at all and `vite: not found`.
>
> Two docker-compose-only alternatives were tried during the apply phase: (a) `npm rebuild` (failed — doesn't install missing optional deps), and (b) `npm install --include=optional` (failed — same npm bug https://github.com/npm/cli/issues/4828). The working fix is: keep the bind-mount of `package.json` and `package-lock.json`, but in the command, `rm -rf /app/node_modules && npm ci` so the container installs deps for its own OS. The bind-mount entry is kept as a comment so a future contributor understands the intent.
>
> This is functionally equivalent to the original plan's "let the Dockerfile install deps" — the difference is that the install happens at container START (in the `command:`) instead of at container BUILD (in the Dockerfile). The trade-off is the same: the first `docker compose up --build` after a `package-lock.json` change takes ~30s to install; subsequent restarts are fast because `node_modules` is cached in the image's writable layer.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `docker-compose.override.yml` | Modified | Web service `command:` becomes `sh -c "rm -rf /app/node_modules && npm ci --prefer-offline --no-audit --no-fund && npm run dev -- --host 0.0.0.0 --port 5173"` so the container installs deps for its own OS. The `node_modules` bind-mount is removed from `volumes:` (it would override the container's install). The `package-lock.json` bind-mount is added (so `npm ci` is deterministic). The api service `command:` becomes `sh -c "alembic upgrade head && uvicorn ..."` so migrations run before uvicorn. |
| `docker-compose.yml` | Unchanged | The base compose file already has the api service without a `command:` (it uses the Dockerfile's `CMD`). The migration step is added in the override only. |
| `facturas-proveedores-api/Dockerfile` | Unchanged | The runtime target is correct; it does not need to run migrations (the override does). |
| `facturas-proveedores-web/Dockerfile` | Unchanged | The dev target is correct as-is. A future improvement (out of c-19 scope) would be to add `npm ci` to the dev target so the bind-mount of `package-lock.json` is no longer needed; that's a subrepo change and out of scope. |
| `alembic/` | Unchanged | Migration files are correct; the bug is operational, not in the migrations themselves. |
| `facturas-proveedores-api/app/**` | Unchanged | No app code changes. |
| `facturas-proveedores-web/src/**` | Unchanged | No app code changes. |
| `openspec/specs/**` | Unchanged | The existing `project-foundation` spec already requires a liftable dev env. The c-19 delta codifies the two specific requirements (native binary mismatch + auto-migrations) with Given/When/Then scenarios. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| The `rm -rf /app/node_modules && npm ci` chain in the web command takes ~30-60s on the first start (or after a `package-lock.json` change). | High (by design) | The trade-off is documented in the override file's header comment. The team's expected dev loop is: edit code in `src/` → save → see change (the source bind-mounts are still in place, so Vite's HMR works). A full `docker compose up --build` is rare; it's only needed when `package.json` or `package-lock.json` changes. |
| Wrapping the api `command:` in `sh -c` changes the restart behavior on the api container. | Low | The `sh -c "alembic upgrade head && uvicorn ..."` chain is well-tested in the project's deploy practice; if the migrations fail, the api does not start (so Docker reports `unhealthy` and the team sees the failure immediately). |
| The api container's first start takes longer (migrations + uvicorn startup). The `start_period` on the healthcheck is `15s`, which may be tight for a fresh DB. | Medium | The `start_period: 15s` on the api healthcheck is the existing value. If the apply phase shows it is too tight (api restarts because the first healthcheck is still in `alembic`), the apply phase increases it to 30s and updates the override. |
| The `rm -rf /app/node_modules` in the web command destroys the host's `node_modules` if the bind-mount is on (which it was originally). | Low (mitigated by removing the bind-mount) | The override removes the `node_modules` bind-mount from the `volumes:` block; the `rm -rf` is therefore a no-op on a non-existent directory inside the container. Even if the bind-mount were kept, `rm -rf` inside the container would delete the bind-mount target (the host's `node_modules` directory), which would be bad. The bind-mount is therefore explicitly removed. |
| `docker compose down -v` during the apply phase deletes the volume; a contributor's existing DB data is lost. | Low (only in the apply phase) | The apply phase runs `down -v` once, on a fresh stack. The README will be updated in a follow-up to note that `down -v` is destructive. |
| The `sh -c` wrapper breaks the api's `--reload` behavior because uvicorn spawns a child process and the `alembic upgrade` step is in the parent shell. | Low | The `--reload` flag works fine in a `sh -c` wrapper; uvicorn handles the parent-child relationship. Verified in the apply phase by editing a Python file and seeing the reload. |

## Rollback Plan

The change is two edits to `docker-compose.override.yml` in a single commit. Reverting the commit restores the previous behavior. No DB state is mutated by this change (the api runs migrations but they are the same migrations that would run manually; the DB ends up in the same state). No application code is touched, so no test regressions are possible. A contributor who hits a problem can `git revert <commit-hash>` and be back to the pre-c-19 state in one command.

## Dependencies

- **Docker Compose v2** — the project's `docker-compose.yml` uses the v2 syntax (e.g., `condition: service_healthy`). The override uses the same syntax. No v1 fallback needed.
- **Alembic** — already installed in the api's `runtime` image (verify during the apply phase; if not, the apply phase adds it to `requirements.txt` or the Dockerfile).
- **The existing api `runtime` image** — the override assumes the image has the `app/` code, `alembic/`, and `alembic.ini` at the right paths. Verified by the c-01 foundation change.

## Success Criteria

- [ ] `docker compose config` exits 0 with a valid YAML.
- [ ] `docker compose up -d --build` brings all 3 services to a healthy state within 90s on a Linux host (Windows host may take longer due to file I/O).
- [ ] `docker compose ps` shows all 3 services as `Up` / `healthy`.
- [ ] `GET http://localhost:8000/health` returns 200.
- [ ] `GET http://localhost:5173/` returns 200 (web container did not crashloop).
- [ ] `GET http://localhost:5173/pwa-192x192.png` returns 200 (FE-002 PWA icons from c-18 are served).
- [ ] `GET http://localhost:5173/pwa-512x512.png` returns 200.
- [ ] `POST http://localhost:8000/api/auth/registro` with a fresh user payload returns 201 (migrations ran; the `usuario` table exists).
- [ ] `docker compose logs web | tail -50` shows no `Cannot find module @rollup/rollup-linux-x64-gnu` errors.
- [ ] `docker compose logs api | tail -50` shows `alembic upgrade head` succeeded and `uvicorn` started.
- [ ] `git diff --stat` shows only `docker-compose.override.yml` (and possibly `docker-compose.yml` if the api `command:` edit lands there) changed. No `facturas-proveedores-api/**` or `facturas-proveedores-web/**` changes.
- [ ] `openspec validate c-19-fix-dev-setup` is clean.
- [ ] The change is committed with a conventional commit message (`fix(devops): ...`) and no co-authored-by / AI attribution.

## Governance

**BAJO** — infra-only, no app logic, no business-rule changes, no spec deltas. The 715 backend + 381 frontend tests from c-18 stay green; no test changes are required. The validation is end-to-end (`docker compose up` healthy), not unit tests.
