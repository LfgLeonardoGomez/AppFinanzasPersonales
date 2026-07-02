# Cuenta Corriente Frontend Specification

## Purpose

New capability: the web interface of the PWA (`facturas-proveedores-web`) that consumes the C-12 `GET /api/proveedores/{id}/cuenta-corriente` endpoint and renders, per supplier, the on-demand `{ saldo, facturas_con_estado, historial }` triple. The frontend is **read-only and render-only** over the C-12 response: it SHALL NOT recompute `saldo`, `estado`, or `saldo_acumulado` (RN-SALDO, RN-FIFO, RN-HIST). The frontend SHALL also wire **cross-feature cache invalidation** so that any `Factura` or `Pago` mutation on a given supplier automatically refreshes the cuenta-corriente view of that supplier — the triple is on-demand, the cache must reflect that. All this sits behind the same `RequireAuthWithBootstrap` auth guard as the rest of the PWA, and all HTTP calls go through the shared Axios client (C-04).

## ADDED Requirements

### Requirement: Cuenta-corriente view renders the on-demand triple per supplier

The frontend SHALL expose a private route `/proveedores/:id` (behind `RequireAuthWithBootstrap`) that renders the supplier's cuenta-corriente via a single `useCuentaCorriente(proveedorId)` call against `GET /api/proveedores/{id}/cuenta-corriente`. The view SHALL display three blocks: a header (supplier name + signed `saldo` via `SaldoBadge`), a list of `facturas_con_estado` (each row showing the FIFO `estado` via the existing `EstadoBadge` from C-09), and a chronological `historial` with row-by-row `saldo_acumulado`. The frontend SHALL render the `saldo`, `estado`, and `saldo_acumulado` values **verbatim** from the response — no client-side arithmetic, no re-ranking, no recomputation. The header supplier name SHALL come from the existing `useProveedor(id)` (C-07). The view SHALL surface empty / loading / 404 / generic-error states with copy that matches the C-12 error contract (401 → handled by the global Axios interceptor; 404 → "Proveedor no encontrado"; other errors → "No se pudo cargar la cuenta corriente. Reintentar" with a `refetch` button).

#### Scenario: authenticated access renders the triple for an own supplier

- **WHEN** an authenticated user navigates to `/proveedores/{id}` for a supplier they own that has active invoices and payments
- **THEN** the page renders the supplier name from `useProveedor`, the `SaldoBadge` with the value from `useCuentaCorriente.data.saldo`, the `TablaFacturasConEstado` with each row's `estado` from `useCuentaCorriente.data.facturas_con_estado[i].estado`, and the `HistorialCronologico` with each row's `saldo_acumulado` from `useCuentaCorriente.data.historial[i].saldo_acumulado` — and the frontend performs no arithmetic to derive any of these values

#### Scenario: empty cuenta-corriente shows the empty state

- **WHEN** an authenticated user navigates to `/proveedores/{id}` for an own supplier that has no active invoices and no active payments
- **THEN** the page shows the "Sin movimientos registrados" empty state with "Cargar factura" and "Cargar pago" CTAs scoped to the current supplier, and no table rows

#### Scenario: 404 on foreign / missing / soft-deleted supplier shows the empty state, not 403

- **WHEN** an authenticated user navigates to `/proveedores/{id}` for a supplier that is foreign, soft-deleted, or missing
- **THEN** the page shows the "Proveedor no encontrado" empty state with a link to `/proveedores`, and no data from the foreign resource is leaked

#### Scenario: unauthenticated access redirects to login

- **WHEN** a user without a valid session navigates to `/proveedores/{id}`
- **THEN** `RequireAuthWithBootstrap` redirects them to `/login`

#### Scenario: the page header combines useProveedor and useCuentaCorriente

- **WHEN** the page mounts
- **THEN** the supplier name and the saldo appear in the header, sourced from the two parallel queries (`useProveedor` and `useCuentaCorriente`); neither query blocks the other; a header skeleton is shown until each resolves

#### Scenario: generic error renders the refetch CTA

