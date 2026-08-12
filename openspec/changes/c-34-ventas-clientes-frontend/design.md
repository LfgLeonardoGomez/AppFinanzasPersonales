## Context

C-33 shipped `/api/ventas` yesterday and C-32 shipped `/api/clientes` before it. Both are archived and unchanged by this work. What is missing is the screen.

The frontend is a React + TypeScript + Vite PWA with TanStack Query for server state, Zustand for session state, Axios behind a shared client (`withCredentials` + a `401` interceptor), Tailwind v4, Radix primitives for dialogs, and a feature-based folder layout. Tests are Vitest + Testing Library + MSW. The measured baseline before this change is **569 tests across 76 files, all passing**.

Two things about the existing codebase shape every decision below:

- **`src/shared/api/api.d.ts` is hand-written**, all 720 lines and 48 named types of it, despite a `npm run generate-types` script and a header comment that reads like it was generated. Running that script rewrites the file into the `openapi-typescript` shape (`paths`/`components`) and breaks the 262 imports that depend on the current named exports. Migrating to generated types is real debt, tracked separately as C-41. **This change adds its types by hand.**
- **The component `CHANGES.md` calls `ProveedorAutocomplete` is actually `SupplierSearch`**, at `src/shared/components/SupplierSearch/SupplierSearch.tsx`. It already does everything the customer version needs — debounce-free query on ≥2 characters, a `role="combobox"` input, an option list, keyboard traversal, a selected-value chip, and inline creation when nothing matches. `ClienteAutocomplete` is its mirror image, one endpoint over.

## Goals / Non-Goals

**Goals:**

- A counter form whose *shape* is the backend invariant: the customer field exists exactly when the sale is on account.
- A `ClienteAutocomplete` that can create a customer without the user leaving the sale they are recording, and that offers the existing customer when the name collides.
- A filterable sales list with the day's totals broken down by payment method, computed on-demand.
- A warning that tells a user, before they act, whose debt is about to disappear and how much of it.

**Non-Goals:**

- Customer balances, charges, or the customer account view — C-35 (backend) and C-36 (frontend).
- A customers list or detail page. This change creates only `src/features/clientes/api/`; C-36 owns the pages.
- Aggregations beyond the day's totals (C-37/C-38), and export (C-39).
- Regenerating `api.d.ts` (C-41).
- Editing a customer's name, phone or notes. The counter creates; C-36 maintains.

## Decisions

### D1 — The conditional customer field *is* the invariant, not a view of it

`venta_service._validar_par` rejects both directions of the pair, and a database CHECK makes it true for paths written later. The form mirrors that with a single rule: when `forma_pago !== 'CUENTA_CORRIENTE'` the customer field is **not rendered** and `cliente_id` is **removed from form state**.

*Alternative rejected — render the field always, disabled when not applicable.* It reads as "you could fill this in", which is exactly false, and it invites the state bug where a stale `cliente_id` rides along on a cash sale. The backend would answer `422` with "Solo las ventas en cuenta corriente llevan cliente", which is a correct message about a request the UI should never have sent.

*Alternative rejected — hide with CSS.* The value stays in state and the field stays in the accessibility tree. Absence is the honest encoding.

The switch **away** from `CUENTA_CORRIENTE` clears `cliente_id` in form state on the same tick as the payment-method change. When editing an existing sale, that switch is also what triggers D5.

### D2 — Day totals are a client-side aggregation, and that is the requirement

There is no totals endpoint, and there should not be one: RN-VTA-05 says period totals and their per-payment-method breakdown are on-demand aggregations, never persisted columns — the same rule as D-01 for supplier balances. The list page reduces the sales it already has.

This is only sound because **`GET /api/ventas` is not paginated** — it returns a bare `list[VentaResponse]`, unlike `/api/pagos`, which returns a paginated `PagoListResponse`. The response is complete for the filter window, so the reduction is complete too. That is a load-bearing property of a backend this change does not own: **if pagination is ever added to `/api/ventas`, these totals silently start under-reporting.** The aggregation helper carries a comment saying so, and the totals are derived from the same query result the list renders, never from a second request — two requests could disagree, and a total that disagrees with the rows under it is worse than no total.

