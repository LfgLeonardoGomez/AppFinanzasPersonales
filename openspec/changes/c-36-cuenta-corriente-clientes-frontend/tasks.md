> **Strict TDD is active.** Every task below that produces behaviour is written as the behaviour its test must pin. Write the test first (RED), the minimum code to pass it (GREEN), a second case with different inputs (TRIANGULATE), then clean up (REFACTOR). Test command: `cd facturas-proveedores-web && npm test`.
>
> **`npm test` is NOT a type gate.** Vitest transpiles through esbuild, which strips types without checking them — a compile-time type assertion passes even when it is wrong (learned in C-34). `npm run typecheck` (`tsc --noEmit`) is the only gate for anything type-level, and it has its own task in section 12. Do not treat a green test run as evidence that the types are right.
>
> **Do NOT run `npm run generate-types`.** `src/shared/api/api.d.ts` is hand-written; regenerating it rewrites the file into the `openapi-typescript` shape and breaks every named import. Types for this change are added by hand (design.md D9). Migrating to generated types is C-41.
>
> **The backend under `facturas-proveedores-api/` is read-only for this change.** C-43 Fase A is working there concurrently in an isolated worktree. Do not edit, do not run its migrations, do not touch it.
>
> **No idempotency here.** Do not import `@shared/api/idempotency`, do not send an `Idempotency-Key`. That is C-43 Fase B. Section 5 exists to make that a two-line change; see design.md D7.

## 1. Safety net

- [x] 1.1 Run `cd facturas-proveedores-web && npm test` and record the baseline in the apply report: `{N} tests passing across {M} files`. Any failure at this point is **pre-existing** — report it, do not fix it here.
- [x] 1.2 Note the one known flaky test and do **not** attempt to fix it: `src/features/ia-vision/PropuestaIAModal.e2e.test.tsx`'s Retry-After countdown assertion fails intermittently under full-suite load. If it is the only failure, the baseline stands.
- [x] 1.3 Run `npm run typecheck` and `npm run lint` and record both as clean before touching anything. A pre-existing type or lint error found later is otherwise indistinguishable from one this change introduced.

## 2. Types (hand-written, no codegen)

- [x] 2.1 Add to `src/shared/api/api.d.ts`, as **one contiguous block under its own section header** (design.md risk: C-43 appends to this same file), in the style of the types already there: `MetodoCobro`, `EstadoVentaFiada`, `EntradaHistorialClienteTipo`, `VentaConEstado`, `EntradaHistorialCliente`, `CuentaCorrienteClienteResponse`, `CobroCliente`, `CobroClienteCreate`.
- [x] 2.2 Ledger-read amounts (`saldo`, `VentaConEstado.monto`, `EntradaHistorialCliente.monto` / `saldo_acumulado`) typed `number` — parsed at the boundary, exactly like `CuentaCorrienteResponse`. Cobro-write amounts (`CobroCliente.monto`, `CobroClienteCreate.monto`) typed `string` — raw wire, exactly like `Venta.monto`. Document the asymmetry in a comment at the block header; it is deliberate (design.md D9) and will otherwise read as an oversight.
- [x] 2.3 Test: `MetodoCobro` is neither `MetodoPago` nor `FormaPago` — assert `TARJETA` is a valid `MetodoCobro` and that `MERCADOPAGO` and `CUENTA_CORRIENTE` are not, mirroring `src/shared/api/api.pagos.test.ts`. Rationale in the test: money coming in from a customer has no MercadoPago-to-supplier path, and debt is not cancelled with debt.
- [x] 2.4 Test: `EstadoVentaFiada` contains `COBRADA` and **not** `PAGADA` — a customer's sale reported as "paid" reads as though the shop had paid it (C-35's stated reason).
- [x] 2.5 Test: `CobroClienteCreate` has no `venta_id`, no `negocio_id` and no `creado_por_usuario_id` key. RN-CCC-03 plus session-derived ownership — the backend's `extra="forbid"` would reject any of them.
- [x] 2.6 Add `src/features/clientes/types.ts` re-exports for the new domain types, extending the existing file rather than creating a second one.