- **WHEN** the `useCuentaCorriente` query errors with anything other than 401 / 404
- **THEN** the page renders "No se pudo cargar la cuenta corriente" with a "Reintentar" button that calls `refetch()`

### Requirement: SaldoBadge color-codes the signed saldo and never recomputes

The frontend SHALL render the `saldo` value via a `SaldoBadge` component that receives `saldo: number` as a prop. The component SHALL apply color tokens as follows: `saldo > 0` (deuda) → red, `saldo === 0` (al día) → green, `saldo < 0` (a favor) → blue. For the `a favor` case the rendered text SHALL append the literal " a favor" to the formatted amount. The badge SHALL display the absolute value formatted as ARS via `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })`. The component SHALL NOT call the API, SHALL NOT read from a Zustand store, and SHALL NOT perform any arithmetic on its input — only the sign-dispatch mapping from input to color class. The four branches (`> 0`, `< 0`, `=== 0`, defensive default for `NaN`) SHALL be unit-tested.

#### Scenario: positive saldo renders red with the absolute ARS value

- **WHEN** `SaldoBadge` is rendered with `saldo={1500.5}`
- **THEN** the rendered text is the absolute value formatted as ARS and the badge has a red color class

#### Scenario: zero saldo renders green

- **WHEN** `SaldoBadge` is rendered with `saldo={0}`
- **THEN** the badge has a green color class

#### Scenario: negative saldo renders blue with " a favor" suffix

- **WHEN** `SaldoBadge` is rendered with `saldo={-500}`
- **THEN** the badge has a blue color class and the rendered text contains the absolute value formatted as ARS followed by the literal " a favor"

#### Scenario: NaN fallback does not crash

- **WHEN** `SaldoBadge` is rendered with `saldo={NaN}` (defensive default)
- **THEN** the badge still renders a non-empty element (the unknown-state color) and does not throw

### Requirement: TablaFacturasConEstado shows the FIFO estado and filters on response fields

The frontend SHALL render the `facturas_con_estado` array via a `TablaFacturasConEstado` component that receives the array, a filter state, and a filter-change callback as props. The component SHALL render a table with one row per factura and SHALL display the existing `EstadoBadge` from C-09 (PENDIENTE / PARCIAL / PAGADA) per row. The component SHALL accept filters `{ estado?: 'PENDIENTE' | 'PARCIAL' | 'PAGADA'; fecha_desde?: string; fecha_hasta?: string }` applied on the response payload fields (`f.estado` and `f.fecha_emision`) — the component SHALL NOT re-issue the cuenta-corriente request with new params (the endpoint has no query params; the filters are client-side). When the filtered result is empty, the component SHALL render "No hay facturas con esos filtros" and a "Limpiar filtros" button. The `FiltrosFacturas` sub-component SHALL render three controls: an `estado` select (with the four options `Todos / PENDIENTE / PARCIAL / PAGADA`), a `fecha_desde` date input, and a `fecha_hasta` date input.

#### Scenario: table renders one row per factura with the response estado

- **WHEN** `TablaFacturasConEstado` receives a `facturas` array of N items and `filters = {}`
- **THEN** the table renders N rows, each with the `estado` shown via `EstadoBadge` matching the row's `estado` field — no row has a different badge than what the response provides

#### Scenario: estado filter narrows the rendered rows on the response field

- **WHEN** the user selects `estado = PENDIENTE` and the response includes a mix of PENDIENTE / PARCIAL / PAGADA rows
- **THEN** only the rows whose `estado === 'PENDIENTE'` are rendered, and the new filter is applied on the response payload (no HTTP request is made)

#### Scenario: fecha range filter narrows the rendered rows

- **WHEN** the user selects `fecha_desde = '2026-06-01'` and `fecha_hasta = '2026-06-30'` and the response includes rows with `fecha_emision` inside and outside that range
- **THEN** only the rows whose `fecha_emision` is inside the range are rendered, and no HTTP request is made

#### Scenario: combined filters compose

- **WHEN** the user selects `estado = PARCIAL` and a fecha range
- **THEN** only the rows that satisfy both filters are rendered

