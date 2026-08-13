> **Strict TDD is active.** Every task below that produces behaviour is written as the behaviour its test must pin. Write the test first (RED), the minimum code to pass it (GREEN), a second case with different inputs (TRIANGULATE), then clean up (REFACTOR). Test command: `cd facturas-proveedores-web && npm test`.
>
> **Do NOT run `npm run generate-types`.** `src/shared/api/api.d.ts` is hand-written; regenerating it rewrites the file into the `openapi-typescript` shape and breaks 262 imports. Types for this change are added by hand (design.md D4). Migrating to generated types is C-41.
>
> The backend under `facturas-proveedores-api/` is read-only for this change.

## 1. Safety net

- [x] 1.1 Run `cd facturas-proveedores-web && npm test` and confirm the baseline: **569 tests passing across 76 files** (measured 2026-08-12, full run ≈ 224s). Any failure at this point is pre-existing — report it, do not fix it here.

## 2. Types (hand-written, no codegen)

- [x] 2.1 Add to `src/shared/api/api.d.ts`, in the style of the 48 named types already there: `FormaPago` (`EFECTIVO` | `TRANSFERENCIA` | `TARJETA` | `CUENTA_CORRIENTE` | `OTRO`), `Cliente`, `ClienteListItem`, `ClienteCreate`, `ClienteConflictDetail`, `Venta`, `VentaListItem`, `VentaCreate`, `VentaUpdate`, `VentasFilters`, `VentaDeleteInput`. Amounts typed as `string` (Decimal on the wire), `cliente_id` as `string | null`.
- [x] 2.2 Test: `FormaPago` is not `MetodoPago` — a compile-time/runtime assertion that `CUENTA_CORRIENTE` is a valid `FormaPago` and that `MERCADOPAGO` is not, mirroring `src/shared/api/api.pagos.test.ts`. Backend rationale: `MetodoPago` is money going out to suppliers and has no notion of credit.
- [x] 2.3 Test: `VentaCreate` has no `negocio_id` and no `creado_por_usuario_id` key — both come from the session server-side.
- [x] 2.4 Add `src/features/ventas/types.ts` and `src/features/clientes/types.ts` re-exporting the domain types, following the `src/features/pagos/types.ts` precedent.

## 3. Customers API layer (`src/features/clientes/api/`)

- [x] 3.1 Test: `buscarClientes(fragment)` calls `GET /api/clientes/buscar` with `nombre` set to the trimmed fragment and returns the results **in the order the server sent them** — no client-side sorting or filtering (spec: "The frontend does not decide which names mean the same person").
- [x] 3.2 Test: `crearCliente({ nombre })` posts only `nombre` — no `nombre_normalizado`, no `negocio_id`.
- [x] 3.3 Test: `listClientes()` returns the negocio's active customers (used to build the id→name map and the customer filter).
- [x] 3.4 Implement `src/features/clientes/api/clientesApi.ts` on the shared `apiClient`.
- [x] 3.5 Test: `useBuscarClientes(query)` is disabled below the minimum query length and enabled above it; `CLIENTE_KEYS` are exported so other features can invalidate them.
- [x] 3.6 Test: `useCreateCliente` invalidates `CLIENTE_KEYS.all` on success, so a customer created inline appears in the list and in the id→name map immediately.
- [x] 3.7 Implement `src/features/clientes/api/clientesHooks.ts` (`CLIENTE_KEYS`, `useClientes`, `useBuscarClientes`, `useCreateCliente`), mirroring `proveedoresHooks.ts`.

## 4. `ClienteAutocomplete` (shared component)

