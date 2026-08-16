## Context

C-35 shipped `GET /api/clientes/{id}/cuenta-corriente` and `/api/cobros` on 2026-08-12; C-34 shipped the sales screen and the customers API layer on 2026-08-14. Both are archived and neither is modified by this work. What is missing is every screen that reads the customer ledger.

The frontend is a React + TypeScript + Vite PWA with TanStack Query for server state, Zustand for session state, Axios behind a shared client (`withCredentials`, a `401` refresh interceptor, and — since C-42 — a global `timeout: 20_000`), Tailwind v4, Radix primitives for dialogs, and a feature-based folder layout. Tests are Vitest + Testing Library + MSW.

Four properties of the existing codebase shape every decision below:

- **`src/shared/api/api.d.ts` is hand-written**, despite a `npm run generate-types` script and a header comment that reads like it was generated. Running that script rewrites the file into the `openapi-typescript` `paths`/`components` shape and breaks the hundreds of imports that depend on the current named exports. That migration is C-41. **This change adds its types by hand**, exactly as C-34 did.
- **The supplier ledger already solved this shape once.** `features/cuenta-corriente/` has `SaldoBadge`, `HistorialCronologico`, `TablaFacturasConEstado`, a `parseCuentaCorriente` Decimal boundary, and a page that toggles between three panels. `CHANGES.md` instructs generalizing rather than duplicating. It is right about two of those components and wrong about the third — D3.
- **`HistorialCronologico` carries a load-bearing invariant in a comment**, not in a type: the backend computes `saldo_acumulado` as a running sum during the same ASC walk that produces the response order, so the order and the per-row values are coupled. `CuentaCorrientePage` documents at length that its reversal must stay a `.reverse()` and never become a `.sort()`. Duplicating that component duplicates that invariant, and the copy will drift.
- **C-42 added a 20s global timeout and idempotency for `POST /api/ventas` only.** `POST /api/cobros` does not deduplicate. `PagoForm` and `FacturaForm` already carry an interim ambiguous-outcome banner (D-67) that points at the list and never promises a safe retry. The cobro form joins them.

## Goals / Non-Goals

**Goals:**

- A customer list ordered by who owes the most, because that is the question the screen exists to answer.
- A customer card that shows the balance the API computed, the FIFO state of each fiado, and the chronological history — with zero client-side arithmetic on any of the three.
- A "registrar cobro" flow whose amount is visibly bounded by the pending balance, and which is simply unavailable when there is nothing to collect.
- The negative balance rendered as the real figure, with the wording that explains it.
- A cobro submit path that C-43 can make idempotent by editing one function.

**Non-Goals:**

- Idempotency (C-43). This change adds no `Idempotency-Key` and no `idempotency.ts` import.
- Editing or deleting a cobro. The backend supports both; no surface is designed here.
- A cobros list page or a `/cobros` route (D-34).
- Aggregations, statistics (C-37/C-38), export (C-39).
- Regenerating `api.d.ts` (C-41).
- Any change to the supplier ledger's rendered behaviour. Its existing tests must pass **unmodified** — that is the proof obligation of D2.

## Decisions

### D1 — The balance the screen shows is the balance the API computed, and nothing else

`saldo`, each fiado's `estado`, and each history row's `saldo_acumulado` are consumed verbatim. This change contains no summation, no clamping, no re-sorting by value, no derivation of one from another (RN-SALDO, RN-FIFO, RN-HIST, D-01).

Two mechanisms enforce it rather than a comment:

1. **A parse boundary that throws.** `parseCuentaCorrienteCliente` mirrors `parseCuentaCorriente` exactly: every `Decimal` string becomes a `number` via `Number()`, and a non-finite result throws a typed `Error` naming the field. A malformed wire value surfaces as `isError` on the query, not as a `0` balance on a screen someone charges against. It carries the same **whitelist warning** the supplier's boundary carries — the function rebuilds each row field by field, so any field the backend adds and this function forgets is dropped silently, which is exactly how `archivo_url` went missing for a whole change in C-24.
2. **The history is rendered in the order received.** Where the customer card offers a newest-first view, it is `[...historial].reverse()` on a copy — a pure structural flip, never a comparator — for the same reason spelled out at length in `CuentaCorrientePage`: a value-based re-sort silently decouples each row from the `saldo_acumulado` computed for the ASC walk.

*Alternative rejected — recompute the balance from the history's last row as a cross-check.* It looks like defence and is the opposite: two numbers that can disagree on one screen, where the wrong one is indistinguishable from the right one. The API is the single source; if it is wrong, the fix is in the API.