#### Scenario: empty filtered result shows the "no hay facturas" state with a "Limpiar filtros" CTA

- **WHEN** the current filter combination yields zero rows
- **THEN** the component renders "No hay facturas con esos filtros" and a "Limpiar filtros" button that resets the filter state to `{}`

### Requirement: HistorialCronologico shows the chronological merge with saldo_acumulado per row

The frontend SHALL render the `historial` array via a `HistorialCronologico` component that receives the array as a prop. The component SHALL render a table with one row per `EntradaHistorial` in the order received from the response (the C-12 contract guarantees chronological order). Each row SHALL display: `fecha` (formatted), a `tipo` chip (red "Debe" for `FACTURA`, blue "Haber" for `PAGO`), the absolute `monto` formatted as ARS, and the signed `saldo_acumulado` formatted as ARS with a sign prefix (`+`, `−`, or no prefix for zero). The component SHALL NOT walk the array, SHALL NOT split between debe and haber, and SHALL NOT compute a running sum — all numeric values are read from the response. The `monto` field in the response is always positive; the sign comes from `tipo`. The `saldo_acumulado` of the last row SHALL equal the `saldo` of the response (the C-12 cross-check invariant); a regression test asserts the rendered last row matches the rendered `SaldoBadge` value.

#### Scenario: historial renders rows in response order with tipo chips

- **WHEN** `HistorialCronologico` receives a non-empty `historial` array from the response
- **THEN** one row is rendered per entry, in the same order, with the `tipo` chip ("Debe" for FACTURA, "Haber" for PAGO) and the absolute `monto` formatted as ARS

#### Scenario: saldo_acumulado is rendered with a sign prefix and ARS format

- **WHEN** a row has `saldo_acumulado = 1500.00`
- **THEN** the rendered text is `+` followed by the ARS-formatted absolute value; for `saldo_acumulado = -300.00` the rendered text is `−` followed by the ARS-formatted absolute value; for `saldo_acumulado = 0` no sign prefix is rendered

#### Scenario: last row's saldo_acumulado equals the response saldo

- **WHEN** the response has a non-empty `historial`
- **THEN** the last row's rendered `saldo_acumulado` equals the `SaldoBadge` value rendered in the page header (both come from the same response, no recomputation)

#### Scenario: empty historial shows the "sin movimientos" empty state

- **WHEN** the response has `historial = []`
- **THEN** the component renders "Sin movimientos registrados" and no table rows

### Requirement: Cross-feature cache invalidation on every Factura and Pago mutation

The frontend SHALL wire cross-feature cache invalidation so that any mutation of a `Factura` or `Pago` for a given supplier X triggers a fresh `useCuentaCorriente(X)` fetch. Specifically, the `useCreateFactura`, `useUpdateFactura`, `useDeleteFactura`, `useCreatePago`, `useUpdatePago`, and `useDeletePago` hooks SHALL each call `queryClient.invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', proveedorId] })` on success, where `proveedorId` is the supplier affected by the mutation. The `proveedorId` SHALL be sourced as follows: for `useCreate*`, from the mutation payload (`data.proveedor_id`); for `useUpdate*`, from the response of the PATCH (`updated.proveedor_id`); for `useDelete*`, from the `proveedor_id` carried in the new delete-input signature `{ id, proveedor_id }`. The `useDeleteFactura` and `useDeletePago` signatures SHALL change from `deleteMutation.mutate(id)` to `deleteMutation.mutate({ id, proveedor_id })`; the list call sites in `FacturasList` and `PagosList` SHALL pass the `proveedor_id` from the row being deleted. A regression test (`cacheInvalidation.test.tsx`) SHALL spy on the QueryClient and assert that every one of the six mutations invalidates the `cuenta-corriente.detail(proveedorId)` key.

#### Scenario: creating a factura for supplier X invalidates the cuenta-corriente cache for X

- **WHEN** `useCreateFactura` is called with `data.proveedor_id = X` and the mutation succeeds
- **THEN** the QueryClient calls `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', X] })`

