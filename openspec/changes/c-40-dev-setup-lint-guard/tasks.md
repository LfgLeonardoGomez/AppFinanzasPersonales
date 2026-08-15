# Tasks: c-40-dev-setup-lint-guard

> **This change writes no production code.** The only file modified is `docker-compose.override.yml`. Everything else is measurement and verification.
>
> **Do not fix lint errors.** The measured baseline is 0 errors / 0 warnings across 206 files. If the container run surfaces anything the host did not, that is a finding to **report**, not to patch — see task 5.3.
>
> **Strict TDD note:** the tests for this change already exist and already pass on the host (`tests/frontend-lint.test.ts`, `tests/design-system-guard.test.ts`). The RED state is environmental, not code-level: the guards do not currently execute in the container. Task 1 captures that RED baseline, task 3 turns it GREEN, and task 4 proves the guards genuinely fail when they should — which is this change's equivalent of triangulation. No new test files are written.

## 1. Capture the RED baseline (before any edit)

- [x] 1.1 Confirm the working tree is clean and record the current commit SHA, so the baseline numbers are attributable to a known state.
- [x] 1.2 Confirm the `web` container's file surface lacks both paths: `docker exec facturas_web ls -a /app` SHALL NOT list `eslint.config.js` or `tests`.
- [x] 1.3 Confirm `npm run lint` fails inside the container with `ESLint couldn't find an eslint.config.js file.` Record the exact output.
- [x] 1.4 Run the full container suite and record the baseline: expected **92 files / 703 tests passed**. If the numbers differ from the proposal's recorded baseline, STOP and report the discrepancy before editing anything — the acceptance criterion is a delta against this number.
- [x] 1.5 Record the host-side baseline for comparison: `npm run lint` exits 0 with 0 errors and 0 warnings, and `npx vitest run tests/` reports 2 files / 3 tests passing.

## 2. Verify the root cause is structural

- [x] 2.1 Confirm the `dev` target of `facturas-proveedores-web/Dockerfile` contains no `COPY` instruction, so `/app` equals the mount set plus the container-installed `node_modules`. This is what makes the omission permanent rather than a stale-image artifact, and it is the premise of the `project-foundation` delta.
- [x] 2.2 Confirm `node_modules` IS present in the container (installed by the `npm ci` in the service `command:`), so the lint guard will execute rather than hit its `skipIf` branch.

## 3. Apply the mount fix

- [x] 3.1 Add `- ./facturas-proveedores-web/eslint.config.js:/app/eslint.config.js:ro` to the `web` service's `volumes:` block in `docker-compose.override.yml`.
- [x] 3.2 Add `- ./facturas-proveedores-web/tests:/app/tests:ro` to the same block.
- [x] 3.3 Add an inline comment on both entries stating why each is required: without the config, `npm run lint` cannot resolve it inside the container; without the directory, the regression-guards are never collected.
- [x] 3.4 Extend the file's header comment with the mount contract required by the `project-foundation` delta: the `dev` target performs no `COPY`, `/app` is exactly the mount set plus container-installed `node_modules`, and **any new path a quality gate reads must be added to `volumes:` or it will be invisible in the container**. Note that volume changes require `docker compose up -d` (recreate), not `restart`.
- [x] 3.5 Verify no other mount was altered — in particular, confirm the `node_modules` bind-mount is still absent and no whole-directory mount of `facturas-proveedores-web/` was introduced (this would reintroduce the C-19 native-binary crashloop).
- [x] 3.6 Recreate the container with `docker compose up -d` and confirm it reaches a running state.

## 4. Prove the guards are live, not merely collected

- [x] 4.1 Confirm `/app/eslint.config.js` and `/app/tests` now exist in the container, and that `ls /app/tests` lists both test files.
- [x] 4.2 Run `npm run lint` inside the container. Expect **exit 0** with no errors and no warnings, matching the host.
- [x] 4.3 Run the full container suite. Expect **94 files / 706 tests passed**. Confirm the three new tests report as **passed**, not **skipped** — a skipped lint guard would still raise the file count while asserting nothing, which is the exact failure mode being fixed.
- [x] 4.4 Negative check for the lint guard: temporarily introduce a deliberate lint violation in a file under `facturas-proveedores-web/src/` (for example an unused variable that `@typescript-eslint/no-unused-vars` rejects), run the container suite, and confirm it goes **red naming `tests/frontend-lint.test.ts`**. **Revert the violation** and confirm the suite returns to 706 passed.
- [x] 4.5 Negative check for the design-system guard: temporarily add a hardcoded hex color to a file under `src/features/ventas/`, run the container suite, confirm `tests/design-system-guard.test.ts` fails and names the offending file, then **revert** and confirm green.
- [x] 4.6 Confirm the working tree contains no leftovers from tasks 4.4 and 4.5 — `git status` SHALL show only `docker-compose.override.yml` as modified.

## 5. Confirm the near-zero scope and report anything that contradicts it

- [x] 5.1 Confirm no file under `facturas-proveedores-web/src/` was modified by this change. The measured baseline is 0 lint errors and 0 warnings; there is nothing to fix.
- [x] 5.2 Confirm no test file was modified. Both guards pass unmodified.
- [x] 5.3 If the container lint run diverged from the host in any way, do NOT fix it. Record the divergence — rule, file, message, and the host-vs-container difference — and surface it as a finding for review, since deciding whether the fix belongs in this change is a reviewer's call, not the apply phase's.
- [x] 5.4 Record the measured suite-runtime delta (baseline was 116s; the lint guard adds roughly 13s) so the accepted cost is documented against a real number rather than an estimate.

## 6. Close out

- [x] 6.1 Update the C-40 entry in `CHANGES.md`: mark it done, and replace the "alcance real desconocido" risk note with the measured outcome (0 lint errors, 0 warnings, both guards passing unmodified, suite 92→94 files / 703→706 tests). The entry's stated unknown is now resolved and should not be left implying otherwise.
- [x] 6.2 Correct the stale figure in the same entry: it states the container suite runs 72 files, which was true when the debt was recorded during C-30. The measured figure at the time of this change is 92.
- [x] 6.3 Add a note to `knowledge-base/09_decisiones_y_supuestos.md` under D-24 recording that the C-20 guard was inert in the container from its creation until this change, and that the container mount list is now a documented contract. D-24 currently reads as though the guard had been enforcing the baseline all along.
- [ ] 6.4 Commit with a conventional-commit message scoped to the dev environment (single commit; no co-authorship trailer). Do not push unless asked. **NOT EXECUTED — the launching orchestrator explicitly instructed "DO NOT commit, DO NOT push" for this apply run. Working tree left uncommitted and ready for review/commit by the user or a follow-up step.**
- [x] 6.5 Recommend the two deferred sibling items to the user as follow-up roadmap entries: (a) wiring CI and/or git hooks, which do not exist at all in this repo and would also give `npm run typecheck` somewhere to run; (b) widening `tsconfig.json`'s `include` so `tests/` is type-checked. Note that C-40 should precede both.