### D2 — `HistorialCronologico` is extracted; the supplier keeps its file and its tests

The customer history is the same table with a different vocabulary: `tipo` is `VENTA | COBRO` instead of `FACTURA | PAGO`, and the attachment on a `COBRO` row is a receipt rather than a payment voucher. Everything else — the columns, the running-balance column, the order invariant, the `ArchivoPreviewDialog` wiring, the empty state — is identical.

The table moves to `src/shared/components/HistorialTable/HistorialTable.tsx`, generic over the row's `tipo` string and parameterized by a config map:

```ts
export interface HistorialTableRow {
  id: string
  tipo: string
  fecha: string
  monto: number
  saldo_acumulado: number
  archivo_url?: string | null
}

export interface HistorialTipoConfig {
  /** Chip text — "Debe" for a charge, "Haber" for a credit. */
  label: string
  /** Which side of the ledger, for the chip's colour tokens. */
  lado: 'debe' | 'haber'
  /** Title of the attachment preview dialog for rows of this tipo. */
  archivoTitulo: string
}
```

`features/cuenta-corriente/components/HistorialCronologico.tsx` keeps its path, its export name and its props, and becomes a thin wrapper that supplies the `FACTURA`/`PAGO` config. Its call site in `CuentaCorrientePage` is unchanged and **`HistorialCronologico.test.tsx` is not edited** — including its `data-testid` contracts (`historial-row-${id}`, `historial-chip` + `data-tipo`, `historial-saldo-acumulado`) and the "Sin movimientos registrados." text, all of which the shared table preserves. That unmodified suite passing is the evidence that the extraction changed nothing, mirroring C-35's own "the supplier ledger is unchanged" requirement.

*Alternative rejected — copy the component into the clientes feature.* It duplicates the C-24 order/`saldo_acumulado` invariant into a second file whose comment nobody will read when they "improve" the sorting.

*Alternative rejected — make it generic over a TypeScript union of both tipo enums.* The union grows with every future ledger and every consumer then handles cases it does not have. A config map keyed by the tipo strings the caller actually passes is the same safety with no coupling between the two ledgers.

### D3 — `TablaFacturasConEstado` is **not** generalized; the fiados get their own table

`CHANGES.md` lists it alongside the other two as something to generalize. Reading both shapes says otherwise.

`FacturaConEstado` carries `numero`, `fecha_vencimiento` and `origen`. A fiado is a `Venta`: it has none of them, and never will — a sale at a counter has no invoice number and no due date. `TablaFacturasConEstado` also embeds `FiltrosFacturas`, whose `estado` is typed `EstadoFactura`. Generalizing means a table where three of six columns are optional and the filter's enum is a type parameter — a component strictly worse than either of the two honest ones, in exchange for saving a table body.

The enums are deliberately different too: `PAGADA` vs `COBRADA`, chosen in C-35 precisely because a customer's sale reported as "paid" reads as though the shop had paid it. Sharing a component over enums whose *point* is that they differ is how that distinction gets lost.

So: a new `TablaVentasFiadas` in `features/clientes/components/`, rendering `fecha`, `monto` and `estado`. It reuses the existing badge colour tokens (`badge-parcial-*`, `badge-pagada-*`, `badge-pendiente-*`) so the two ledgers look like one system without sharing a component that should not be shared.

`SaldoBadge` is the opposite case: it takes a bare `saldo: number`, dispatches on the sign, and already renders the negative case as "a favor". It is domain-free as written. It is **imported as-is** from `@features/cuenta-corriente/components/SaldoBadge` — not moved, not copied, not wrapped. The precedent is `SupplierSearch`, which lives in `shared/components/` and imports its hooks from `@features/proveedores/api/`; cross-feature imports already exist in this codebase. Moving it would edit the supplier feature for no behavioural gain.

### D4 — The customer account query key is nested under `CLIENTE_KEYS`

```ts
export const CLIENTE_KEYS = {
  all: ['clientes'] as const,
  buscar: (nombre: string) => ['clientes', 'buscar', nombre] as const,
  cuentaCorriente: (clienteId: string) => ['clientes', 'cuenta-corriente', clienteId] as const,
}
```

C-34's `ventasHooks.ts` already calls `invalidateQueries({ queryKey: CLIENTE_KEYS.all })` on every create, update and delete of a sale that is (or was) on account, with a comment saying it exists "so C-35/C-36's customer account view reactively refreshes". Under this key layout that comment becomes true with **zero edits to the ventas feature**: `['clientes']` is a prefix of the account key, so TanStack Query invalidates it.

