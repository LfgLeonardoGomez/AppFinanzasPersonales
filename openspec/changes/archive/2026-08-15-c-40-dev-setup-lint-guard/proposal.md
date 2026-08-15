# Proposal: c-40-dev-setup-lint-guard

## Why

`docker-compose.override.yml` bind-mounts only part of `facturas-proveedores-web/` into the `web` service. Two paths the quality gates depend on are missing: `eslint.config.js` and `tests/`. The consequences were measured on the running container, not estimated:

1. **`npm run lint` cannot run inside the container.** It fails with `ESLint couldn't find an eslint.config.js file.` This is pre-existing and reproduces on clean `HEAD`.
2. **`tests/frontend-lint.test.ts` has never executed.** It is the regression-guard C-20 wrote to lock `npm run lint` at exit 0 (D-24), and the `frontend-lint-baseline` spec explicitly requires that it "SHALL run as part of `npm test` and SHALL fail the suite if the lint command fails". Because the directory is not mounted, the container suite collects 92 files from `src/` and that file is not among them. **A guard that exists in the repo and guards nothing.**
3. **`tests/design-system-guard.test.ts` (added by C-34, archived 2026-08-14) has the same problem.** It lives in the same unmounted directory and has therefore also never executed in the container.

The roadmap entry flagged the real scope as unknown until the guards were run. **It has now been measured, and it is near-zero.** See the table below. This proposal exists so the fix can be approved against real numbers instead of against an unknown.

### Measured baseline (2026-08-14, on `HEAD`)

| Measurement | Result |
|---|---|
| `npm run lint` on the **host** | **exit 0** — 206 files linted, **0 errors, 0 warnings** (ESLint v9.39.5) |
| `npx vitest run tests/` on the **host** | **2 files, 3 tests, all passing** (`frontend-lint` 13.1s, `design-system-guard` ×2) |
| `npm run lint` **inside `facturas_web`** | fails — `ESLint couldn't find an eslint.config.js file.` |
| Full container suite (`npx vitest run` in `facturas_web`) | **92 files, 703 tests, all passing**, 116s |
| Test files visible on the host (`src/` + `tests/`) | **94** |
| **Invisible to the container suite** | **2 files / 3 test cases** |

Expected after the fix: **94 files / 706 tests**. That delta is the acceptance criterion.

**No lint debt accumulated since C-20.** The `--max-warnings 0` flag gates warnings as failures, and there are zero of both. The two guards pass today, unmodified. This change is therefore pure dev-environment infrastructure: mount the two paths, run the guards for the first time, and lock the parity so the hole cannot silently reopen.

### Root cause

The `dev` target of `facturas-proveedores-web/Dockerfile` is a bare `node:20-slim` with `WORKDIR /app` and **no `COPY` instruction at all** (only the `builder` target copies source). The container's `/app` therefore contains *exactly* the override's mount set plus the `node_modules` installed by the `npm ci` in the `command:`. Verified:

```
$ docker exec facturas_web ls -a /app
.  ..  index.html  node_modules  package-lock.json  package.json
public  src  tsconfig.json  vite.config.ts
```

This is structural, not a stale-image problem: any path absent from the `volumes:` block is absent from the container, permanently. The mount list is the complete definition of the container's file surface, which is why it must be treated as a contract rather than as a convenience.

## What Changes

- Add two bind-mounts to the `web` service in `docker-compose.override.yml`:
  - `./facturas-proveedores-web/eslint.config.js:/app/eslint.config.js:ro`
  - `./facturas-proveedores-web/tests:/app/tests:ro`
- Run both guards inside the container for the first time and confirm they pass there, matching the host result.
- Confirm the container suite rises from **92 files / 703 tests** to **94 files / 706 tests**, with no pre-existing test turning red.
- Document the mount contract in the file's header comment: the `dev` target copies nothing, so **every path a quality gate reads must be mounted explicitly**, including any future root-level config file. This is what stops the same hole from reopening the next time a guard is added.
- No production code changes. No lint fixes — **there is nothing to fix** (0 errors, 0 warnings measured).

### Known cost

Mounting `tests/` adds `frontend-lint.test.ts` to the container suite, and that test spawns a full ESLint run as a child process: **~13s** measured on the host. This is a real and permanent addition to every container suite run, accepted deliberately — a 13s guard that runs is worth more than an instant guard that does not.