Totals render from first paint with a loading affordance rather than `$0`. A zero that means "not loaded yet" is indistinguishable from a zero that means "you sold nothing today", and a shopkeeper reads the second one as an accusation.

### D3 — Customer names are resolved through a map, not embedded in the sale

`VentaResponse` carries `cliente_id` and no name. The list loads the negocio's customers once via TanStack Query (a stable key, shared across the page) and builds an `id → nombre` lookup. Rows for sales on account render the name; a sale whose customer is missing from the map renders a neutral placeholder rather than a UUID.

*Alternative rejected — fetch `GET /api/clientes/{id}` per row.* N+1 requests for a screen that is meant to open fast at a counter.

*Alternative rejected — ask the backend to embed the name.* It would mean touching `facturas-proveedores-api/`, which this change may not do, and the customers list is small, cacheable, and needed anyway by the customer filter.

### D4 — `api.d.ts` gets hand-written types; `generate-types` is not run

New named exports, matching the style of the 48 already there:

```ts
export type FormaPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'CUENTA_CORRIENTE' | 'OTRO'

export interface Cliente { id, negocio_id, nombre, nombre_normalizado, telefono?, notas?, created_at, updated_at }
export interface ClienteListItem extends Cliente {}
export interface ClienteCreate { nombre: string }
export interface ClienteConflictDetail { mensaje: string; cliente_existente?: { id: string; nombre: string } }

export interface Venta { id, negocio_id, cliente_id: string | null, fecha, monto, forma_pago, notas?, created_at, updated_at }
export interface VentaListItem extends Venta {}
export interface VentaCreate { monto, fecha, forma_pago, cliente_id?, notas? }
export interface VentaUpdate { monto?, fecha?, forma_pago?, cliente_id?, notas? }
export interface VentasFilters { desde?, hasta?, forma_pago?, cliente_id? }
export interface VentaDeleteInput { id: string; cliente_id: string | null; forma_pago: FormaPago }
```

`FormaPago` is deliberately **separate from the existing `MetodoPago`**, matching the backend enum comment: `MetodoPago` is money going *out* to suppliers, carries `MERCADOPAGO`, and has no notion of credit. Sharing them would make a supplier payment expressible as "on account", which is not a thing here.

`monto` is typed `string` on the wire, like every other `Decimal` in this API, and is parsed at the aggregation boundary — never accumulated as a float.

`VentaDeleteInput` carries `cliente_id` and `forma_pago` alongside the `id`, following the `PagoDeleteInput` precedent from C-13: the delete mutation needs to know which customer's cached account to invalidate without an extra `GET`.

**Apply must not run `npm run generate-types`.** It rewrites this file into a different shape and breaks 262 imports. That is C-41's job, not this change's side effect.

### D5 — The disappearing-debt warning: what it says, and when

This is the reason the change exists. `venta_service.eliminar` and `venta_service.actualizar` both hand the problem here by name.

**It fires on exactly two paths**, and only when the sale being acted on is currently `CUENTA_CORRIENTE`:

1. deleting a sale on account;
2. saving an edit whose resulting `forma_pago` is anything other than `CUENTA_CORRIENTE`.

Changing only the amount, the date, the notes, or the *customer* of a fiado does not fire it — the debt still exists and still belongs to someone. Deleting a cash sale gets an ordinary confirmation with no debt paragraph, mirroring `DeleteProveedorDialog`, which renders its warning block only when `hasDependencies`.

**The wording.** Spanish, quoted verbatim for review; `{cliente}` and `{monto}` are interpolated, `{monto}` through the existing `formatCurrency` helper.

*Deleting a sale on account:*

> **Título:** `Eliminar venta fiada`
>
> `Esta venta está en la cuenta corriente de {cliente}. Si la eliminás, {monto} dejan de figurar como deuda suya.`
>
> `Los cobros que ya registraste no se borran. Si ya te pagó una parte, su saldo puede quedar a favor.`
>
> `Hacelo solo si la venta nunca existió o si en realidad te la pagó en el momento.`
>
> **Botones:** `Cancelar` · `Eliminar y quitar la deuda`