#### Scenario: updating a factura of supplier X invalidates the cuenta-corriente cache for X

- **WHEN** `useUpdateFactura` is called with `id` of a factura whose `proveedor_id = X` (read from the PATCH response) and the mutation succeeds
- **THEN** the QueryClient calls `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', X] })`

#### Scenario: deleting a factura of supplier X invalidates the cuenta-corriente cache for X

- **WHEN** `useDeleteFactura` is called with `{ id, proveedor_id: X }` and the mutation succeeds
- **THEN** the QueryClient calls `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', X] })`

#### Scenario: creating a pago for supplier X invalidates the cuenta-corriente cache for X

- **WHEN** `useCreatePago` is called with `data.proveedor_id = X` and the mutation succeeds
- **THEN** the QueryClient calls `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', X] })`

#### Scenario: updating a pago of supplier X invalidates the cuenta-corriente cache for X

- **WHEN** `useUpdatePago` is called with `id` of a pago whose `proveedor_id = X` (read from the PATCH response) and the mutation succeeds
- **THEN** the QueryClient calls `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', X] })`

#### Scenario: deleting a pago of supplier X invalidates the cuenta-corriente cache for X

- **WHEN** `useDeletePago` is called with `{ id, proveedor_id: X }` and the mutation succeeds
- **THEN** the QueryClient calls `invalidateQueries({ queryKey: ['cuenta-corriente', 'detail', X] })`

#### Scenario: the cuenta-corriente view reactively refreshes after a mutation

- **WHEN** the user is on `/proveedores/{X}` and creates a `Pago` for supplier X via the "Cargar pago" button
- **THEN** the cuenta-corriente view re-fetches (TanStack Query triggers a refetch on invalidation) and the new `saldo`, the updated `facturas_con_estado`, and the updated `historial` are reflected on the next render — no manual reload is required

#### Scenario: delete call sites pass the supplier id

- **WHEN** the `FacturasList` row's "Eliminar" button is clicked for a factura with `proveedor_id = X`
- **THEN** the delete mutation is called with `{ id: factura.id, proveedor_id: X }` — the test asserts the wire payload reaches the `invalidateQueries` call with `X`

### Requirement: ProveedorDetailPage integrates the triple with create-factura and create-pago actions

The frontend SHALL expose a `ProveedorDetailPage` component (rendered at `/proveedores/:id`) that integrates the cuenta-corriente view with two action buttons. The page SHALL fetch the supplier name via the existing `useProveedor(id)` (C-07) and the cuenta-corriente triple via the new `useCuentaCorriente(id)`. The header SHALL display the supplier name and the `SaldoBadge`. Below the header, two `Link` controls SHALL navigate to `/facturas/nueva?proveedor_id={id}` and `/pagos/nuevo?proveedor_id={id}` respectively. The cuenta-corriente view SHALL be rendered below the action row. The page SHALL surface a header skeleton (supplier name placeholder + saldo placeholder) while the queries are loading, a "Proveedor no encontrado" empty state if either query 404s, and a "Reintentar" CTA on generic errors. The page SHALL NOT introduce new mutation hooks — it only consumes the existing `useProveedor` and the new `useCuentaCorriente`.

#### Scenario: detail page renders the triple with action buttons scoped to the supplier

- **WHEN** an authenticated user opens `/proveedores/{id}` for a supplier they own
- **THEN** the page shows the supplier name in the header, the `SaldoBadge` with the response's `saldo`, the action buttons linking to `/facturas/nueva?proveedor_id={id}` and `/pagos/nuevo?proveedor_id={id}`, and the cuenta-corriente triple below — all data comes from the responses, none is computed

#### Scenario: action buttons carry the supplier id as a query string

- **WHEN** the user clicks "Cargar factura" on `/proveedores/{id}`
- **THEN** the browser navigates to `/facturas/nueva?proveedor_id={id}` and the existing `FacturaFormPage` (C-09) pre-fills the supplier with the given id (existing behavior extended in this change)

#### Scenario: action buttons carry the supplier id for pagos