## 3. Shared history table (design.md D2)

> This section edits one supplier file. The proof that it changed nothing is that `HistorialCronologico.test.tsx` passes **unmodified**. If that suite needs an edit, the extraction is wrong — revisit it, do not edit the test.

- [x] 3.1 Run `npm test -- HistorialCronologico` and record the passing count. This is the safety net for the extraction specifically.
- [x] 3.2 Test: `HistorialTable` renders one row per entry in the **order given**, each carrying `data-testid="historial-row-${id}"`, a `data-testid="historial-chip"` with `data-tipo` set to the row's tipo, and a `data-testid="historial-saldo-acumulado"` showing the signed running balance. These are the exact contracts the supplier suite asserts.
- [x] 3.3 Test: the chip's label and the attachment dialog's title come from the caller's config map, keyed by the row's `tipo` — the component hard-codes neither ledger's vocabulary.
- [x] 3.4 Test: an empty array renders the "Sin movimientos registrados." message with `role="status"`.
- [x] 3.5 Test: a row with an attachment exposes a way to open it; a row without one does not.
- [x] 3.6 Implement `src/shared/components/HistorialTable/HistorialTable.tsx` with `HistorialTableRow` and `HistorialTipoConfig` as in design.md D2, carrying forward the block comment that explains why row order is coupled to `saldo_acumulado` and must never become a value-based sort.
- [x] 3.7 Rewrite `src/features/cuenta-corriente/components/HistorialCronologico.tsx` as a thin wrapper supplying the `FACTURA`/`PAGO` config — same path, same export name, same props. Do **not** touch `CuentaCorrientePage.tsx` and do **not** touch `HistorialCronologico.test.tsx`.
- [x] 3.8 Re-run `npm test -- HistorialCronologico CuentaCorrientePage` and confirm the same count as 3.1, unmodified. This is the evidence the extraction is behaviour-preserving.

## 4. Customer ledger API layer (design.md D1)

- [x] 4.1 Test: `getCuentaCorrienteCliente(id)` calls `GET /api/clientes/{id}/cuenta-corriente` with no body and no query parameters.
- [x] 4.2 **Test (parse boundary):** every Decimal-string on the wire — `saldo`, each fiado's `monto`, each history row's `monto` and `saldo_acumulado` — arrives at the caller as a `number`.
- [x] 4.3 **Test (fails loudly):** a non-finite value in any of those fields makes the parse **throw** a typed error naming the field. Assert the error message contains the field name. A `0` balance must never be fabricated from a malformed wire value.
- [x] 4.4 Test: a negative `saldo` on the wire parses to a negative `number` and is **not** clamped (D-58 — the negative case is legitimate and reachable).
- [x] 4.5 Test: the parse preserves the history's order exactly as received, and preserves each row's `archivo_url` (including `null` for rows that have none).
- [x] 4.6 Implement `src/features/clientes/api/cuentaCorrienteClienteApi.ts`, mirroring `cuentaCorrienteApi.ts`'s `Raw*` internal interfaces and `toFiniteNumber` helper. Carry over the **whitelist warning comment** verbatim in spirit: the parse rebuilds each row field by field, so a field the backend adds and this function forgets is dropped silently — exactly how `archivo_url` went missing for a whole change in C-24.

## 5. Cobros API layer — the C-43 seam (design.md D7)

> `crearCobro` is the single function that owns `POST /api/cobros`. C-43 Fase B adds `getIdempotencyKey` / `confirmIdempotencyKey` and the header **inside this one function**. Nothing else may call that endpoint, and the result shape must not change when C-43 lands.

