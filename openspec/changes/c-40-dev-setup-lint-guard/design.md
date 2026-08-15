# Design: c-40-dev-setup-lint-guard

## Context

The `web` service's file surface inside the container is defined **entirely** by the `volumes:` block of `docker-compose.override.yml`. The `dev` target of `facturas-proveedores-web/Dockerfile` is a bare `node:20-slim` with `WORKDIR /app` and no `COPY` instruction; only the `builder` target copies source. Nothing else contributes files, so a path absent from the mount list is absent from the container, permanently. Verified on the running container:

```
$ docker exec facturas_web ls -a /app
.  ..  index.html  node_modules  package-lock.json  package.json
public  src  tsconfig.json  vite.config.ts
```

Two paths that the frontend quality gates need are missing: `eslint.config.js` and `tests/`. Measured consequences on `HEAD` (2026-08-14):

| Check | Host | Container |
|---|---|---|
| `npm run lint` | exit 0 — 206 files, 0 errors, 0 warnings | fails: `ESLint couldn't find an eslint.config.js file.` |
| Suite | 94 files | **92 files / 703 tests, 116s** |
| `tests/frontend-lint.test.ts` | passes (13.1s) | **never collected** |
| `tests/design-system-guard.test.ts` | passes (2 tests) | **never collected** |

The important constraint for the design: **the codebase is already clean.** There is no lint debt to pay down. This is not a remediation change, it is a wiring change. That shifts the design question from "how do we absorb the fallout" to "how do we connect the gate and make sure it cannot silently disconnect again".

C-19 established the surrounding contract (`project-foundation`, requirement "Dev environment is liftable with a single `docker compose up`") and the convention that the override's header comment documents dev-only behavior and its trade-offs. This change extends that contract rather than inventing a parallel one.

## Goals / Non-Goals

**Goals:**

- `npm run lint` runs successfully inside the `web` container.
- Both files under `facturas-proveedores-web/tests/` are collected and pass in the container suite.
- The container suite goes from 92 files / 703 tests to **94 files / 706 tests**, with no previously-passing test turning red.
- The mount list is documented as a **contract** — every path a quality gate reads must be mounted — so the next guard added under `tests/`, or the next root-level config file, does not silently fall into the same hole.
- The spec records that the guard must hold in the containerized environment, not only on a host checkout.

**Non-Goals:**

- **Fixing lint errors.** There are none (0 errors, 0 warnings across 206 files, measured). If the container run somehow surfaces something the host did not, that is a finding to report, not to silently patch.
- **Changing `eslint.config.js`, its rule set, or the `lint` script.** The D-24 baseline stays exactly as C-20 left it.
- **Changing either guard test.** Both pass unmodified.
- **Widening `tsconfig.json`'s `include` to cover `tests/`.** Real gap (neither guard file has ever been type-checked), separate decision, own fallout under `exactOptionalPropertyTypes` / `noUncheckedIndexedAccess`.
- **CI or git hooks.** No `.github/`, no `.husky/`, no `lint-staged` exist. Sibling change; see the proposal.
- **Touching the `api` service or the `builder`/`production` Docker targets.**
- **Modifying `facturas-proveedores-web/Dockerfile`.** See Decision 2.

## Decisions

### Decision 1 — Mount the two paths in the override, read-only

```yaml
- ./facturas-proveedores-web/eslint.config.js:/app/eslint.config.js:ro
- ./facturas-proveedores-web/tests:/app/tests:ro
```

Read-only matches every other mount in the block and is correct here: ESLint never writes its config, and Vitest never writes test sources. Individual-file mount for `eslint.config.js` matches the existing precedent in the same block (`vite.config.ts`, `tsconfig.json`, `package.json` are all mounted as single files).

*Alternative considered — mount the whole `facturas-proveedores-web/` directory at `/app`.* Rejected: it would shadow `/app/node_modules` with the host's Windows-native `node_modules`, re-introducing the exact `Cannot find module @rollup/rollup-linux-x64-gnu` crashloop that C-19 fixed. The selective mount list exists precisely to avoid that, and this change must not undo it. It would also drag in `dist/` and the `Rediseño de app de finanzas` directory.

*Alternative considered — a named volume or an anonymous-volume exclusion for `node_modules` plus a whole-directory mount.* Rejected as over-engineering for two paths, and it would still change the C-19 behavior that is currently working and specified.

### Decision 2 — Fix it in the override, not in the Dockerfile

Adding `COPY . .` to the `dev` target would also put the files in the container, but the source would be **baked at build time**: editing a test on the host would not change what runs until a rebuild. That breaks the hot-reload contract the rest of the mount list provides, and creates a silent staleness failure mode that is *worse* than the current one, because the file would appear present and simply be out of date.