- **WHEN** the user clicks "Cargar pago" on `/proveedores/{id}`
- **THEN** the browser navigates to `/pagos/nuevo?proveedor_id={id}` and the existing `PagoFormPage` (C-11) pre-fills the supplier with the given id (existing behavior extended in this change)

#### Scenario: the detail page is accessible only to authenticated users

- **WHEN** a user without a valid session navigates to `/proveedores/{id}`
- **THEN** `RequireAuthWithBootstrap` redirects them to `/login`

### Requirement: ProveedoresList rows link to the detail page

The frontend SHALL add a "Ver cuenta corriente" link on each row of the existing `ProveedoresList` (C-07). Clicking the link SHALL navigate the user to `/proveedores/{id}` for the corresponding supplier. The link SHALL NOT replace the existing "Editar" / "Eliminar" controls on the row — it is additive.

#### Scenario: each row exposes a link to the detail page

- **WHEN** `ProveedoresList` renders a row for a supplier with id `X`
- **THEN** the row contains a "Ver cuenta corriente" link whose `href` is `/proveedores/X` and clicking it navigates to the detail page

### Requirement: Home quick-access surfaces the cuenta-corriente view

The frontend SHALL add a "Ver cuenta corriente" entry in the inlined `HomePage` (`src/app/router.tsx`) that links to `/proveedores` (the supplier list — the user picks a supplier there). The entry SHALL appear alongside the existing "Cargar factura" / "Cargar pago" / "Ver proveedores" / "Ver facturas" / "Ver pagos" quick-access controls and SHALL follow the same visual treatment as the existing entries (F-HOME-01).

#### Scenario: home shows a "Ver cuenta corriente" link

- **WHEN** an authenticated user is on `/`
- **THEN** the inlined `HomePage` renders a "Ver cuenta corriente" link that navigates to `/proveedores`

### Requirement: Data layer over the C-12 endpoint

The frontend SHALL implement a `useCuentaCorriente(proveedorId)` hook backed by `getCuentaCorriente(proveedorId)` over the shared Axios client. The hook SHALL use a query key of the shape `['cuenta-corriente', 'detail', proveedorId]`. The hook SHALL be disabled when `proveedorId` is empty. The hook SHALL NOT retry on failure (404 is a real answer, not a transient error). The hook SHALL use `staleTime: 0` so a revisit re-fetches. The raw Axios call SHALL parse the response's `Decimal` strings into `number` at the API boundary (the `parseCuentaCorriente` helper) so the rest of the app sees `number` and never touches string-encoded decimals. The helper SHALL be unit-tested for round-trip of `0`, `0.01`, `-0.01`, `99999999.99`, `-99999999.99`, and a malformed string (asserts the helper throws a typed `Error`).

#### Scenario: hook issues GET /api/proveedores/{id}/cuenta-corriente

- **WHEN** `useCuentaCorriente('X')` is rendered for the first time
- **THEN** one `GET /api/proveedores/X/cuenta-corriente` request is made and the response's three blocks are exposed as `data`

#### Scenario: hook is disabled when proveedorId is empty

- **WHEN** `useCuentaCorriente('')` is rendered
- **THEN** no HTTP request is made and `isSuccess` is `false`

#### Scenario: 404 surfaces as isError

- **WHEN** the endpoint responds with 404 (foreign / soft-deleted / missing supplier)
- **THEN** the hook transitions to `isError` (the page renders the "Proveedor no encontrado" state) and the QueryClient is NOT left in a loading state

#### Scenario: Decimal strings are parsed to number at the API boundary

- **WHEN** the response has `saldo: "1234.56"` and `historial[0].saldo_acumulado: "1234.56"` and `facturas_con_estado[0].monto_total: "1500.00"`
- **THEN** the hook's `data` exposes `saldo: 1234.56`, `historial[0].saldo_acumulado: 1234.56`, and `facturas_con_estado[0].monto_total: 1500.0` — all numbers, never strings

### Requirement: Pydantic-to-TS contract is closed in api.d.ts