## Capabilities

### New Capabilities

None. This is a dev-environment configuration fix. The behavior it protects is already specified; it simply was not enforced in the containerized environment.

### Modified Capabilities

- `project-foundation`: adds a requirement that the `web` service's bind-mount set covers every path the frontend quality gates read (currently `eslint.config.js` and `tests/`), because the `dev` Docker target copies no source. Extends the existing dev-environment contract established by C-19.
- `frontend-lint-baseline`: the existing requirement that the guard "SHALL run as part of `npm test`" is strengthened to hold **in the containerized dev environment**, not only on a host checkout. Today the requirement is satisfied on the host and silently violated in the container, which is the environment the project actually runs the suite in.

## Impact

| Area | Impact | Description |
|---|---|---|
| `docker-compose.override.yml` | Modified | Two `:ro` bind-mounts added to the `web` service; header comment documents the mount contract. Only file changed. |
| `facturas-proveedores-web/tests/frontend-lint.test.ts` | Unchanged, newly executed | Passes on host today. Expected to pass in the container once `eslint.config.js` is mounted. |
| `facturas-proveedores-web/tests/design-system-guard.test.ts` | Unchanged, newly executed | Passes on host today. Both assertions read paths that are already mounted (`vite.config.ts`, `src/features/**`). |
| `facturas-proveedores-web/eslint.config.js` | Unchanged | Mounted read-only; ESLint never writes to it. |
| `facturas-proveedores-web/src/**` | Unchanged | 0 lint errors, 0 warnings measured. Nothing to fix. |
| Container suite runtime | +~13s | The lint guard spawns a full ESLint run. Accepted trade-off. |
| Backend | Untouched | No `api` service change. |

### Findings surfaced but deliberately NOT fixed here

These were discovered while measuring. They are recorded so they are not lost, and explicitly left out of scope:

- **`tests/` is not type-checked, even on the host.** `tsconfig.json` has `include: ["src", "vite.config.ts"]`, so `npm run typecheck` has never covered either guard file. Widening the `include` is a separate decision with its own fallout (`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on).
- **The design-system guard's config scan is mount-dependent.** It probes for `tailwind.config.js` / `postcss.config.*` at the project root. Neither exists today (Tailwind v4 runs through the Vite plugin), so the guard is correct now. But if a future change adds one at the web root **and does not mount it**, the container guard would silently see nothing. This is precisely the failure mode C-40 is fixing, which is why the mount contract is documented rather than just the two paths added.

## Relationship to other work

### C-41 `api-types-generated` — real collision, worth ordering deliberately

Both changes touch `facturas-proveedores-web`, but **not the same files**: C-40 touches only `docker-compose.override.yml`. There is no merge conflict. There is, however, a **semantic collision**:

`eslint.config.js` ignores the exact path `src/shared/api/api.d.ts` — not a glob. Measured: if that file were linted, it would emit **6 errors** (`@typescript-eslint/no-empty-object-type`). C-41 plans to introduce `api.generated.d.ts`, which the exact-path ignore does **not** cover, so it would be linted and is likely to produce the same class of errors from `openapi-typescript` output.

**Recommendation: C-40 first.** Today the guard does not run, so C-41 could land a lint-breaking generated file and the container suite would stay green. With C-40 landed, C-41 is forced to either extend the ignore list or keep the generated file lint-clean — a deliberate decision instead of an invisible regression. This is the guard doing exactly the job it was written for, on its first real workload.

### CI and git hooks — a sibling change, not this one

**Out of scope, and stated explicitly so the gap is not mistaken for an oversight.** This repo has **no CI and no git hooks**: no `.github/`, no `.husky/`, no `lint-staged`. `npm run typecheck` (`tsc --noEmit`) exists in `package.json` and is wired to nothing at all.

C-40 makes the guards run **when someone runs the suite**. It does not make anything run **automatically on push or PR**. Those are complementary, and the ordering matters: automating a gate is only useful once the gate is known to work in the environment that would run it. **C-40 should come first**; a follow-up change should then wire CI, and that change is the natural place to also decide whether `typecheck` becomes a gate. Recommend filing it as a separate roadmap entry.

### Governance

**BAJO.** Single dev-only configuration file, no production path, no business rule, no database, no auth surface. Fully reversible by reverting one commit. The measured scope confirms the low rating: nothing to fix, only something to connect.