- [x] 4.1 Test: typing a fragment that matches customers renders them as `role="option"` items inside a `role="listbox"`, with the input exposing `role="combobox"` and `aria-expanded` — same contract as `SupplierSearch`.
- [x] 4.2 Test: choosing a suggestion reports that customer to the parent via `onChange` and displays it as the current selection; clearing the selection reports `null`.
- [x] 4.3 Test (keyboard): ArrowDown / ArrowUp move the active option, Enter selects it, Escape closes the list — no pointer involved.
- [x] 4.4 **Test (inline creation, spec scenario):** when the typed name matches nothing, an option to create that customer is offered; taking it posts only `{ nombre }`, and on success the new customer becomes the current selection — **with no modal opened and no navigation** (assert the surrounding form's already-entered fields are still present).
- [x] 4.5 **Test (duplicate suggestion, spec scenario):** when creation is answered `409` with `detail.cliente_existente = { id, nombre }`, the component offers **that existing customer by name** rather than surfacing an error; accepting it selects that customer and issues **no second POST**.
- [x] 4.6 Test: a creation failure that is not a `409` shows an error and leaves the surrounding form's entered values intact.
- [x] 4.7 Test: no client-side normalization — a fragment with accents is sent to the backend as typed (apart from trimming), and the rendered order equals the response order.
- [x] 4.8 Implement `src/shared/components/ClienteAutocomplete/ClienteAutocomplete.tsx`, mirroring `SupplierSearch` (chip for the selection, dropdown, `Plus` affordance for creation), plus the `409` branch that `SupplierSearch` has no equivalent of.

## 5. Sales API layer (`src/features/ventas/api/`)

- [x] 5.1 Test: `listVentas(filters)` sends `desde`, `hasta`, `forma_pago` and `cliente_id` only when set, and omits empty ones entirely.
- [x] 5.2 Test: `createVenta` posts `cliente_id` **only** when `forma_pago === 'CUENTA_CORRIENTE'`.
- [x] 5.3 **Test (D5/D7 contract):** `updateVenta` never sends `cliente_id: null` — a sale moved out of cuenta corriente sends the new `forma_pago` and no `cliente_id` key, because `PATCH /api/ventas/{id}` reads an absent `cliente_id` as "leave it alone" and clears it as a consequence of the payment method.
- [x] 5.4 Test: `deleteVenta(input: VentaDeleteInput)` takes the `cliente_id` and `forma_pago` alongside the `id`, following the `PagoDeleteInput` precedent, so cache invalidation needs no extra `GET`.
- [x] 5.5 Implement `src/features/ventas/api/ventasApi.ts`.
- [x] 5.6 Test: `useVentas(filters)` keys by the filter object; create/update/delete mutations invalidate `VENTA_KEYS.all`, and — when the affected sale was on account — also the customer keys, so C-35/C-36's account view refreshes (mirrors the C-13 cross-feature invalidation in `pagosHooks.ts`).
- [x] 5.7 Implement `src/features/ventas/api/ventasHooks.ts` (`VENTA_KEYS`, `useVentas`, `useVenta`, `useCreateVenta`, `useUpdateVenta`, `useDeleteVenta`).

## 6. Counter form — the conditional customer field

- [x] 6.1 **Test (spec scenario, appears):** switching the payment method to *Cuenta corriente* makes the customer field present and reachable.
- [x] 6.2 **Test (spec scenario, disappears):** with a customer selected on a *Cuenta corriente* sale, switching to *Efectivo* removes the field **from the document** (not merely hidden) and submitting sends **no `cliente_id`**.
- [x] 6.3 Test: a *Cuenta corriente* sale with no customer chosen cannot be submitted, and the message says a fiado needs a customer.
- [x] 6.4 Test: the form opens with today's date in `America/Argentina/Buenos_Aires` and with focus on the amount field.
- [x] 6.5 Test: a future date and a non-positive amount are each refused with a message naming the rule.
- [x] 6.6 Test: when the backend answers `422`, its `detail` message is displayed rather than a generic failure (client validation is for usability; the backend is the guarantee).
- [x] 6.7 Add the "today in Argentina" helper to `src/shared/utils/date.ts` (`Intl.DateTimeFormat` with an explicit `timeZone`), with tests covering a browser clock in a different timezone.
- [x] 6.8 Implement `src/features/ventas/components/VentaForm.tsx` and `src/features/ventas/VentaFormPage.tsx` (create + edit), composing `ClienteAutocomplete` for the conditional field.

## 7. Sales list, filters and the day's totals

- [x] 7.1 Test: the list renders the negocio's sales newest first, with a payment-method badge per row (following `MetodoBadge`).
- [x] 7.2 Test: filtering by payment method requests only that method; filtering by date range includes **both** bounds; filtering by customer passes `cliente_id`.
- [x] 7.3 Test: filters are written to and read back from the URL search params, so a filtered view survives a reload (the `PagosPage` pattern).
- [x] 7.4 Test: a sale on account renders the **customer's name**, resolved through the id→name map — no UUID appears in the row; an unresolvable customer renders a neutral placeholder.
- [x] 7.5 Test: empty state and loading state are distinguishable from one another.
- [x] 7.6 **Test (spec scenario, totals):** a day holding $1.000 `EFECTIVO`, $2.500 `TARJETA` and $500 `CUENTA_CORRIENTE` shows a total of $4.000 and a breakdown listing each method with its own subtotal.
- [x] 7.7 **Test (spec scenario, totals while loading):** while the sales request is in flight, the totals region is present with a loading affordance and does **not** show `$0`; after loading, a genuinely empty day shows `$0`.
- [x] 7.8 Implement the aggregation helper (pure function: sales in, `{ total, porFormaPago }` out), parsing the decimal strings at the boundary. Comment at the call site that the reduction is complete **only because `GET /api/ventas` is unpaginated** — if pagination is added there, these totals start under-reporting.
- [x] 7.9 Implement `VentasFilters`, `VentasList`, `VentaCard`, `TotalesDelDia`, and `src/features/ventas/VentasPage.tsx` (default view = today).

## 8. The disappearing-debt warning

- [x] 8.1 **Test (the highest-value test in this change):** requesting deletion of a $4.500 sale on account belonging to "Juan Pérez" opens a confirmation containing **both** the customer's name **and** the formatted amount, and stating that the amount stops being owed. A dialog that only asks "¿Estás seguro?" fails this test.
- [x] 8.2 Test: the same warning appears — before any request is sent — when an existing sale on account is edited so its payment method becomes something else, and saving is requested.
- [x] 8.3 Test: cancelling sends no request and leaves the sale unchanged.
- [x] 8.4 Test: the dialog states that payments already recorded are not removed and that the balance may end up in the customer's favour (C-35 defines the balance as signed and legitimately negative for exactly this reason).
- [x] 8.5 Test: deleting a sale that is **not** on account confirms without any mention of debt, of a customer, or of an amount ceasing to be owed.
- [x] 8.6 Test: changing only the amount, date or notes of a fiado does **not** trigger the warning — the debt still exists and still belongs to someone.
- [x] 8.7 Test (accessibility, the `DeleteProveedorDialog` contract): `role="alertdialog"` with `aria-modal`, initial focus on **Cancelar**, backdrop click does not dismiss, Esc closes.
- [x] 8.8 Implement `src/features/ventas/components/DeudaDesapareceDialog.tsx` — one component parameterised over the two paths (delete / leave cuenta corriente) with the shared paragraph written once. Copy verbatim from design.md D5.

## 9. Wiring

- [x] 9.1 Add `/ventas`, `/ventas/nueva` and `/ventas/:id/editar` to `src/app/router.tsx` under `AuthenticatedLayout`.
- [x] 9.2 Add the `Ventas` entry to `NAV_ITEMS` in `AppLayout`, with a test asserting it is offered to every member (not admin-gated).
- [x] 9.3 Test: the sales screens follow the existing design system — no new visual language, and `darkMode: 'class'` is **not** reintroduced into any JS config (Tailwind v4 wires `dark:` to a `.dark` class through CSS).

## 10. Close

- [x] 10.1 Run the full suite and confirm every pre-existing test still passes on top of the new ones. Report the final count against the 569/76 baseline.
- [x] 10.2 Confirm `src/shared/api/api.d.ts` still exports the original 48 named types plus the new ones, and that `npm run generate-types` was never run.
- [x] 10.3 Mutation check on what this change promises: (a) make the customer field render unconditionally, (b) strip the customer name and amount out of the warning copy. **Each mutation must break at least one test.** Assert the mutation was actually applied before reading the result.
- [x] 10.4 Confirm nothing under `facturas-proveedores-api/`, `knowledge-base/` or `CHANGES.md` was modified.