The frontend SHALL extend `src/shared/api/api.d.ts` with the types `FacturaConEstado`, `EntradaHistorial`, `CuentaCorrienteResponse`, plus the helper `FiltrosFacturas`, and the new mutation input types `FacturaDeleteInput` and `PagoDeleteInput`. The `FacturaConEstado.estado` field SHALL be of type `EstadoFactura` (the C-09 closed union). The `EntradaHistorial.tipo` field SHALL be of type `'FACTURA' | 'PAGO'`. The `CuentaCorrienteResponse.saldo`, `FacturaConEstado.monto_total`, `EntradaHistorial.monto`, and `EntradaHistorial.saldo_acumulado` SHALL all be typed as `number` (the API helper parses the Pydantic-v2 string-decimal at the boundary). A compile-time test (`api.cuentaCorriente.test-d.ts`) SHALL assert that the `estado` union is closed and that the new types do not have a `factura_id` key (RN-PAG-01 defense in depth on the cuenta-corriente surface). The runtime-guard test `api.pagos.test.ts` SHALL be extended to assert that `PagoDeleteInput` has no key whose name contains `factura`.

#### Scenario: api.d.ts declares the closed estado union on FacturaConEstado

- **WHEN** the type-level test in `api.cuentaCorriente.test-d.ts` runs at `tsc --noEmit` time
- **THEN** the assertion that `FacturaConEstado['estado']` is assignable to `EstadoFactura` compiles cleanly — the type is closed and any drift is caught at type-check time

#### Scenario: PagoDeleteInput has no key whose name contains "factura"

- **WHEN** the runtime-guard test in `api.pagos.test.ts` instantiates a `PagoDeleteInput` value and inspects `Object.keys`
- **THEN** the array of offending keys is empty — the structural absence of `factura_id` from the pago delete path is enforced

### Requirement: Currency and number formatting

All monetary values on the cuenta-corriente view SHALL be formatted as ARS via `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })`. The formatter SHALL be a single `formatMonto(value: number | string): string` helper exported from `src/shared/utils/currency.ts`. The existing call sites in `PagoCard`, `PagoList`, `FacturasList`, and any other monetary renderer in the app SHALL be migrated to use the shared helper in this change (no duplication of the formatting logic). The helper SHALL NOT perform any arithmetic on its input — it only formats the value it is given.

#### Scenario: all cuenta-corriente amounts are ARS-formatted

- **WHEN** the view renders a `SaldoBadge` with `saldo = 1500.5` and a `HistorialCronologico` row with `monto = 300.0` and `saldo_acumulado = 1200.0`
- **THEN** all three values are rendered using the same `formatMonto` helper and the output strings match the `es-AR` ARS format (e.g. `$ 1.500,50` for 1500.5, `$ 300,00` for 300.0, `$ 1.200,00` for 1200.0)

#### Scenario: a single shared formatter is used across the app

- **WHEN** `formatMonto` is imported by `SaldoBadge`, `TablaFacturasConEstado`, `HistorialCronologico`, and the migrated C-09 / C-11 components
- **THEN** every monetary render in the app goes through the same helper, with no local `Intl.NumberFormat` instantiations

### Requirement: Server state in TanStack Query, no tokens in storage

All cuenta-corriente server state SHALL be managed by TanStack Query (`useCuentaCorriente` from C-13 + the extended `useCreateFactura` / `useUpdateFactura` / `useDeleteFactura` / `useCreatePago` / `useUpdatePago` / `useDeletePago` from C-09 / C-11). UI-only state (filter chips, modal open/close) SHALL be local component state (`useState`). The implementation SHALL NOT store auth tokens or cuenta-corriente data in `localStorage` or `sessionStorage`. The shared Axios client from C-04 (`withCredentials: true`, 401 interceptor) SHALL be reused without modification.

#### Scenario: cuenta-corriente data is never persisted to localStorage or sessionStorage

- **WHEN** the detail page is active after a successful session
- **THEN** `localStorage` and `sessionStorage` contain no auth tokens and no cached cuenta-corriente data written by the frontend