*Alternative rejected — a sibling `CUENTA_CORRIENTE_CLIENTE_KEYS` namespace, mirroring the supplier side.* That mirror is what forces `pagosHooks` and `facturasHooks` to each remember an explicit `CUENTA_CORRIENTE_KEYS.detail(proveedorId)` invalidation — coupling C-36 gets to avoid entirely. A customer's account is customer data; nesting it is not a trick, it is where it belongs.

The query itself mirrors `useCuentaCorriente`: `enabled: Boolean(clienteId)`, `retry: false` (a 404 is a real answer — foreign negocio, soft-deleted, or missing — and the page renders an empty state from `isError`, not a retry spinner), `staleTime: 0` so a revisit refetches.

`useCrearCobro` invalidates `CLIENTE_KEYS.all`, which covers the account being viewed *and* the list's balance column in one call.

### D5 — The customer's name and the customer's balance come from different endpoints, on purpose

`GET /api/clientes/{id}` reports `saldo: null` — always. The backend populates it only in the plain listing, via a single aggregate query, and explicitly declines to pay for that query on create/get/update/search.

So `ClienteDetailPage` runs two queries: `useCliente(id)` for the name (and phone/notes), and `useCuentaCorrienteCliente(id)` for the balance, the fiados and the history. **`cliente.saldo` is never read on this page.** This is spelled out because it is the exact shape of a bug that type-checks: the field exists, it is on the object the page already has, and it is structurally `null` on precisely the screen where a balance is the point.

Loading and error handling mirror `ProveedorDetailPage`: a 404 from either query renders the "cliente no encontrado" empty state with a link back to `/clientes`; a non-404 failure of the account query renders a retry affordance while the header still shows the customer.

### D6 — The cobro ceiling is a courtesy; the backend is the rule

RN-CCC-04: a cobro may not drive the balance below zero (D-37 — no saldo a favor on a customer account). The form:

- sets `max` on the amount input to the current `saldo` and shows it in words ("Máximo: $X — es lo que debe hoy");
- rejects an amount above it client-side, before a round-trip;
- **never** replaces the backend check. `cobro_cliente_service` recomputes the available balance server-side on every create; the form surfaces its `422 detail` verbatim, because that message states the remaining balance and was written to be corrected against, not guessed at.

The backend can legitimately reject an amount the form considered valid — another member of the same negocio can record a cobro between this page loading and this form submitting. That is not an edge case to design away; it is why the ceiling is a courtesy. On a rejection the form keeps every field as typed and the account query is invalidated so the ceiling updates.

**When there is nothing to collect the action is not offered.** `saldo <= 0` means either "al día" or "a favor", and `POST /api/cobros` rejects a payment for a customer with no live fiados outright. Rendering a disabled-looking form that can only fail teaches the user that the app is broken. The card shows the state and explains it instead.

*Alternative rejected — clamp the input's value to the balance as the user types.* Silently changing a number someone typed, on a screen about money, is worse than telling them the number is too high.

### D7 — The cobro submit path is C-43-shaped from the first commit

C-43 Fase B wires idempotency into this flow. `crearCobro` is therefore written now as the single async function that owns `POST /api/cobros` — every call site goes through it, none touches `apiClient` directly — and it resolves to a **result object**, not the bare response:

```ts
export interface CrearCobroResult {
  cobro: CobroCliente
  /** True for a deduplicated replay. Always false until C-43 wires the
   *  Idempotency-Key: `classifySuccess` only reports `alreadyRecorded`
   *  for a 200 carrying `Idempotent-Replay: true`, which this endpoint
   *  does not send yet. The SHAPE is what matters — see design.md D7. */
  replay: boolean
}

export async function crearCobro(data: CobroClienteCreate): Promise<CrearCobroResult> {
  const res = await apiClient.post<CobroCliente>('/cobros', data)
  const outcome = classifySuccess(res)
  return { cobro: res.data, replay: outcome.kind === 'alreadyRecorded' }
}
```

`classifySuccess` and `classifyError` come from `@shared/api/submitOutcome` — already generic, already unit-tested, and explicitly written in C-42 "to reuse for pagos/facturas/cobros (C-43) without dragging this module's dependents along". Using them is **not** implementing idempotency; they are outcome classification, and the ambiguous-outcome branch they enable is valuable today precisely because this endpoint does not dedupe.

The form already branches on `replay`, exercised through the API-result seam (a mocked `crearCobro` resolving `{ replay: true }`) rather than a fabricated header, so the branch is live code and not a dead limb waiting for C-43.

