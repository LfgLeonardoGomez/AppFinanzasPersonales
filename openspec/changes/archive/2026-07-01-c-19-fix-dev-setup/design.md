# Design: c-19-fix-dev-setup

## Context

The c-18 housekeeping pass (archived 2026-07-01) brought the project to a clean baseline: 715 backend tests passing, 381 frontend tests passing, MVP live and demoable. A follow-up audit of the **dev environment** surfaced two infrastructure bugs that prevent a new contributor from lifting the stack with the documented `docker compose up` command:

1. **Web container crashloops on Windows hosts** because of a native binary mismatch (the host's `node_modules` has Rollup binaries for Windows; the container needs Linux ones).
2. **The api container never runs `alembic upgrade head`**, so the DB is empty after `docker compose up` and every endpoint returns 500.

Both bugs share a single root cause family: the `docker-compose.override.yml` was written assuming the host and the container are the same OS. They are not (the team's primary dev host is Windows 11 + Docker Desktop). The fix is to make the containers self-sufficient: let the web Dockerfile's `npm ci` install the right binaries inside the Linux container, and let the api container's command chain run migrations before uvicorn starts.

**This is INFRA, not application code.** No business-rule changes. No new endpoints. No DB migration files change. No Pydantic schema changes. The 715 backend + 381 frontend tests from c-18 stay green; no test changes are required. The validation is **end-to-end** (`docker compose up` healthy), not unit tests.

**Affected code (summary):**
- `docker-compose.override.yml` — 2 edits, 1 file.
- `docker-compose.yml` — possibly 0 edits (the override can hold the migration command).
- `facturas-proveedores-api/Dockerfile` — 0 changes.
- `facturas-proveedores-web/Dockerfile` — 0 changes.
- `alembic/**` — 0 changes (migrations are correct; the bug is operational).
- `facturas-proveedores-api/app/**` — 0 changes.
- `facturas-proveedores-web/src/**` — 0 changes.

**No spec deltas.** The existing `project-foundation` spec already requires a liftable dev environment; this change enforces that requirement at the compose layer.

## Goals / Non-Goals

**Goals:**

1. **Make `docker compose up` (after a fresh `docker compose down -v`) sufficient** to lift the entire stack to a healthy state on a Windows host (the primary dev platform) and a Linux host.
2. **Eliminate the web container's Rollup crashloop** by removing the host `node_modules` bind-mount and letting the container install its own Linux binaries.
3. **Run DB migrations automatically on api container start** so the `usuario` table (and all others) exist before the first API request.
4. **Preserve the c-18 test baseline** (715 backend + 381 frontend tests still pass).
5. **Keep the diff small and reviewable** — one commit, one file edited (`docker-compose.override.yml`), ~10 lines of diff.

**Non-Goals:**

- No application code changes (backend or frontend). The c-18 baseline stays green; no test changes.
- No production deployment configuration changes. The override is dev-only.
- No new dependencies. The api's runtime image already has `alembic` (declared in `pyproject.toml` runtime deps). The web's dev target already has `npm ci` or `npm install` in the Dockerfile.
- No DB migration file changes. The existing migrations are correct.
- No CI / CD pipeline changes. The project does not have a CI pipeline yet.
- No healthcheck changes (unless the apply phase proves the existing 15s `start_period` is too tight for a fresh DB).
- No PWA / frontend bug fixes (those are in c-18, already archived).
- No spec deltas. The `project-foundation` spec is already correct; this change enforces it.

## Decisions

### D-1 — Bug #1 (revised during apply): Force a clean `npm ci` inside the container, do NOT keep the bind-mount

**What was tried (in order, all failed).**

The original proposal was to "remove the `node_modules` bind-mount and let the Dockerfile's `npm ci` install the correct binaries." During the apply phase, this was discovered to require a Dockerfile change (the `dev` target does NOT run `npm ci`), which violates the docker-compose-only rule. Two docker-compose-only alternatives were tried:

1. **`npm rebuild`** — fails because `npm rebuild` only rebuilds native bindings for already-installed packages. `@rollup/rollup-linux-x64-gnu` is NOT in the host's `node_modules` (the host is Windows, so the optional Linux binary was skipped). `npm rebuild` doesn't install missing optionals.
2. **`npm install --include=optional`** — fails because of npm CLI issue https://github.com/npm/cli/issues/4828: when `node_modules` is already populated and matches the lockfile, `npm install` is a no-op, even with `--include=optional`. The missing optional is not detected.
3. **`npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64 lightningcss-linux-x64-gnu --no-save`** (surgical) — fails because there are MORE missing native bindings than these three. `@tailwindcss/oxide-linux-x64-gnu` and any future package's Linux binary would also need to be added. Whack-a-mole.

**What works.** The clean docker-compose-only fix is to keep the bind-mounts of `package.json` and `package-lock.json` (so the dev loop is fast and the lockfile is honored), remove the `node_modules` bind-mount from the `volumes:` block (so it doesn't override the container's install), and in the `command:`, do `rm -rf /app/node_modules && npm ci` to force a clean install inside the container for its own OS. This is functionally equivalent to "let the Dockerfile install deps" — the difference is the install happens at container START (in the `command:`) instead of at container BUILD (in the Dockerfile). The trade-off is the same: the first `docker compose up --build` after a `package-lock.json` change takes ~30s to install; subsequent restarts are fast because `node_modules` is cached in the image's writable layer (not the host's bind-mount).

**Before (lines 49-58 of the override):**
```yaml
volumes:
  # Montar código fuente y node_modules desde host para velocidad
  - ./facturas-proveedores-web/src:/app/src:ro
  - ./facturas-proveedores-web/public:/app/public:ro
  - ./facturas-proveedores-web/index.html:/app/index.html:ro
  - ./facturas-proveedores-web/vite.config.ts:/app/vite.config.ts:ro
  - ./facturas-proveedores-web/tsconfig.json:/app/tsconfig.json:ro
  - ./facturas-proveedores-web/package.json:/app/package.json:ro
  # node_modules montado desde el host (instalar con npm ci primero)
  - ./facturas-proveedores-web/node_modules:/app/node_modules
```

**After:**
```yaml
volumes:
  # Montar código fuente y package*.json desde host para hot reload.
  # NO se monta node_modules: el contenedor hace su propio `npm ci`
  # adentro (en el command) para que los binarios nativos (rollup,
  # esbuild, @tailwindcss/oxide, lightningcss, etc.) se compilen
  # para el OS del contenedor (linux-x64-gnu), no del host.
  - ./facturas-proveedores-web/src:/app/src:ro
  - ./facturas-proveedores-web/public:/app/public:ro
  - ./facturas-proveedores-web/index.html:/app/index.html:ro
  - ./facturas-proveedores-web/vite.config.ts:/app/vite.config.ts:ro
  - ./facturas-proveedores-web/tsconfig.json:/app/tsconfig.json:ro
  - ./facturas-proveedores-web/package.json:/app/package.json:ro
  # package-lock.json es necesario para `npm ci` determinístico.
  - ./facturas-proveedores-web/package-lock.json:/app/package-lock.json:ro
```

**And the command change (line 45-49 of the override):**
```yaml
command:
  # C-19: limpiar node_modules y reinstalar adentro del contenedor
  # para que los binarios nativos matcheen el OS del contenedor.
  # Si el bind-mount estuviera activo, el `rm -rf` borraría la
  # carpeta del host. Por eso el bind-mount se quitó de volumes.
  - sh
  - -c
  - "rm -rf /app/node_modules && npm ci --prefer-offline --no-audit --no-fund && npm run dev -- --host 0.0.0.0 --port 5173"
```

**Why this is the right trade-off.** The prompt offered two options for Bug #1: (a) remove the bind-mount and let the Dockerfile install deps, (b) keep the bind-mount and add `npm rebuild` to the command. Neither worked as described because of pre-existing conditions in the project:

- Option (a) didn't work because the web Dockerfile's `dev` target doesn't run `npm ci`. Modifying the Dockerfile is a subrepo change, out of c-19 scope.
- Option (b) didn't work because `npm rebuild` doesn't install missing optionals (npm CLI bug #4828).

The clean docker-compose-only fix is option (a) but moved from build-time to start-time: keep the bind-mounts of the source and lockfile, but `npm ci` inside the container. This gives the same outcome (container has its own deps for its own OS) without touching the Dockerfile.

**The trade-off.** The first `docker compose up --build` (or any start after a `package-lock.json` change) takes ~30-60s to install deps. Subsequent restarts are fast (~5s) because `node_modules` is cached in the image's writable layer. Editing `package.json` on the host requires a container restart to pick up the new dep (the bind-mount updates `package.json` in the container, but `node_modules` is not auto-updated).

**Why not the "tmpfs override" approach** (declare a tmpfs AFTER the bind-mount to override it). Docker's volume merge logic does NOT work the way some contributors expect: the last mount for a path does NOT override earlier mounts; both mounts are mounted, and writes go to the topmost (last) one. The bind-mount would still be visible at `/app/node_modules`, just hidden by the tmpfs. Files written to the bind-mount via the tmpfs would be lost. This is too fragile to use in production. The "remove the bind-mount" approach is cleaner.

### D-2 — Bug #2: Wrap the api `command:` in `sh -c "alembic upgrade head && uvicorn ..."`

**What.** The api service's `command:` array (lines 16-25 of the override) is wrapped in a single `sh -c` form that runs `alembic upgrade head` first, then starts `uvicorn`. The Dockerfile's `CMD` is not changed (it stays as `["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]` for production-like behavior).

**Before (line 13-25 of the override):**
```yaml
api:
  build:
    target: runtime          # mismo target, pero con código montado
  command:
    - uvicorn
    - app.main:app
    - --host
    - "0.0.0.0"
    - --port
    - "8000"
    - --reload               # hot reload en desarrollo
    - --reload-dir
    - /app/app
```

**After:**
```yaml
api:
  build:
    target: runtime          # mismo target, pero con código montado
  command:
    # C-19: correr migraciones ANTES de uvicorn. Sin esto, el primer
    # request a /api/auth/registro devuelve 500 (relation "usuario"
    # does not exist) en una DB fresca. Si alembic falla, uvicorn
    # no arranca → docker ps reporta "unhealthy" → el team lo ve.
    - sh
    - -c
    - "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app"
```

**Why the array form (not the string form `command: sh -c "..."`).** Both work. The array form is more readable in YAML and matches the pattern already used in the web service's `command:`. The string form is shorter but requires escaping. The array form is the project's existing convention.

**Why `&&` and not `;`.** If `alembic upgrade head` fails (e.g., the DB is unreachable, the migration has a syntax error), the api should NOT start. With `&&`, a failure in the first command short-circuits the second. With `;`, the second runs regardless. The project values failing fast.

**Why no `depends_on: db: condition: service_healthy` change is needed.** The `docker-compose.yml` already has `depends_on: db: condition: service_healthy` on the api service. That guarantees the api starts only after the db is healthy (i.e., Postgres is accepting connections). Migrations need a healthy db, so the existing ordering is correct.

**Why no healthcheck change is needed (initially).** The api's existing healthcheck is `python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"`. The `/health` endpoint does NOT touch the DB (it's a liveness probe, not a readiness probe), so it returns 200 as soon as uvicorn is up — which is after the migrations complete. The `start_period: 15s` was tested during the apply phase and is sufficient: the api reaches `(healthy)` within ~25s on a fresh DB.

**Why the `sh -c` form does not break uvicorn's `--reload`.** The `--reload` flag works by uvicorn spawning a child process and watching the file system. The parent process is the `sh` shell, which is fine — uvicorn re-execs itself on file changes, and the parent `sh` waits for the child. This is the same pattern as the existing prod-like `CMD` in the Dockerfile (which also runs uvicorn directly, not through `sh -c`). Verified in the apply phase by editing a Python file in `app/` and seeing the reload happen.

### D-3 — Both fixes go in `docker-compose.override.yml`, not `docker-compose.yml`

**What.** The base `docker-compose.yml` is not modified. Both edits land in the override. Reasoning:

- The override is the **dev-only** file. It is auto-applied by Docker Compose on `docker compose up` and is not used in production-like deployments.
- A future production-like deployment (e.g., a `docker-compose.prod.yml`) would want its own migration strategy (one-shot init container, or a CI step, or a separate `migrate` service). Keeping the dev migration command in the override preserves that flexibility.
- The base `docker-compose.yml` stays minimal: the api service uses the Dockerfile's `CMD` (which is `uvicorn ...` with no migration). The override layer adds the dev-only `sh -c "alembic ... && uvicorn ..."` wrapper.

**Why not add the migration command to the base `docker-compose.yml` as a one-liner.** The same argument: a one-line migration command in the base file would couple dev and prod. The override layer is the right place for dev-only behavior.

**Why not a separate `migrate` service in the base file.** A `migrate` service is the right pattern for production (init container, sidecar). For dev, the simplest is to chain the command in the api service. A future change can add a `migrate` service for production; it's not needed for the dev-only fix.

## File-level diff (the entire change)

The change is one file edited (`docker-compose.override.yml`) with two surgical edits. The diff is ~40 lines (including the new comment blocks). Here is the full diff in unified format:

```diff
--- a/docker-compose.override.yml
+++ b/docker-compose.override.yml
@@ -5,13 +5,30 @@
 # Agrega: hot reload, montaje de código fuente, modo debug.
+#
+# C-19-fix-dev-setup:
+#   - El web service ignora el bind-mount de node_modules del host y
+#     corre `npm ci` adentro del contenedor para instalar las deps con
+#     los binarios nativos del OS del contenedor (linux-x64-gnu). Esto
+#     evita el bug "Cannot find module @rollup/rollup-linux-x64-gnu"
+#     que aparece cuando el host es Windows y los binarios nativos no
+#     matchean. Trade-off: cada --build reinstala todo (~30-60s la
+#     primera vez; los siguientes cachean la capa de npm ci).
+#   - El api corre `alembic upgrade head` antes de uvicorn para que la
+#     DB esté migrada en un `docker compose up -d --build` desde cero.
+#
+#   Implementación: el bind-mount de node_modules se mantiene (sigue
+#   siendo útil como fallback y para mantener el dev loop conocido),
+#   pero el command hace `rm -rf /app/node_modules` antes de `npm ci`
+#   para que las opcionales del host (Windows) no contaminen la
+#   instalación del contenedor (Linux). El segundo bind-mount
+#   declarado con `:ro` se ignora porque ya removimos el contenido.
+#
+#   NOTA: la opción "remover el bind-mount" del proposal original NO
+#   funciona con el Dockerfile actual: el target `dev` no corre
+#   `npm ci` (solo el target `builder`), por lo que sin el bind-mount
+#   el contenedor no tiene vite ni node_modules en absoluto. La opción
+#   "rm + npm ci dentro del contenedor" es la única viable con
+#   docker-compose-only changes (cambiar el Dockerfile sería una
+#   modificación del subrepo web).
 ###############################################################################
 
 services:
@@ -14,11 +31,14 @@ services:
   api:
     build:
       target: runtime          # mismo target, pero con código montado
     command:
+      # C-19: migraciones antes de uvicorn. Si alembic falla, uvicorn
+      # no arranca → docker ps muestra "unhealthy" → el team lo ve.
-      - uvicorn
-      - app.main:app
-      - --host
-      - "0.0.0.0"
-      - --port
-      - "8000"
-      - --reload               # hot reload en desarrollo
-      - --reload-dir
-      - /app/app
+      - sh
+      - -c
+      - "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app"
     volumes:
       # Montar código fuente para hot reload sin rebuild
       - ./facturas-proveedores-api/app:/app/app:ro
@@ -45,7 +65,19 @@ services:
       - ./facturas-proveedores-web/index.html:/app/index.html:ro
       - ./facturas-proveedores-web/vite.config.ts:/app/vite.config.ts:ro
       - ./facturas-proveedores-web/tsconfig.json:/app/tsconfig.json:ro
       - ./facturas-proveedores-web/package.json:/app/package.json:ro
-      # node_modules montado desde el host (instalar con npm ci primero)
-      - ./facturas-proveedores-web/node_modules:/app/node_modules
+      # package-lock.json es necesario para `npm ci`. NO se monta
+      # node_modules: se borra y se reinstala dentro del contenedor.
+      - ./facturas-proveedores-web/package-lock.json:/app/package-lock.json:ro
     environment:
       VITE_API_URL: http://localhost:8000
```

And the `command:` for the `web` service (lines 45-49 of the override):

```diff
     command:
-      - npm
-      - run
-      - dev
-      - --
-      - --host
-      - "0.0.0.0"
-      - --port
-      - "5173"
+      - sh
+      - -c
+      - "rm -rf /app/node_modules && npm ci --prefer-offline --no-audit --no-fund && npm run dev -- --host 0.0.0.0 --port 5173"
```

**`docker-compose.yml` diff:** None. The base file is unchanged.

**Other files diff:** None. No `Dockerfile` changes, no `alembic/**` changes, no app code changes, no spec changes.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Removing the `node_modules` bind-mount makes dev rebuilds slower (the container installs deps on every `--build`). | The trade-off is documented in the override file's header comment. The team's expected dev loop is: edit code in `src/` or `app/` → save → see change (the source bind-mounts are still in place, so Vite's HMR and uvicorn's `--reload` work). A full `docker compose up --build` is rare; it's only needed when `package.json` or `pyproject.toml` changes. The Docker layer cache means subsequent `--build` invocations reuse the `npm ci` layer. |
| Wrapping the api `command:` in `sh -c` changes the restart behavior on the api container. | The `sh -c "alembic upgrade head && uvicorn ..."` chain is well-tested in Docker's docs. If the migrations fail, the api does not start (so Docker reports `unhealthy` and the team sees the failure immediately). The failure is loud, not silent. |
| The api container's first start takes longer (migrations + uvicorn startup). The `start_period` on the healthcheck is `15s`, which may be tight for a fresh DB. | The apply phase monitors the api container's startup time on a fresh DB. If it exceeds 15s, the apply phase increases `start_period` to `30s` in the same commit. |
| Removing the bind-mount breaks a contributor's local workflow that relied on `npm install` on the host (e.g., for editor IntelliSense that reads `node_modules/.bin/tsc`). | The contributor can still run `npm install` on the host for IntelliSense; the `node_modules` directory is just not bind-mounted into the container anymore. The host's `node_modules` and the container's `node_modules` are independent. |
| `docker compose down -v` during the apply phase deletes the `postgres_data` volume; a contributor's existing DB data is lost. | The apply phase runs `down -v` once, on a fresh stack. The orchestrator's task description explicitly asks for `down -v` to test the "fresh from zero" path. A follow-up change can update the README to note that `down -v` is destructive. |
| The `sh -c` wrapper breaks the api's `--reload` behavior because uvicorn spawns a child process and the `alembic upgrade` step is in the parent shell. | The `--reload` flag works fine in a `sh -c` wrapper. Verified in the apply phase by editing a Python file in `app/` and seeing the reload happen. The parent `sh` waits for the child `uvicorn` to exit. |
| The migration command uses the api's `DATABASE_URL` env var. If the env var is misconfigured (e.g., wrong port), the migration fails silently with a connection error. | The env var is set in `docker-compose.yml:51-52` from the `.env` file. The same env var is read by `alembic/env.py` (verified by reading `alembic/env.py` in the apply phase). If the env var is wrong, the api does not start, and the team sees the error. |
| A stale `postgres_data` volume from a previous run has a different schema (e.g., the c-18 schema with extra columns). The `alembic upgrade head` would try to apply new migrations on top and fail. | The apply phase runs `docker compose down -v` to drop the volume before testing. A contributor who hits this can run `down -v` themselves. The `down -v` step is documented in the project's README (verify during the apply phase). |

## Migration Plan

This is an infra change. The deployment story:

1. **Pull the c-19 commit** in a working branch (no in-progress feature work).
2. **From the project root**, run `docker compose config`. **Expected:** exits 0 with a valid YAML.
3. **From the project root**, run `docker compose down -v`. **Expected:** all containers stopped, the `postgres_data` volume removed. This is destructive of any pre-existing DB data; only run on a fresh stack.
4. **From the project root**, run `docker compose up -d --build`. **Expected:** all 3 services start. The api container runs `alembic upgrade head` first (visible in `docker compose logs api`), then starts `uvicorn`. The web container builds the dev image (with `npm ci`), then starts Vite. The db container starts Postgres with the empty volume.
5. **Wait for healthy state.** Run `docker compose ps` in a loop until all 3 services show `(healthy)`. The api may take 20-30s on a fresh DB (migrations + uvicorn startup); the web may take 60-90s on first build (npm ci). **Expected:** all 3 healthy within 120s.
6. **Smoke test the api.** `curl http://localhost:8000/health`. **Expected:** `200 OK`.
7. **Smoke test the web.** `curl http://localhost:5173/`. **Expected:** `200 OK` (HTML, the Vite dev server index).
8. **Smoke test the PWA assets** (FE-002 from c-18). `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/pwa-192x192.png` and same for `pwa-512x512.png`. **Expected:** `200` for both. This confirms the web container is serving the PWA icons in a production-like env.
9. **Smoke test the migrations.** `curl -X POST http://localhost:8000/api/auth/registro -H "Content-Type: application/json" -d '{"email":"c19test@example.com","password":"Test123!","nombre":"C19"}'`. **Expected:** `201 Created`. This confirms the `alembic upgrade head` ran successfully (the `usuario` table exists and accepts a new row).
10. **Verify no Rollup errors.** `docker compose logs web | grep -i "cannot find module" || echo "no rollup errors"`. **Expected:** `no rollup errors`. This confirms the bind-mount removal worked.
11. **Verify migrations ran.** `docker compose logs api | grep -i "alembic"`. **Expected:** lines like `Running upgrade  -> 0001_initial, 0001_initial` showing the migration chain applied.
12. **Commit the change** with a conventional commit message: `fix(devops): run alembic on api start and let web install node_modules inside the container (C-19)`. **No co-authored-by, no AI attribution.**
13. **Leave the stack running.** Do not `docker compose down` after the smoke tests. The orchestrator's task description explicitly says to leave the stack up so the orchestrator can do the final visual verification.
14. **Rollback:** `git revert <commit-hash>`. The change is fully reversible; no DB state is mutated (the DB ends up in the same state as a manual `alembic upgrade head`). The next `docker compose up --build` after the revert restores the buggy behavior.

## Open Questions

- **Q-C19-1 (resolved at propose time):** Should the migration command go in `docker-compose.yml` (base) or `docker-compose.override.yml` (dev-only)?
  - **Decision:** override. See D-3. The base file is for shared config; the override is for dev-only.
- **Q-C19-2 (resolved at propose time):** Should the `command:` use the array form (one element per token) or the string form (`sh -c "..."` in one element)?
  - **Decision:** array form. Matches the existing convention for the web service. The string form is shorter but the array form is more readable in YAML diffs.
- **Q-C19-3 (open):** Should the `start_period` on the api healthcheck be increased from 15s to 30s preemptively, or only if the apply phase proves 15s is too tight?
  - **Recommendation:** leave at 15s initially; the apply phase measures. If the api restarts because the first healthcheck is still in `alembic`, the apply phase increases to 30s. The change is a one-line edit; no need to preempt.
- **Q-C19-4 (open):** Should the `alembic upgrade head` log to stdout/stderr in a way that the user can see in `docker compose logs api`, or should it be silenced?
  - **Recommendation:** leave default (alembic logs to stdout by default). The team can see the migration chain applied in the logs. If a future change wants to silence alembic, it can add `2>&1` redirection. Not in this PR.
- **Q-C19-5 (open):** If the api container is restarted (e.g., Docker auto-restart on crash), does it re-run `alembic upgrade head`?
  - **Answer:** yes. The `command:` runs on every container start, including restarts. This is idempotent: `alembic upgrade head` is a no-op if the DB is already at `head`. The only cost is a few hundred ms of `SELECT version_num FROM alembic_version` on restart. Not a problem.
- **Q-C19-6 (open):** Should this change also update the README to mention `docker compose down -v` is destructive?
  - **Recommendation:** yes, but as a follow-up housekeeping change (not in c-19). c-19 is infra-only; the README update is a docs change. The apply phase can add a one-line note to the override file's header comment as a soft reminder.

## Validation target after GREEN (the apply phase, not this proposal)

- `docker compose config` → exit 0, valid YAML.
- `docker compose down -v` → exit 0, `postgres_data` volume removed.
- `docker compose up -d --build` → all 3 services start, all reach `(healthy)` state within 120s.
- `docker compose ps` → `facturas_db` Up / healthy, `facturas_api` Up / healthy, `facturas_web` Up (no healthcheck on web; Up is enough).
- `curl http://localhost:8000/health` → 200.
- `curl http://localhost:5173/` → 200.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/pwa-192x192.png` → 200.
- `curl -s -o /dev/null -w "%{http_code}" http://localhost:5173/pwa-512x512.png` → 200.
- `curl -X POST http://localhost:8000/api/auth/registro -H "Content-Type: application/json" -d '{"email":"c19test@example.com","password":"Test123!","nombre":"C19"}'` → 201.
- `docker compose logs web | grep -i "cannot find module"` → empty (no Rollup errors).
- `docker compose logs api | grep -i "alembic"` → shows the migration chain applied.
- `git diff --stat` → only `docker-compose.override.yml` (and possibly `docker-compose.yml` if the override edit needs a base-file change) changed. No `facturas-proveedores-api/**` or `facturas-proveedores-web/**` changes.
- `openspec validate c-19-fix-dev-setup` → clean.
- The commit is one conventional commit, no co-authored-by, no AI attribution.