Additionally, `facturas-proveedores-web/` is a subrepo (the projects live in separate repos per the project's own conventions), and C-19 already established the precedent of solving dev-environment problems with compose-only changes for exactly this reason.

### Decision 3 — The mount list is a contract, and the header comment says so

The root cause is not "two paths were forgotten". It is that **nothing tells a contributor the mount list must be extended when a quality gate is added.** C-34 added `tests/design-system-guard.test.ts` and inherited the invisibility without anyone noticing, which is the same bug happening a second time.

The header comment gains a short block stating: the `dev` target copies nothing, `/app` is exactly the mount set, and any new path a quality gate reads (root-level config, new test directory) must be added to `volumes:`. This mirrors how C-19 documented its own trade-offs in the same file and is what the `project-foundation` delta will require.

*Alternative considered — an automated guard test asserting mount/host parity.* Rejected for this change. A test that shells out to `docker` from inside the container it is testing is circular, environment-fragile, and would have to be skipped in most contexts — the same class of "guard that does not guard" this change exists to eliminate. The design-system guard's latent weakness (Risk 3) is the honest residual, and it is recorded rather than papered over with a test that cannot run.

### Decision 4 — Verify against the exact recorded baseline, and verify the guard actually fails when it should

Acceptance is a numeric delta, not "the suite looks green": **92 → 94 files, 703 → 706 tests.** The before-numbers are recorded above from a real run.

Beyond that, the change must prove the guard is *live*, not merely *collected*. A collected-but-vacuous test is the failure mode being fixed, so it must not be re-introduced in a subtler form. The verification therefore includes a **temporary, reverted** negative check: introduce a deliberate lint violation in a `src/` file, confirm the container suite goes red naming the lint guard, then revert it and confirm green again. Same for the design-system guard, using a hardcoded hex color in a `src/features/ventas` file.

This is the one step that distinguishes "the file is now collected" from "the file now guards something", and it is cheap.

### Decision 5 — Accept the ~13s suite cost, and do not optimize it

`frontend-lint.test.ts` spawns a full ESLint run via `execSync` (13.1s measured on the host). The container suite currently takes 116s, so this is roughly a 10% increase.

Accepted as-is. Optimizations (running lint once outside the suite, caching, `--cache`) all move the gate further from "runs when you run the tests", which is the property being bought. A 13s guard that runs beats an instant guard that does not.

Note the guard is already written to `skipIf(!existsSync(nodeModulesPath))`. In the container `node_modules` is installed by the `npm ci` in the `command:`, so it will execute rather than skip — but the apply phase must confirm this explicitly, because a silent skip would look identical to a pass in the summary line and would leave the change *appearing* done while changing nothing.

## Risks / Trade-offs

**Risk 1 — The guard could be collected but silently skipped in the container.** `frontend-lint.test.ts` uses `it.skipIf(!existsSync('/app/node_modules'))`. If the mount or start-up ordering left `node_modules` missing, the test would report as skipped and the file count would still rise to 94, mimicking success while guarding nothing.
→ **Mitigation:** the acceptance criterion is `706 passed`, not `94 files`. A skip shows as `705 passed | 1 skipped` and fails the criterion. Decision 4's negative check confirms it independently.

**Risk 2 — Lint could behave differently inside the container than on the host.** Different OS, and `node_modules` installed by a separate `npm ci`.
→ **Mitigation:** the rule set has no OS-dependent rules and both sides resolve the same `package-lock.json` and the same ESLint v9.39.5. If a divergence appears anyway, it is a genuine finding: **report it, do not silently fix it.** Determining whether the fix belongs in this change is a decision for the reviewer, not for the apply phase.

**Risk 3 — The design-system guard's config scan stays mount-dependent.** It probes for `tailwind.config.js` / `postcss.config.*` at the project root. Neither exists today (Tailwind v4 runs through the Vite plugin), so the guard is correct now. But if a future change adds one at the web root without mounting it, the container guard would see nothing and pass vacuously.
→ **Mitigation:** Decision 3's documented mount contract. This is a residual, honestly recorded, not eliminated.

**Risk 4 — Contributors on an already-running stack will not pick up the new mounts.** Volume changes require `docker compose up -d` (recreate), not a `restart`.
→ **Mitigation:** the verification steps start from a recreate, and the header comment notes it.

**Risk 5 — C-41 lands first and pushes a lint-breaking generated file.** `eslint.config.js` ignores the exact path `src/shared/api/api.d.ts`; that file emits **6 errors** (`@typescript-eslint/no-empty-object-type`) when linted. C-41's planned `api.generated.d.ts` is not covered by that exact-path ignore.
→ **Mitigation:** land C-40 first (recommended in the proposal). Then C-41 hits the guard and must consciously extend the ignore list or keep the file clean, instead of regressing invisibly.

**Trade-off accepted:** two extra bind-mounts make the `web` service definition slightly longer and keep the "enumerate every path" maintenance burden that Decision 1 declines to remove. That burden is the price of the C-19 `node_modules` fix, and this change pays it explicitly and documents it rather than trading it for a regression.

## Migration Plan

Not a data migration; a dev-environment change with no production path (`docker-compose.override.yml` is dev-only).

1. Record the current baseline: container suite `92 files / 703 tests`.
2. Edit `docker-compose.override.yml` (two mounts + header comment).
3. `docker compose up -d` to recreate the `web` container so the new volumes take effect.
4. Confirm `/app/eslint.config.js` and `/app/tests` exist in the container.
5. Run `npm run lint` in the container → expect exit 0.
6. Run the full container suite → expect `94 files / 706 tests` passing, zero skipped among the three new tests.
7. Run the negative check from Decision 4, then revert it.

**Rollback:** revert the single commit and `docker compose up -d`. No state, no schema, no data. The container returns to the previous mount set.

## Open Questions

None blocking. Two questions are deliberately deferred, both recorded in the proposal as out of scope:

1. Should `tsconfig.json`'s `include` cover `tests/` so the guard files are type-checked? (Today they never have been.)
2. Should CI run these gates on push/PR, and should `npm run typecheck` become a gate at the same time? (Nothing runs automatically today.)

Both are sibling changes. Neither blocks C-40, and C-40 should precede both — automating a gate is only worth doing once the gate is known to work in the environment that would run it.