**What C-43 has to add, and nothing else:**

1. two imports from `@shared/api/idempotency`;
2. a `const COBRO_IDEMPOTENCY_NAMESPACE = 'cobro-create'`;
3. `const key = getIdempotencyKey(COBRO_IDEMPOTENCY_NAMESPACE, data)` and the `Idempotency-Key` header on the POST;
4. a `try/catch` around it: `confirmIdempotencyKey(…, key)` on success and on a `409`, rethrowing everything else;
5. swapping one paragraph of copy — D8.

No change to `CrearCobroResult`, to `useCrearCobro`, to the mutation's generic types, to the form's props, or to any existing test's shape. C-36 deliberately does **not** pre-add the empty `try/catch` in step 4: a catch that only rethrows is dead code that a reviewer has to reason about, and adding it is smaller than reading it.

### D8 — The ambiguous outcome says "check first", not "retry is safe"

An unconfirmed outcome (`classifyError` → `unknown`: no response, or any `5xx`) gets its own `role="status"` banner, never folded into the backend-error alert, matching `PagoForm` exactly:

> No pudimos confirmar si el cobro se guardó. Esta operación no queda identificada para evitar duplicados, así que antes de reintentar, **revisá los movimientos del cliente** para asegurarte de que no quedó cargado.

The link points at the customer's own history — the account is already open, and it is the list where a duplicate cobro would appear. Two things about this are deliberate:

- **It does not promise a safe retry**, unlike `VentaForm`. There is no key to reuse here. C-42's 20s timeout makes this *more* dangerous for this form, not less: it converts a request that may have committed server-side into an explicit error that invites retrying over an endpoint that does not deduplicate (D-67).
- **It is one paragraph, in one place.** C-43 replaces it with the `VentaForm` wording once the key exists. Keeping it in a single element is what makes that a one-line change.

A real rejection (a 4xx below 500, including the RN-CCC-04 `422`) keeps the ordinary behaviour: the backend's `detail` shown verbatim.

### D9 — Hand-written types, and the `number`/`string` split is deliberate

New named exports in `api.d.ts`, matching the style already there:

```ts
export type MetodoCobro = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'OTRO'
export type EstadoVentaFiada = 'PENDIENTE' | 'PARCIAL' | 'COBRADA'
export type EntradaHistorialClienteTipo = 'VENTA' | 'COBRO'

export interface VentaConEstado { id, negocio_id, cliente_id, fecha, monto: number, forma_pago, notas?, estado: EstadoVentaFiada, created_at, updated_at }
export interface EntradaHistorialCliente { id, tipo: EntradaHistorialClienteTipo, fecha, monto: number, saldo_acumulado: number, archivo_url?: string | null }
export interface CuentaCorrienteClienteResponse { cliente_id: string, saldo: number, ventas_con_estado: VentaConEstado[], historial: EntradaHistorialCliente[] }

export interface CobroCliente { id, negocio_id, cliente_id, monto: string, fecha, metodo: MetodoCobro, comprobante_url?: string | null, created_at, updated_at }
export interface CobroClienteCreate { cliente_id: string, monto: string, fecha: string, metodo: MetodoCobro, comprobante_url?: string | null }
```

The asymmetry is intentional and follows both existing precedents rather than inventing a third:

- **The ledger read is `number`** — parsed at the boundary, exactly like `CuentaCorrienteResponse`, because the screen formats and compares those values.
- **The cobro write is `string`** — raw wire, exactly like `Venta.monto` and every other `Decimal` the API returns, because the amount is typed by a human and sent back untouched. It is never parsed into a float and re-serialized; that round-trip is where a cent goes missing.

`MetodoCobro` is its own type, not an alias of `MetodoPago` or `FormaPago`: it has no `MERCADOPAGO` (money going out to suppliers) and no `CUENTA_CORRIENTE` (debt is not cancelled with debt). `EstadoVentaFiada` is separate from `EstadoFactura` for the reason C-35 gives.

**Apply must not run `npm run generate-types`** — it rewrites the file's shape and breaks every named import. That is C-41.

### D10 — The list answers "who owes me", and does it without a second request

`ClientesPage` renders `useClientes()` — the plain listing, the only endpoint that carries balances — sorted by balance descending by default, with the sort toggleable. `Cliente.saldo` is `string | null` on the wire, so the comparator parses; a `null` (which the plain listing should never produce, but the type permits) sorts last rather than as `0`, because "unknown" and "al día" are different facts.