- [x] 5.1 Test: `crearCobro(data)` posts to `/cobros` with exactly `cliente_id`, `monto`, `fecha`, `metodo` and (when present) `comprobante_url` — and no `venta_id`, no `negocio_id`, no `creado_por_usuario_id`.
- [x] 5.2 **Test (result shape):** `crearCobro` resolves to `{ cobro, replay }`, never a bare response body. Assert both keys are present on an ordinary `201`, with `replay === false`.
- [x] 5.3 **Test (replay is classified, not guessed):** given a `200` carrying `Idempotent-Replay: true`, `crearCobro` resolves with `replay === true` — even though the body is byte-identical to a creation. Derive it through `classifySuccess` from `@shared/api/submitOutcome`; do not re-implement the check. This endpoint does not send that header today; the test pins the classification path so C-43 inherits a working one.
- [x] 5.4 Test: a rejection propagates (the caller must see it). `crearCobro` does not swallow errors.
- [x] 5.5 Implement `src/features/clientes/api/cobrosApi.ts` exactly as design.md D7 shows: `CrearCobroResult`, one `await apiClient.post`, `classifySuccess`, return. **Do not** pre-add a `try/catch` that only rethrows — C-43 adds it with the calls that need it, and dead scaffolding costs a reviewer more than it saves.
- [x] 5.6 Add the comment block at the top of `cobrosApi.ts` naming this as the C-43 hook point, listing the five things C-43 adds (design.md D7) so whoever picks it up does not have to rediscover the design.
- [x] 5.7 Test (guard): no module outside `cobrosApi.ts` references the `/cobros` path. Assert by grepping the source tree in the test, mirroring C-42's "createVenta always sends the key" guard in intent — the point is that a future call site cannot bypass the one function idempotency will live in.

## 6. Hooks and cache invalidation (design.md D4)

- [x] 6.1 **Test:** `CLIENTE_KEYS.cuentaCorriente(id)` is prefixed by `CLIENTE_KEYS.all`, so invalidating `['clientes']` also invalidates a customer's account. This is what makes C-34's existing ventas invalidation reach the account view **without editing the ventas feature**.
- [x] 6.2 Test: `useCuentaCorrienteCliente(id)` is disabled on an empty id, does **not** retry (a 404 is a real answer — foreign negocio, soft-deleted, or missing), and has `staleTime: 0` so a revisit refetches.
- [x] 6.3 **Test (cross-feature, no ventas edit):** with a customer account cached, invoking `useCreateVenta`'s success path for a `CUENTA_CORRIENTE` sale marks the account query stale. Assert against the **unmodified** `ventasHooks.ts`. If this fails, the key layout is wrong — fix the key, not the ventas feature.
- [x] 6.4 Test: `useCrearCobro` invalidates `CLIENTE_KEYS.all` on success, covering the open account and the listing's balance column in one call.
- [x] 6.5 Test: `useCrearCobro`'s mutation resolves `{ cobro, replay }` — the hook passes the result object through and does not unwrap it to a bare cobro (that unwrapping is what would force C-43 to change the hook).
- [x] 6.6 Extend `src/features/clientes/api/clientesHooks.ts` with `cuentaCorriente` on `CLIENTE_KEYS`, `useCliente(id)` and `useCuentaCorrienteCliente(id)`; add `src/features/clientes/api/cobrosHooks.ts` with `useCrearCobro`.

## 7. Balance and fiados rendering (design.md D1, D3)

