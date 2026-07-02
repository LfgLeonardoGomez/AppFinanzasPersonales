# Tasks: c-19-fix-dev-setup

> **Strict TDD discipline is enabled** for the project, but for INFRA changes the "test" is **end-to-end**: the change passes if `docker compose up -d --build` brings all 3 services to a healthy state and the smoke tests (`/health`, `/`, `/pwa-*.png`, `POST /api/auth/registro`) return the expected status codes.
>
> **This is INFRA, not application code.** 2 mechanical edits to `docker-compose.override.yml`, no app code changes, no DB migration file changes, no spec deltas beyond a `project-foundation` capability delta. The 715 backend + 381 frontend tests from c-18 stay green; no test changes are required.
>
> **Order:** Bug #1 (web container native binaries) → Bug #2 (api migrations) → end-to-end validation → commit. Both fixes land in a single commit (one cohesive infra change).
>
> **Deviation from original plan (discovered during apply):** The original plan was to "remove the node_modules bind-mount" and let the Dockerfile's dev target install deps. The web `dev` target does NOT run `npm ci` (only the `builder` target does), so removing the bind-mount would leave the container with no `node_modules` at all. The working fix is to keep the bind-mount of `package.json` and `package-lock.json`, remove the `node_modules` bind-mount, and `rm -rf /app/node_modules && npm ci` in the `command:`. This is functionally equivalent to "let the Dockerfile install deps" but docker-compose-only. See D-1 in `design.md` for the full rationale (including the three failed approaches: `npm rebuild`, `npm install --include=optional`, and surgical `npm install <pkg>`).

## Task 1 — Bug #1: Force container-installed `node_modules` (revised during apply)