The list never fetches per-customer accounts: the backend computes every balance in one aggregate query specifically so ordering by debt does not become N+1. Rows link to `/clientes/:id`.

### D11 — Client validation exists for the person, not for correctness

Amount `> 0`, amount `<=` current balance, date not in the future in `America/Argentina/Buenos_Aires` via the existing `getTodayInArgentina` helper, method required. All of it is so the user is not punished by a round-trip. None of it is the guarantee: Pydantic validates `monto > 0`, and `cobro_cliente_service` re-validates the date against Argentina's today and recomputes the balance. The form surfaces the backend's `detail` message rather than inventing its own.

"Today" is Argentina's today, not the browser's — the same reason C-34 gives: a browser in another timezone would default the form to a date the backend rejects, or record a cobro on the wrong day.

### D12 — Visual language is inherited, not invented

The app has a settled violet/beige/Inter system. `ClientesPage` composes `PageHeader` + list exactly as `ProveedoresPage` does; `ClienteDetailPage` composes a header `Card` + the account panel exactly as `ProveedorDetailPage` does; empty and loading states use `EmptyState` and `LoadingState`; the cobro form uses `InputField` inside a Radix dialog following the destructive/confirm patterns already settled. Tailwind v4's `dark:` variant stays wired to the `.dark` class through CSS — `darkMode: 'class'` is **not** reintroduced into any JS config.

Motion follows the house rules already in the codebase: transitions on `transform`/`opacity` only, durations under 300ms, `ease-out` on entrances, no animation on anything the user triggers dozens of times a day. The balance is a number someone reads to make a decision — it does not animate, count up, or transition between values.

## Risks / Trade-offs

- **The `HistorialCronologico` extraction changes supplier behaviour** → mitigated by refusing to edit `HistorialCronologico.test.tsx`: that suite passing unmodified against the wrapper is the whole proof. If it needs an edit, the extraction is wrong, not the test.
- **Someone adds `Math.max(0, saldo)` later**, believing a negative balance is a bug → mitigated by a spec requirement and a test asserting the negative case renders as the real figure, and by D-58 / C-34's warning copy being cited at the render site.
- **The balance goes stale between page load and cobro submit** (another member records one) → the backend rejects with a message stating the real remaining balance, which is surfaced verbatim, and the account is invalidated so the ceiling corrects itself. Accepted by design; the alternative is polling a number that changes rarely.
- **A duplicate cobro from a retried, unconfirmed submit** → not solvable here (no idempotency until C-43). Mitigated by the D8 copy, which points at the history instead of offering a retry. This is a real, known exposure with a dated owner, not an oversight.
- **The parse boundary's whitelist drops a field the backend adds** → the exact C-24 failure. Mitigated by carrying the same explicit warning comment the supplier boundary carries, and by the tasks naming it.
- **Type-guard tests do not fail under Vitest** — esbuild strips types without checking them, so a compile-time assertion is not a gate (learned in C-34). Mitigated by making `tsc --noEmit` an explicit task, not an assumed side effect of the test run.
- **C-43 lands first and edits `cobrosApi.ts`** → the surface is one function in one file that does not exist until this change creates it. C-43 Fase A is backend-only and in an isolated worktree; Fase B is by definition after C-36. The only genuine collision risk is `api.d.ts`, which both changes append to — mitigated by C-36 adding a single contiguous block under its own section header.

## Migration Plan

Additive. New routes (`/clientes`, `/clientes/:id`), a new nav entry, new modules under an existing feature folder, one new shared component, and new named exports in `api.d.ts`. The only edit to existing rendering is `HistorialCronologico.tsx` becoming a wrapper over the extracted table, verified by its own unmodified test suite. No data, no schema, no backend. Rollback is reverting the commit.

## Open Questions

- **Where "Registrar cobro" lives outside the customer's card.** A cobro at the counter probably wants to be reachable from Home or from the sales screen, the way "Cargar pago" is reachable from the supplier's card. Deferred: it is a navigation decision about the whole shell, and the account card is where the balance — the thing that bounds the amount — is already on screen.
- **Whether a cobro should accept a receipt file.** `CobroClienteCreate` accepts `comprobante_url` and `FileUploadField` already exists, but a cash payment across a counter rarely has one. The field is in the type; whether the form renders it is left to the apply phase to settle against the existing `PagoForm`, which does render it.
- **Correcting a mis-entered cobro.** The backend offers PATCH and DELETE and forbids moving a cobro between customers (the correction is delete-and-re-record). No UI is proposed here; whether that belongs on the history row or on a cobros screen is a product question C-39's export work may answer first.