*Moving a sale out of cuenta corriente:*

> **Título:** `Sacar la venta de cuenta corriente`
>
> `Esta venta figura como fiado de {cliente} por {monto}. Al cambiarla a {forma_pago}, ese monto deja de ser deuda suya.`
>
> `Los cobros que ya registraste no se borran. Si ya te pagó una parte, su saldo puede quedar a favor.`
>
> **Botones:** `Cancelar` · `Cambiar y quitar la deuda`

*Deleting a sale that is not on account:*

> **Título:** `Eliminar venta`
>
> `¿Querés eliminar la venta de {monto} del {fecha}?`
>
> **Botones:** `Cancelar` · `Eliminar`

Three things about that copy are deliberate:

- **It names the amount and the person.** "¿Estás seguro?" tells the user nothing they did not already know. "$4.500 dejan de figurar como deuda de Juan Pérez" is a fact they can check against what they remember.
- **The confirm button says what happens**, not "Confirmar". The last thing a person reads before clicking should be the consequence.
- **The second paragraph is not padding.** It is the C-35 consequence in plain language — see D6.

The dialog reuses the destructive pattern already settled in `DeleteProveedorDialog`: Radix `Dialog` with `role="alertdialog"`, `aria-modal`, initial focus forced onto **Cancelar**, `onPointerDownOutside` and `onInteractOutside` suppressed so the backdrop cannot dismiss it, Esc still closing via Radix.

### D6 — The balance is signed and may go negative; C-36 is its consumer, not us

C-35 decided the customer balance is a signed `Decimal` that can legitimately be **negative**, and rejected clamping it at zero on read — a balance that lies is worse than one that surprises. The cause is precisely this change's subject: removing a charge while the payments credited against it remain.

C-34 never renders a balance, so nothing here depends on it. It is written down for two reasons: it is why the warning's second paragraph exists, and it is what stops someone in C-36 from "fixing" a negative balance they think is a bug. When C-36 displays the negative case, the wording above is the explanation the user was already given.

### D7 — `src/features/clientes/api/` now, pages in C-36

`CHANGES.md` gives `src/features/clientes/` to C-36, but the autocomplete needs a customers client layer today. C-34 creates only:

```
src/features/clientes/api/clientesApi.ts     ← list, search, create
src/features/clientes/api/clientesHooks.ts   ← CLIENTE_KEYS + hooks
```

This follows the existing precedent exactly: `SupplierSearch` lives in `src/shared/components/` and imports its hooks from `@features/proveedores/api/proveedoresHooks`. C-36 adds `ClientesPage`, `ClienteDetailPage` and the rest of the folder on top of an API layer that already exists and is already tested.

`CLIENTE_KEYS` is exported from the hooks module so C-35/C-36's account view can invalidate it, mirroring how `PAGO_KEYS` and `CUENTA_CORRIENTE_KEYS` cross-invalidate in C-13.

### D8 — Search and identity are the backend's call; the browser only asks

`ClienteAutocomplete` sends the typed fragment to `GET /api/clientes/buscar?nombre=` (trimmed, nothing else) and renders the results **in the order returned** — exact normalized match first, then partial (RN-CLI-02). It implements no normalization, no fuzzy matching, no client-side re-ranking.

`app/core/normalizacion.py` is explicit that this rule *decides identity*, that it deliberately keeps `ñ` intact so "Peña" never becomes "Pena", and that the unique index freezes the rule into stored data. A second rule living in the browser would drift from it, and the drift surfaces as one person's debt split across two accounts — the exact failure the customer entity exists to prevent.

The duplicate path is therefore entirely server-driven: creation attempts `POST /api/clientes`; a `409` comes back carrying `detail.cliente_existente = { id, nombre }`; the component presents that customer as the thing to pick, not an error to dismiss. Accepting it selects the existing customer with no second request.

*Alternative rejected — check for a duplicate before creating.* It is a race (two employees, two devices, one name) and the backend already handles the race by translating the unique-index violation into the same `409`. Asking first would add a round-trip and still need the `409` path.

### D9 — Filters in URL search params, one query key