- [x] 1.1 **Understand.** Read `docker-compose.override.yml:36-60` (the `web` service's `volumes:` block). Identify the line `./facturas-proveedores-web/node_modules:/app/node_modules` at line 58. Read `facturas-proveedores-web/Dockerfile` to confirm the `dev` target does NOT run `npm ci` (only the `builder` target does).
- [x] 1.2 **Verify the bug.** Tried `rm -rf /app/node_modules` only (removes bind-mount, no install) → `vite: not found`. Tried `npm rebuild` → `Cannot find module @rollup/rollup-linux-x64-gnu`. Tried `npm install --include=optional` → same error (npm CLI bug #4828). Tried surgical `npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64 lightningcss-linux-x64-gnu --no-save` → fixed Rollup/esbuild/lightningcss but `@tailwindcss/oxide-linux-x64-gnu` was still missing. **Conclusion:** the only working docker-compose-only fix is to combine the bind-mount removal with an in-container `npm ci`.
- [x] 1.3 **Edit `docker-compose.override.yml`.** Three changes to the `web` service:
  - **Replace** the `node_modules` bind-mount line:
    - Old: `- ./facturas-proveedores-web/node_modules:/app/node_modules`
    - New: a comment explaining the C-19 fix + a new `package-lock.json` bind-mount:
      ```yaml
      # package-lock.json es necesario para `npm ci`. NO se monta
      # node_modules: se borra y se reinstala dentro del contenedor.
      - ./facturas-proveedores-web/package-lock.json:/app/package-lock.json:ro
      ```
  - **Replace** the `command:` array:
    - Old: `npm run dev -- --host 0.0.0.0 --port 5173` (array form)
    - New: `sh -c "rm -rf /app/node_modules && npm ci --prefer-offline --no-audit --no-fund && npm run dev -- --host 0.0.0.0 --port 5173"` (array form with sh wrapper)
- [x] 1.4 **Verify the YAML is still valid.** Run `docker compose config` from the project root. **Expected:** exit 0, no parse errors. The output should show the `web` service with the new command and 7 volume mounts (6 source + 1 package-lock.json; no node_modules).
- [x] 1.5 **Mark complete.** Bug #1 is fixed at the YAML level. End-to-end validation happens in Task 4.

## Task 2 — Bug #2: Run `alembic upgrade head` before `uvicorn` in api service

- [x] 2.1 **Understand.** Read `docker-compose.override.yml:13-39` (the `api` service block). Identify the `command:` array at lines 16-25, which currently starts `uvicorn` directly. Read `facturas-proveedores-api/Dockerfile` to confirm the `runtime` target's `CMD` is `["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` (production-like, no migrations).
- [x] 2.2 **Verify alembic is available in the runtime image.** Read `facturas-proveedores-api/pyproject.toml` and confirm `alembic>=1.13.0,<2` is in `[project.dependencies]`. **Result:** confirmed in runtime deps.
- [x] 2.3 **Verify `alembic.ini` is at the right path.** The api's `WORKDIR` in the Dockerfile is `/app`, and the `alembic.ini` is in the same directory. The override already mounts `./facturas-proveedores-api/alembic.ini:/app/alembic.ini:ro`. **Result:** confirmed.
- [x] 2.4 **Verify `alembic/env.py` reads the `DATABASE_URL` env var.** Read `facturas-proveedores-api/alembic/env.py:38-50` (the `get_url()` function). **Result:** confirmed: `url = os.environ.get("DATABASE_URL")` reads from the env var, falling back to `app.core.config.settings.DATABASE_URL`.
- [x] 2.5 **Edit `docker-compose.override.yml`.** Replace the `command:` array (lines 16-25) with the wrapped form:
  ```yaml
  command:
    # C-19: migraciones antes de uvicorn. Si alembic falla, uvicorn
    # no arranca → docker ps muestra "unhealthy" → el team lo ve.
    - sh
    - -c
    - "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app"
  ```
  The `volumes:` block (lines 31-36) stays the same — the `alembic.ini` and `alembic/` directory are already mounted.
- [x] 2.6 **Verify the YAML is still valid.** Run `docker compose config` from the project root. **Expected:** exit 0, no parse errors. The output should show the `api` service with a `command:` of `sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app"`.
- [x] 2.7 **Mark complete.** Bug #2 is fixed at the YAML level. End-to-end validation happens in Task 4.

## Task 3 — Update the override file's header comment

- [x] 3.1 **Edit `docker-compose.override.yml:1-8`.** Add a "C-19-fix-dev-setup" block to the header comment explaining both fixes (and the trade-offs). The exact text includes the rationale for the `rm -rf + npm ci` approach (the bind-mount removal alone doesn't work because the Dockerfile's `dev` target doesn't run `npm ci`).
- [x] 3.2 **Verify the YAML is still valid.** Run `docker compose config`. **Expected:** exit 0, no parse errors.
- [x] 3.3 **Mark complete.** Header comment is updated.

## Task 4 — End-to-end validation (the "test" for this infra change)

> This task IS the validation. There are no unit tests for docker-compose changes. The change is "GREEN" when the smoke tests pass.

- [x] 4.1 **Clean state.** From the project root, run `docker compose down -v`. **Expected:** all containers stopped, the `postgres_data` volume removed.
- [x] 4.2 **Build and start.** From the project root, run `docker compose up -d --build`. **Expected:** all 3 services start. The first build is fast (cached layers); the web container then runs `rm -rf /app/node_modules && npm ci` (~30s) before starting Vite. Capture the elapsed time for the report.
- [x] 4.3 **Wait for healthy state.** All 3 services reached healthy/Up within ~60s:
  - `facturas_db`: `Up` / `healthy` within 10s.
  - `facturas_api`: `Up` / `healthy` within 30s (migrations + uvicorn startup; `start_period: 15s` was sufficient).
  - `facturas_web`: `Up` within 60s (npm ci + vite startup). No `start_period` (no healthcheck on web).
- [x] 4.4 **Smoke test the api health.** `curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health` → **200**.
- [x] 4.5 **Smoke test the web root.** `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/` → **200**.
- [x] 4.6 **Smoke test the PWA icons (FE-002 from c-18).** Both `pwa-192x192.png` and `pwa-512x512.png` returned **200**. Confirms the bind-mount of `public/` is intact.
- [x] 4.7 **Smoke test the migrations.** `POST /api/auth/registro` returned **201 Created** with the new user's UUID, email, and timestamp. Confirms `alembic upgrade head` ran successfully and the c-04 auth flow works.
- [x] 4.8 **Verify no Rollup errors.** `docker compose logs web | grep -i "cannot find module"` → empty. Confirms Bug #1 is fixed.
- [x] 4.9 **Verify migrations ran.** `docker compose logs api | grep -iE "alembic|upgrade"` showed lines like:
  - `INFO  [alembic.runtime.migration] Running upgrade  -> 0001, Initial domain schema: usuario, proveedor, factura, factura_item, pago.`
  - `Running upgrade 0001 -> 0002, Add refresh_token table for opaque session tokens.`
  - `Running upgrade 0002 -> 0003, Add composite expression index (usuario_id, lower(nombre)) on proveedor.`
  - `Running upgrade 0003 -> 0004, Add cross-supplier listing index on factura for C-08 service queries.`
  - `Running upgrade 0004 -> 0005, Add composite FIFO pool index on pago for C-10 service queries.`
- [x] 4.10 **Mark complete.** All 6 smoke tests pass. The change is GREEN.

## Task 5 — Commit the change to the monorepo root git

> The monorepo git is at the project root. The subrepos (`facturas-proveedores-api/` and `facturas-proveedores-web/`) are independent git repos; this change does NOT touch any subrepo.

- [x] 5.1 **Verify the diff scope.** From the project root, run `git status` and `git diff --stat`. **Expected:** only `docker-compose.override.yml` is changed. No `facturas-proveedores-api/**` or `facturas-proveedores-web/**` changes. The `openspec/changes/c-19-fix-dev-setup/` folder is untracked (it's the proposal artifacts, not part of the apply commit).
- [x] 5.2 **Stage the file.** From the project root, run `git add docker-compose.override.yml`.
- [x] 5.3 **Commit with conventional message.** From the project root, run:
  ```bash
  git commit -m "fix(devops): run alembic on api start and let web install node_modules inside the container (C-19)"
  ```
  **Expected:** one commit, no co-authored-by, no AI attribution. The commit hash is captured for the report.
- [x] 5.4 **Verify the working tree is clean.** From the project root, run `git status`. **Expected:** `nothing to commit, working tree clean` (except the untracked `openspec/changes/c-19-fix-dev-setup/` folder).
- [x] 5.5 **Mark complete.** The change is committed.

## Task 6 — Leave the stack running for the orchestrator

> The orchestrator's task description says: "After successful smoke test, leave the stack running with `docker compose up -d` so the orchestrator can do the final visual verification."

- [x] 6.1 **Verify the stack is still up.** From the project root, run `docker compose ps`. **Expected:** all 3 services `Up`. The api is `(healthy)`, the db is `(healthy)`, the web is `Up`.
- [x] 6.2 **Do NOT run `docker compose down`.** The orchestrator needs the stack running for the visual smoke test.
- [x] 6.3 **Capture container IDs.** The report includes the container IDs.

## Task 7 — Cross-bucket verification (c-18 protected tests + project invariants)

> The c-18 baseline is 715 backend + 381 frontend tests. This change does NOT touch any test or any application code, so the baseline is preserved by construction. This task is a sanity check, not a real test.

- [x] 7.1 **Verify no test files were modified.** `git diff --name-only HEAD~1 HEAD` shows only `docker-compose.override.yml`. No `tests/**` files.
- [x] 7.2 **Verify no app code was modified.** `git diff --name-only HEAD~1 HEAD | grep -E "facturas-proveedores-(api|web)/(app|src)" || echo "no app code changes"` → no app code changes.
- [x] 7.3 **Verify no spec deltas were committed in this commit.** `git diff --name-only HEAD~1 HEAD` shows only `docker-compose.override.yml`. The c-19 change folder is created by `openspec new change` (untracked).
- [x] 7.4 **Run `openspec validate`.** `openspec validate c-19-fix-dev-setup` → `Change 'c-19-fix-dev-setup' is valid`.
- [x] 7.5 **Mark complete.** The change passes the cross-bucket verification.

## Review Workload Forecast

- **Estimated changed lines:** ~46 insertions, ~20 deletions in `docker-compose.override.yml`. One file edited. (Slightly larger than the original ~15-line estimate because the header comment is longer to explain the `rm -rf + npm ci` rationale.)
- **Chained PRs recommended:** **No.** Single commit, single file, ~66 lines of diff. Below any chained-PR threshold.
- **400-line budget risk:** **None.** The change is well under 100 lines.
- **Breaking surface:** **None at the public API level.** The api's `command:` chain is internal to the dev container. The web service's command and volume mounts are internal to the dev container. No production code is touched.
- **C-20+ unblocked:** The next feature change can be developed against a fully-functional local stack. A contributor can `git clone`, `docker compose up --build`, and have a working app in under 2 minutes (on a Linux host) or 3-4 minutes (on a Windows host, the first time because `npm ci` runs inside the container).
- **Follow-up housekeeping (out of scope):**
  - The web Dockerfile's `dev` target could be updated to run `npm ci` (a subrepo change). This would let the `rm -rf + npm ci` in the `command:` be replaced with a `npm ci` at build time, making the change even faster. Not in this PR; the subrepo change belongs in a separate housekeeping pass.
  - The README could be updated to mention `docker compose down -v` is destructive. Not in this PR.

## Definition of done (apply phase)

- [x] All tasks 1–7 are checked off; the end-to-end smoke tests pass.
- [x] `docker compose up -d --build` brings all 3 services to a healthy state within 120s.
- [x] `GET /health` (api) returns 200.
- [x] `GET /` (web) returns 200.
- [x] `GET /pwa-192x192.png` and `GET /pwa-512x512.png` return 200.
- [x] `POST /api/auth/registro` returns 201.
- [x] `docker compose logs web | grep "Cannot find module"` is empty.
- [x] `docker compose logs api | grep alembic` shows the migration chain applied.
- [x] `git diff --stat` shows only `docker-compose.override.yml`.
- [x] `git status` is clean (except untracked `openspec/changes/c-19-fix-dev-setup/`).
- [x] The commit is one conventional commit, no co-authored-by, no AI attribution.
- [x] `openspec validate c-19-fix-dev-setup` is clean.
- [x] The stack is left running with `docker compose up -d` for the orchestrator's visual smoke test.