- [x] 7.1 **Test (spec scenario, the negative case):** an account whose balance is below zero renders that figure as a credit in the customer's favour. Assert the real amount is present in the output. This is the regression guard against a future `Math.max(0, saldo)` — say so in the test's name.
- [x] 7.2 Test: a positive balance renders as a debt, and a zero balance renders as settled, each distinguishable from the other two.
- [x] 7.3 Test: the rendered balance equals the response's balance field, not a sum over the movements. Feed a response whose balance deliberately disagrees with the movement totals and assert the **response's** figure is what renders.
- [x] 7.4 Reuse `SaldoBadge` by importing it from `@features/cuenta-corriente/components/SaldoBadge`. Do **not** move it, copy it, or wrap it — it is already sign-dispatching and domain-free (design.md D3).
- [x] 7.5 **Test:** `TablaVentasFiadas` renders one row per fiado with its date, amount and the `estado` the response carried — `PENDIENTE`, `PARCIAL` and `COBRADA` each rendering distinctly.
- [x] 7.6 Test: the fiados table renders **no** invoice number, due date, or document-origin column. A fiado is a `Venta` and has none of them (design.md D3).
- [x] 7.7 Test: an empty fiados array renders an empty state, not an empty table.
- [x] 7.8 Implement `src/features/clientes/components/TablaVentasFiadas.tsx` and its estado badge, reusing the existing `badge-*` colour tokens so the two ledgers look like one system without sharing a component.
- [x] 7.9 **Test (order invariant):** the customer history rendered oldest-first and newest-first shows **the same running balance on every row**, differing only in order. Mirror the supplier's REGRESSION GUARD test — the reversal must be `[...historial].reverse()` on a copy and never a comparator.
- [x] 7.10 Implement `src/features/clientes/components/CuentaCorrienteCliente.tsx` — the panel composing `SaldoBadge`, `TablaVentasFiadas` and `HistorialTable` with the `VENTA`/`COBRO` config.

## 8. Cobro form (design.md D6, D8, D11)

- [x] 8.1 **Test (spec scenario, the ceiling is stated):** the form opened for a customer with an outstanding balance shows the maximum collectable amount alongside the amount field, and it equals the account's balance.
- [x] 8.2 **Test (spec scenario, refused before the request):** submitting an amount greater than the pending balance shows the problem and issues **no request**. Assert the mutation was not called.
- [x] 8.3 **Test:** an amount above the ceiling is left **exactly as typed** — the form never rewrites it to fit (design.md D6: silently changing a number someone typed, on a screen about money, is worse than telling them it is too high).
- [x] 8.4 **Test (spec scenario, the backend is the rule):** when the backend answers `422` because the balance changed since the form opened, its `detail` message is displayed verbatim, every entered value is retained, and the account query is invalidated.
- [x] 8.5 Test: the form opens on today's date in `America/Argentina/Buenos_Aires` via the existing `getTodayInArgentina` helper, with that date as the input's `max`; a future date and a non-positive amount are each refused with a message naming the rule.
- [x] 8.6 Test: the method selector offers exactly cash, transfer, card and other — and **no** on-account option (debt is not cancelled with debt).
- [x] 8.7 Test: the form offers no way to select or reference a sale (RN-CCC-03).
- [x] 8.8 **Test (spec scenario, unconfirmed ≠ rejected):** a submission that produces no response, and one that fails with a `500`, each render a `role="status"` banner distinct from the `role="alert"` backend-error path, and retain every entered value. Classify through `classifyError` from `@shared/api/submitOutcome`; do not re-implement it.
- [x] 8.9 **Test (the copy is the requirement):** the unconfirmed banner directs the user to check the customer's movements before retrying and does **not** state that retrying is safe. Assert on the actual wording — this endpoint does not deduplicate, and a "safe to retry" promise here is false (D-67). Keep the paragraph in **one** element so C-43 replaces it in one edit.
- [x] 8.10 Test: a rejection below `500` keeps the ordinary path — the backend's `detail` in the alert, `unknown` state untouched.
- [x] 8.11 **Test (the C-43 branch is live):** with `crearCobro` mocked to resolve `{ replay: true }`, the form reports the cobro as already recorded rather than announcing a new one. Exercise it through the API-result seam, never by fabricating a header.
- [x] 8.12 Implement `src/features/clientes/components/CobroFormDialog.tsx` — Radix dialog, `InputField`s, following `PagoForm`'s structure for the ambiguous-outcome banner and `extractBackendError` for the message extraction.

## 9. Nothing to collect (design.md D6)