`VentasPage` reads and writes `desde`, `hasta`, `forma_pago` and `cliente_id` as URL search params and passes them to `useVentas(filters)`, keyed by the filter object — the pattern `PagosPage` established (D-C11-7). A filtered day is a shareable, reloadable URL, and the totals are derived from the same query result the list renders.

The default view is **today**: `desde = hasta = today`, so the page opens on the number the user came to see.

### D10 — "Today" is Argentina's today

`venta_service._validar_fecha` compares against `datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()`. A browser in another timezone — or a machine with a wrong clock — would otherwise default the form to a date the backend rejects, or silently record a sale on the wrong day.

A small helper computes today in `America/Argentina/Buenos_Aires` via `Intl.DateTimeFormat` with an explicit `timeZone`, and it feeds both the form default and the `max` on the date input. `src/shared/utils/date.ts` already exists and is where it goes.

### D11 — Client-side validation makes the form usable, not safe

Amount `> 0`, date not in the future, customer required for a fiado — all validated in the browser so the user is not punished by a round-trip. None of it is the guarantee. The backend validates with Pydantic and its own service checks, and the form **surfaces the backend's `detail` message** when a submission is refused instead of showing a generic failure. Those messages were written to explain the rule ("Una venta en cuenta corriente necesita un cliente: sin él la deuda no es de nadie…") and are better than anything the form would invent.

### D12 — Visual language is inherited, not invented

The app has a settled violet/magenta/beige/Inter system. `VentasPage` composes `PageHeader` + filters + list exactly as `PagosPage` does; the totals strip uses the existing `Card`; badges for `forma_pago` follow `MetodoBadge`; empty and loading states use `EmptyState` and `LoadingState`. Tailwind v4's `dark:` variant is wired to a `.dark` class through CSS — `darkMode: 'class'` is **not** reintroduced into any JS config.

## Risks / Trade-offs

- **The warning ships as a generic confirmation** → the change satisfies its scope and fails its purpose. Mitigated by specs that assert the customer's name and the formatted amount are present in the dialog, and by making that the highest-value test in the change.
- **`GET /api/ventas` becomes paginated later** → the day's totals silently under-report, and nothing fails loudly. Mitigated by a comment at the aggregation site tying the correctness of the reduction to the unpaginated response, and by naming it in the proposal so it is on the record rather than in someone's head.
- **A future contributor runs `npm run generate-types`** → 262 imports break. Mitigated by stating it in D4, in the proposal, and in the tasks; the real fix is C-41.
- **The customers map goes stale** → a sale on account shows a placeholder instead of a name. Acceptable: the sale is still correct and the customers query is invalidated by the inline-creation mutation, so the common case (a customer created seconds ago) resolves immediately.
- **Two dialogs for one idea** (delete-fiado and leave-cuenta-corriente) → duplicated copy that can drift apart. Mitigated by one component parameterised over the two paths, with the shared paragraph written once.
- **Decimal money in JavaScript** → floating-point drift in the totals. Mitigated by parsing amounts at the aggregation boundary and formatting through the existing `formatCurrency`; the totals are display values recomputed from source rows on every render, never accumulated across renders and never sent back to the server.

## Migration Plan

Additive. New routes (`/ventas`, `/ventas/nueva`, `/ventas/:id/editar`), a new nav entry, new feature folders, and new named exports in `api.d.ts`. No existing route, component or type changes behaviour, so rollback is reverting the commit — there is no data or schema to unwind, and the backend is untouched.

## Open Questions

- **Where the "Cargar venta" entry point lives on Home.** `HomePage` currently makes the IA-carga hero the protagonist. A sale is the most frequent action in the new stage, but rearranging the home screen is a design decision beyond this change's scope. C-34 ships the nav entry and the `/ventas` page; promoting it on Home is deferred.
- **Whether the day's totals should also appear on Home.** Likely yes, and likely C-37's call once real aggregations exist. Not built here.
- **Editing a fiado's customer** moves debt from one person to another without deleting it, so D5 does not fire. Whether that transfer deserves its own confirmation is a product question; it is currently allowed silently, matching the backend.
