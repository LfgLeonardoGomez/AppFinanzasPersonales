## Why

C-33 shipped the sales backend yesterday, and nothing in the app can reach it. The shop can record what it buys and what it owes, but the only way to record what it *sells* today is an HTTP client. This change is the counter: the screen someone actually stands at, with a customer waiting, to write down a sale.

There is a second reason, and it is the sharper one. C-33 made the fiado a `Venta` with `forma_pago = CUENTA_CORRIENTE` (D-33) — one row that is both the day's sale and the charge on the customer's account. That design is correct, and it has a consequence the backend deliberately handed to the frontend: **deleting a fiado, or moving one out of *Cuenta corriente*, makes a customer's debt disappear.** `venta_service.actualizar` and `venta_service.eliminar` both say so in their docstrings, and both name C-34 as the place where it gets made visible. Nobody else is going to tell the user. This change is the only place the warning can live.

## What Changes

- **New feature `src/features/ventas/`** — a filterable sales list (date range, payment method, customer) and a counter-optimised entry form.
- **Counter form**: amount, date (defaulting to today in `America/Argentina/Buenos_Aires`), payment method. **The customer field appears only when the payment method is *Cuenta corriente*** — the field's visibility *is* the backend invariant `cliente_id IS NOT NULL ⟺ forma_pago = CUENTA_CORRIENTE` (RN-VTA-03), not a decoration on top of it.
- **New shared component `ClienteAutocomplete`** — mirrors the existing `SupplierSearch`: suggests while typing, and when nothing matches offers **inline creation with no modal and no navigation** (RN-CLI-01/02). When the typed name collides with an existing customer, the backend's `409` carries that customer, and the component offers **the existing one instead of creating a second** (RN-CLI-03).
- **New client layer `src/features/clientes/api/`** — `clientesApi.ts` + `clientesHooks.ts` against the C-32 endpoints. Only the API layer; the customer *pages* belong to C-36.
- **Disappearing-debt warning** — a destructive-confirmation dialog, in the spirit of RN-PROV-04, shown when a delete or an edit would remove a live charge from a customer's account. It names the customer and the amount that stops being owed. It is not a generic "are you sure?".
- **Day totals with a per-payment-method breakdown**, computed on-demand in the browser over the loaded sales (RN-VTA-05 forbids persisting them), and legible while the list is still loading.
- **Hand-written types** for `Venta` and `Cliente` added to `src/shared/api/api.d.ts`, consistent with the 48 named types already there. `npm run generate-types` is **not** run — see design.md.
- **Route + navigation**: `/ventas`, `/ventas/nueva`, `/ventas/:id/editar`, and a `Ventas` entry in `AppLayout`'s nav.

**Out of scope**: customer balances, charges, and the customer account view (C-35 backend / C-36 frontend); aggregations and statistics beyond the day's totals (C-37/C-38); export (C-39); a customer list or detail page (C-36).

## Capabilities

### New Capabilities
- `ventas-frontend`: the sales screen — the counter form and its conditional customer field, the filterable list, the day's totals, and the warning shown before a customer's debt is made to disappear.
- `clientes-frontend`: the customer autocomplete shared across the app — suggestion while typing, inline creation without leaving the form, and the duplicate-name path that offers the existing customer rather than a second account.

### Modified Capabilities
<!-- None. No existing frontend capability changes its requirements; the AppLayout nav entry and the new route are additive. -->

## Impact

**Frontend** — `src/features/ventas/` (page, form page, `api/`, `components/`), `src/features/clientes/api/`, `src/shared/components/ClienteAutocomplete/`, `src/shared/api/api.d.ts`, `src/app/router.tsx`, `src/shared/components/AppLayout/AppLayout.tsx`. Nothing under `facturas-proveedores-api/` is touched.

**Contract mismatches found while reading the C-32/C-33 backend.** Each is a place where `CHANGES.md` reads as though something exists that does not; none blocks the change, and all are resolved in design.md:

1. **`VentaResponse` carries `cliente_id`, not a customer name.** The list cannot render "Juan Pérez" from a sale alone; it has to resolve names from `GET /api/clientes`.
2. **There is no totals endpoint.** `CHANGES.md` says "totales del día visibles al cargar" as if it were a read. It is a client-side aggregation over the day's sales — which is what RN-VTA-05 actually requires.
3. **`GET /api/ventas` is not paginated.** It returns a bare `list[VentaResponse]`, unlike `/api/pagos` which returns a paginated `PagoListResponse`. The day-totals aggregation is only sound *because* the response is complete for the filter window; if pagination is ever added to that endpoint, the totals silently start lying.
4. **`ProveedorAutocomplete` does not exist.** The component `CHANGES.md` tells us to mirror is called `SupplierSearch` and lives at `src/shared/components/SupplierSearch/`.
5. **`src/features/clientes/` is scheduled for C-36**, but the autocomplete needs a customers API layer now. C-34 creates only `src/features/clientes/api/`; C-36 adds the pages on top of it.
6. **C-34's stated dependencies are C-30 and C-33**, but the autocomplete consumes C-32 (`/api/clientes`, `/api/clientes/buscar`) directly. C-32 is archived, so this is a documentation gap, not a blocker.
7. **`PATCH /api/ventas/{id}` cannot be told to clear `cliente_id`.** `VentaUpdate.cliente_id` is `Optional`, and the service reads absence as "leave it alone". Clearing happens *implicitly*, by sending a `forma_pago` other than `CUENTA_CORRIENTE`. The edit form must never attempt to send `cliente_id: null`.

**Risk — the warning is the whole change.** Everything else here is a form and a list against endpoints that already work. If the warning ships vague ("¿Estás seguro?"), the change technically satisfies its scope and completely fails its purpose: a person deletes a sale to fix a typo and quietly erases what a customer owes. C-35 has since made this sharper still — it decided the customer balance is a **signed** `Decimal` that may legitimately go **negative**, precisely because a charge can be removed while the payments credited against it remain. The warning is therefore the last point at which a human is told, before the accounting stops adding up.

**Risk — a second customer for the same person.** If the autocomplete implements its own name normalization, it will drift from `app/core/normalizacion.py` (which deliberately preserves `ñ`, so "Peña" never collapses into "Pena"). Two rules that disagree about identity mean one customer's debt split across two accounts. The frontend must ask the backend, never decide.

**Governance: MEDIO.** No auth, no isolation axis, no money moving. But it is the surface through which debt gets created and destroyed, so the destructive paths get checkpointed rather than waved through.