- [x] 9.1 **Test (spec scenario):** an account with a zero balance offers **no** cobro action and states that the customer is settled.
- [x] 9.2 **Test (spec scenario):** an account with a negative balance offers **no** cobro action and states the credit — presented as a fact, not as an error.
- [x] 9.3 Test: an account with a positive balance **does** offer the cobro action.
- [x] 9.4 Implement the gate in `CuentaCorrienteCliente`. The action is absent, not disabled: `POST /api/cobros` rejects a payment for a customer with no live fiados outright, and a form that can only fail teaches the user the app is broken.

## 10. Customer list (design.md D10)

- [x] 10.1 **Test (spec scenario):** the list renders each customer with the balance from the listing response, ordered by balance descending by default — largest debt first.
- [x] 10.2 **Test (no N+1):** rendering a list of many customers issues **no** per-customer account request. Assert the request count.
- [x] 10.3 Test: the ordering can be switched, and switching re-orders without any refetch.
- [x] 10.4 **Test:** a customer whose balance is absent orders **last**, not as zero — "unknown" and "settled" are different facts. `Cliente.saldo` is `string | null` on the wire, so the comparator parses.
- [x] 10.5 Test: a negocio with no customers renders an empty state; each row links to `/clientes/:id`.
- [x] 10.6 Implement `src/features/clientes/ClientesPage.tsx`, composing `PageHeader` + list exactly as `ProveedoresPage` does, with `EmptyState` and `LoadingState`.

## 11. Customer card, routes and navigation (design.md D5, D12)

- [x] 11.1 **Test (spec scenario, two sources):** the card reads the name from `GET /api/clientes/{id}` and the balance, fiados and history from the account endpoint.
- [x] 11.2 **Test (the bug that type-checks):** given a customer response whose `saldo` is `null` — which is always, on a single-customer read — the card still renders the real balance, because it never reads that field. Feed a customer response with `saldo: null` and an account response with a non-zero balance and assert the account's figure renders.
- [x] 11.3 **Test (spec scenario):** a `404` from either query renders a single "cliente no encontrado" state with a link back to `/clientes`, and the account request is **not** retried.
- [x] 11.4 Test: a non-`404` failure of the account query offers a retry affordance while the header still shows the customer.
- [x] 11.5 Implement `src/features/clientes/ClienteDetailPage.tsx`, mirroring `ProveedorDetailPage`'s header-card + panel composition and its loading/error branches.
- [x] 11.6 Test: `/clientes` and `/clientes/:id` render their pages, and both sit inside the authenticated layout — same guard as the other private routes.
- [x] 11.7 Add both routes to `src/app/router.tsx` and a `Clientes` entry to `NAV_ITEMS` in `src/shared/components/AppLayout/AppLayout.tsx`, next to `Ventas`. Test that the nav entry renders for an authenticated user.

## 12. Gates

- [x] 12.1 Run `npm run typecheck` (`tsc --noEmit`) and confirm it is clean. **This is the only type gate** — `npm test` transpiles through esbuild and will pass on types that do not compile (C-34). Anything in section 2 is verified here, not by the test run.
- [x] 12.2 Run `npm run lint` and confirm it is clean at `--max-warnings 0`. No `any` anywhere in the new code.
- [x] 12.3 Run the full `npm test` and compare against the 1.1 baseline: every previously passing test still passes, plus this change's new tests. The `PropuestaIAModal.e2e.test.tsx` countdown flake is the one permitted exception (task 1.2).
- [x] 12.4 Confirm `git status` shows **no** modification under `facturas-proveedores-api/` and **no** change to `src/features/ventas/`. Both would mean a decision was quietly reversed: the backend is C-43 Fase A's, and D4 exists precisely so the ventas feature needs no edit.
- [x] 12.5 Confirm `src/shared/api/api.d.ts` was appended to in a single contiguous block and that `npm run generate-types` was never run (the file still exports named types, not `paths`/`components`).
- [x] 12.6 Confirm no file in this change imports `@shared/api/idempotency` and no request sets an `Idempotency-Key` header. That is C-43's scope; section 5 left it a two-line change.
