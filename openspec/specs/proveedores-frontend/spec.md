# Proveedores Frontend Specification

## Purpose

Provide the supplier management UI of the PWA (`facturas-proveedores-web`) that consumes the `proveedores-api` (C-06) HTTP contract without weakening it:
- Paginated, sortable supplier list showing `saldo` read from the API — never computed on the frontend (RN-SALDO)
- Create/edit supplier form with client-side `nombre` validation and backend-authoritative CUIT validation (Pydantic)
- Two-step delete flow: silent when `tiene_dependencias=false`, explicit confirmation modal when `tiene_dependencias=true` (RN-PROV-04)
- Shared `SupplierSearch` autocomplete component for supplier linkage (RN-VINC), reusable in invoice and payment forms
- Auth-gated route `/proveedores` behind `RequireAuthWithBootstrap` (reuses C-04 auth layer)
- All HTTP calls through the shared Axios client (`withCredentials`, 401 interceptor) from C-04
- All tests offline: Vitest + React Testing Library + MSW (no real backend hit)
## Requirements
### Requirement: Paginated supplier list with server-side saldo

The frontend SHALL expose a private route `/proveedores` (behind `RequireAuthWithBootstrap`) that renders a paginated supplier list. Each list item SHALL display the supplier's `saldo` as received from `GET /api/proveedores` — the frontend SHALL NOT compute the saldo from invoices or payments (RN-SALDO). The list SHALL support sorting by `nombre` or `saldo` via `order_by` query parameter passed to the backend, and pagination via the `page` parameter. An empty list SHALL render a "No hay proveedores" message. Loading and error states SHALL be rendered.

#### Scenario: list renders supplier names and backend-provided saldo

- **WHEN** an authenticated user navigates to `/proveedores` and the backend returns a page of suppliers each with a `saldo` field
- **THEN** each supplier's name and its `saldo` formatted as ARS currency are displayed; no client-side arithmetic is performed to derive or adjust the saldo value

#### Scenario: sort by nombre passes order_by=nombre to the API

- **WHEN** the user activates the "Nombre" sort control
- **THEN** the list re-fetches with `order_by=nombre` and the backend returns suppliers in name order

#### Scenario: sort by saldo passes order_by=saldo to the API

- **WHEN** the user activates the "Saldo" sort control
- **THEN** the list re-fetches with `order_by=saldo` and the backend returns suppliers in balance order

#### Scenario: empty list shows empty state

- **WHEN** the backend returns zero suppliers for the authenticated user
- **THEN** the component renders a "No hay proveedores" message and no table rows

#### Scenario: pagination controls advance the page

- **WHEN** the backend returns multiple pages (`total_pages > 1`) and the user clicks "Siguiente"
- **THEN** the list re-fetches with `page=2` and the next page of suppliers is displayed

### Requirement: Supplier name autocomplete for linkage (RN-VINC)

The frontend SHALL expose a shared `SupplierSearch` component at `src/shared/components/SupplierSearch/` that calls `GET /api/proveedores/buscar?nombre=<query>` when the query is at least 2 characters long. The component SHALL show a dropdown list of matching supplier names returned by the backend. Selecting a supplier SHALL call the `onChange` callback with the selected `ProveedorListItem`. Clearing the selection SHALL call `onChange(null)`. When the query is shorter than 2 characters, no search request SHALL be made and no dropdown SHALL be shown. When results are empty, a "Sin coincidencias" message SHALL be shown. The component SHALL support a `disabled` prop. This component is designed for reuse in invoice (C-09) and payment (C-11) forms.

#### Scenario: typing ≥2 characters triggers buscar query and shows dropdown

- **WHEN** the user types 2 or more characters in the SupplierSearch input
- **THEN** `GET /api/proveedores/buscar?nombre=<query>` is called and matching supplier names appear in a dropdown

#### Scenario: typing <2 characters shows no dropdown and makes no request

- **WHEN** the user types fewer than 2 characters in the SupplierSearch input
- **THEN** no search request is made and no dropdown is rendered

#### Scenario: selecting a supplier calls onChange with the selected item

- **WHEN** the user clicks a supplier name in the dropdown
- **THEN** the `onChange` callback is called with the corresponding `ProveedorListItem`

#### Scenario: clearing the selection calls onChange(null)

- **WHEN** a supplier is selected and the user clicks the clear button
- **THEN** `onChange(null)` is called and the input returns to empty state

#### Scenario: empty results show "Sin coincidencias"

- **WHEN** the buscar query returns an empty array
- **THEN** the dropdown shows a "Sin coincidencias" message

#### Scenario: disabled prop disables the input

- **WHEN** the `disabled` prop is `true`
- **THEN** the autocomplete input is disabled and does not accept user input

### Requirement: Route gated behind RequireAuthWithBootstrap

The `/proveedores` route SHALL be registered in `src/app/router.tsx` under `RequireAuthWithBootstrap`, ensuring it is inaccessible to unauthenticated users. Navigating to `/proveedores` without a valid session SHALL redirect to `/login`. The route SHALL reuse the auth guard and bootstrap mechanism from C-04 without reinventing them.

#### Scenario: unauthenticated access to /proveedores redirects to login

- **WHEN** a user without a valid session navigates to `/proveedores`
- **THEN** `RequireAuthWithBootstrap` redirects them to `/login`

#### Scenario: authenticated access to /proveedores renders ProveedoresPage

- **WHEN** a user with a valid session navigates to `/proveedores`
- **THEN** `ProveedoresPage` is rendered with the supplier list

### Requirement: Server state in TanStack Query, no tokens in storage

All supplier server state (list, single supplier, search results) SHALL be managed by TanStack Query hooks (`useProveedores`, `useProveedor`, `useCreateProveedor`, `useUpdateProveedor`, `useDeleteProveedor`, `useBuscarProveedores`). UI-only state (modal open/closed, which supplier is being edited) SHALL be local component state (`useState`). The implementation SHALL NOT store auth tokens or supplier data in `localStorage` or `sessionStorage`. The Axios client from C-04 (`withCredentials: true`, 401 interceptor) SHALL be reused without modification.

#### Scenario: list cache is invalidated after create, update, or delete

- **WHEN** a create, update, or delete mutation succeeds
- **THEN** TanStack Query invalidates the proveedores list queries and the list refetches with current data

#### Scenario: no tokens or supplier data appear in localStorage or sessionStorage

- **WHEN** the supplier list page is active after a successful session
- **THEN** `localStorage` and `sessionStorage` contain no auth tokens and no cached supplier data written by the frontend

### Requirement: Supplier detail page integrates the cuenta-corriente view

The frontend SHALL expose a `ProveedorDetailPage` component (rendered at the new private route `/proveedores/:id`, behind `RequireAuthWithBootstrap`) that integrates the supplier name (via the existing `useProveedor(id)` from C-07) with the cuenta-corriente triple (consumed from the new `useCuentaCorriente(id)` hook in C-13). The page header SHALL display the supplier name and the `SaldoBadge` for the response's `saldo`. Below the header, the page SHALL render two action buttons (`Link` controls): one to `/facturas/nueva?proveedor_id={id}` and one to `/pagos/nuevo?proveedor_id={id}` (the existing C-09 / C-11 create-form pages are extended in C-13 to pre-fill the supplier from the query string). Below the action row, the page SHALL render the cuenta-corriente view (C-13's `CuentaCorrientePage`). The page SHALL surface a header skeleton (supplier name placeholder + saldo placeholder) while the queries are loading, a "Proveedor no encontrado" empty state when `useProveedor` 404s OR when `useCuentaCorriente` 404s, and a "Reintentar" CTA on generic errors. The page SHALL NOT introduce new mutation hooks — it only consumes the existing `useProveedor` and the new `useCuentaCorriente`. The `CuentaCorrientePage` is rendered as a presentational child; the detail page owns the loading / empty / error states.

#### Scenario: detail page renders the supplier header and the cuenta-corriente view

- **WHEN** an authenticated user navigates to `/proveedores/{id}` for a supplier they own
- **THEN** the page renders the supplier name in the header, the `SaldoBadge` with the response's `saldo`, the two action buttons, and the cuenta-corriente view below — all data comes from the responses, none is computed

#### Scenario: action buttons carry the supplier id as a query string

- **WHEN** the user clicks "Cargar factura" on the detail page
- **THEN** the browser navigates to `/facturas/nueva?proveedor_id={id}`; the C-09 `FacturaFormPage` reads the query string and pre-fills the supplier (extended in C-13)

#### Scenario: action buttons carry the supplier id for pagos

- **WHEN** the user clicks "Cargar pago" on the detail page
- **THEN** the browser navigates to `/pagos/nuevo?proveedor_id={id}`; the C-11 `PagoFormPage` reads the query string and pre-fills the supplier (extended in C-13)

#### Scenario: 404 on `useProveedor` shows the empty state

- **WHEN** `useProveedor({id})` returns 404 (foreign / soft-deleted / missing supplier)
- **THEN** the page renders the "Proveedor no encontrado" empty state with a link to `/proveedores`, and no detail content is rendered

#### Scenario: 404 on `useCuentaCorriente` shows the empty state

- **WHEN** `useProveedor({id})` succeeds but `useCuentaCorriente({id})` returns 404
- **THEN** the page renders the "Proveedor no encontrado" empty state (the C-12 endpoint's 404 is the same condition as the supplier being absent from the user's account)

#### Scenario: the detail page is accessible only to authenticated users

- **WHEN** a user without a valid session navigates to `/proveedores/{id}`
- **THEN** `RequireAuthWithBootstrap` redirects them to `/login`

#### Scenario: generic error renders the refetch CTA

- **WHEN** `useCuentaCorriente({id})` errors with anything other than 401 / 404
- **THEN** the page renders "No se pudo cargar la cuenta corriente" with a "Reintentar" button that calls `refetch()`

### Requirement: ProveedoresList rows link to the detail page

The frontend SHALL add a "Ver cuenta corriente" link on each row of the existing `ProveedoresList` (the C-07 list component). Clicking the link SHALL navigate the user to `/proveedores/{id}` for the corresponding supplier. The link SHALL be additive — the existing "Editar" / "Eliminar" controls on the row are unchanged. The link's `href` SHALL be built from the row's `id` field.

#### Scenario: each row exposes a link to the detail page

- **WHEN** `ProveedoresList` renders a row for a supplier with id `X`
- **THEN** the row contains a "Ver cuenta corriente" link whose `href` is `/proveedores/X` and clicking it navigates to the detail page

#### Scenario: the link does not replace the existing actions

- **WHEN** the user clicks "Ver cuenta corriente" on a row
- **THEN** the browser navigates to the detail page, and the existing "Editar" / "Eliminar" buttons on the source row are still present and functional

### Requirement: Route /proveedores/:id registered under RequireAuthWithBootstrap

The frontend SHALL register a new private route `/proveedores/:id` in `src/app/router.tsx`, mounted under the existing `RequireAuthWithBootstrap` guard (no new auth code). The route SHALL render `ProveedorDetailPage`. The route SHALL be declared AFTER the existing `/proveedores` route (the parent route remains unchanged) and BEFORE the catch-all `*` redirect (so a real path matches before the catch-all).

#### Scenario: the route is registered and renders the detail page

- **WHEN** an authenticated user navigates to `/proveedores/{id}` for an own supplier
- **THEN** `ProveedorDetailPage` is rendered

#### Scenario: the route is auth-gated

- **WHEN** a user without a valid session navigates to `/proveedores/{id}`
- **THEN** `RequireAuthWithBootstrap` redirects them to `/login` and the detail page is not mounted

#### Scenario: the existing /proveedores route is unchanged

- **WHEN** an authenticated user navigates to `/proveedores`
- **THEN** `ProveedoresPage` is rendered as before, and the new `/proveedores/:id` route does not affect the list behavior

### Requirement: Create and edit supplier via accessible dialog form

The `ProveedorForm` SHALL be rendered inside an accessible dialog (the `frontend-ui-polish` `role="dialog"` pattern) instead of the previous custom modal. In create mode the dialog calls `POST /api/proveedores`; in edit mode it calls `PATCH /api/proveedores/{id}`. The form SHALL include the same fields as before: `nombre` (required), `cuit` (optional), `telefono` (optional), `categoria` (select: SERVICIO / OTRO, defaults to OTRO), `notas` (optional). The frontend SHALL enforce `nombre` non-emptiness client-side before submitting; the backend (Pydantic) is the final authority for CUIT format validation. A 422 response from the backend SHALL be displayed in the form. The form SHALL reset after a successful save and SHALL pre-fill existing values when opened in edit mode. The dialog SHALL close on `Esc`, SHALL trap focus while open, and SHALL return focus to the trigger (the "Nuevo proveedor" or "Editar" button) when closed. The dialog MAY close on backdrop click (this is a non-destructive form, so backdrop close is acceptable; the destructive `DeleteProveedorDialog` is the only `alertdialog` and does not close on backdrop).

The following scenarios from the C-07 canonical spec are **preserved unchanged** and re-stated here only to anchor the reader: "submit with empty nombre shows client-side error and does not call API", "valid create payload calls POST and invalidates the list", "valid edit payload calls PATCH and invalidates the list", "CUIT with wrong format shows client hint", "backend 422 error is rendered in the form", "edit mode pre-fills existing supplier values", and "categoria select renders all enum options".

#### Scenario: dialog has accessible role, label, and modal semantics

- **WHEN** the user clicks "Nuevo proveedor" or "Editar" on a supplier row
- **THEN** the create/edit form is rendered inside an element with `role="dialog"`, `aria-modal="true"`, and an `aria-label` of "Formulario de proveedor"

#### Scenario: dialog opens with focus on the first field

- **WHEN** the create or edit dialog opens
- **THEN** the `nombre` input (the first focusable form field) receives focus

#### Scenario: dialog closes with Esc and returns focus to the trigger

- **WHEN** the create or edit dialog is open and the user presses `Esc`
- **THEN** the dialog closes, no submit is issued, and focus returns to the "Nuevo proveedor" or "Editar" trigger button

#### Scenario: dialog traps focus inside the form

- **WHEN** the create or edit dialog is open and the user presses `Tab` past the last field or `Shift+Tab` before the first field
- **THEN** focus cycles within the form fields and does not escape to the underlying page

#### Scenario: dialog closes on backdrop click (non-destructive form)

- **WHEN** the create or edit dialog is open and the user clicks the backdrop outside the form
- **THEN** the dialog closes without submitting, no HTTP request is made, and focus returns to the trigger

#### Scenario: dialog closes on Cancel and returns focus to the trigger

- **WHEN** the create or edit dialog is open and the user clicks "Cancelar"
- **THEN** the dialog closes without submitting, no HTTP request is made, and focus returns to the trigger

#### Scenario: submit with empty nombre shows client-side error and does not call API

- **WHEN** the user submits the form with an empty `nombre` field
- **THEN** a validation error is shown inline and no HTTP request is made

#### Scenario: valid create payload calls POST and invalidates the list

- **WHEN** the user fills in a valid `nombre` and submits in create mode
- **THEN** `POST /api/proveedores` is called with the correct payload, on success a success toast appears, the dialog closes, focus returns to the trigger, and the supplier list is refetched

#### Scenario: valid edit payload calls PATCH and invalidates the list

- **WHEN** the user edits a supplier and submits in edit mode
- **THEN** `PATCH /api/proveedores/{id}` is called with the updated fields, on success a success toast appears, the dialog closes, focus returns to the trigger, and the supplier list is refetched

#### Scenario: CUIT with wrong format shows client hint

- **WHEN** the user enters a CUIT that does not match `^\d{2}-\d{8}-\d{1}$` and blurs the field
- **THEN** a format hint "Formato esperado: XX-XXXXXXXX-X" is shown; the form is not blocked from submitting (backend is the authority)

#### Scenario: backend 422 error is rendered in the form

- **WHEN** the backend responds with a 422 validation error (e.g. malformed CUIT)
- **THEN** the form displays a backend error message without closing

#### Scenario: edit mode pre-fills existing supplier values

- **WHEN** the form is opened in edit mode for an existing supplier
- **THEN** all editable fields are pre-populated with the supplier's current values

#### Scenario: categoria select renders all enum options

- **WHEN** the form is rendered in create or edit mode
- **THEN** the `categoria` select contains exactly the options SERVICIO and OTRO

### Requirement: Delete confirmation uses an alertdialog (RN-PROV-04)

The `DeleteProveedorDialog` (the destructive confirmation that appears when `tiene_dependencias: true`) SHALL be rendered as an `alertdialog` (the `frontend-ui-polish` destructive dialog pattern). It SHALL satisfy the `frontend-ui-polish` contract for `alertdialog`: it has `role="alertdialog"`, `aria-modal="true"`, an `aria-label` of "Confirmar eliminación", focuses the "Cancelar" button by default (safer than focusing the destructive action), traps focus, closes on `Esc`, returns focus to the trigger on close, and **does NOT close on backdrop click** (the user must explicitly choose). The internal behavior (call DELETE on Confirmar, do nothing on Cancelar) is preserved from the C-07 spec.

The following scenarios from the C-07 canonical spec are **preserved unchanged**: "delete with no dependencies completes silently", "delete with dependencies shows confirmation dialog", "confirming deletion with dependencies issues a second DELETE", and "cancelling dependency confirmation leaves the list unchanged".

#### Scenario: alertdialog has accessible role, label, and modal semantics

- **WHEN** a `DeleteProveedorDialog` is shown (because the supplier has `tiene_dependencias: true`)
- **THEN** the dialog has `role="alertdialog"`, `aria-modal="true"`, and an `aria-label` of "Confirmar eliminación"

#### Scenario: alertdialog focuses the Cancel button on open

- **WHEN** a `DeleteProveedorDialog` is shown
- **THEN** the "Cancelar" button receives focus (not the destructive "Confirmar" button)

#### Scenario: alertdialog closes on Esc and returns focus to the trigger

- **WHEN** a `DeleteProveedorDialog` is open and the user presses `Esc`
- **THEN** the dialog closes without issuing a DELETE, and focus returns to the "Eliminar" trigger button

#### Scenario: alertdialog does not close on backdrop click

- **WHEN** a `DeleteProveedorDialog` is open and the user clicks the backdrop
- **THEN** the dialog remains open; the user MUST click "Confirmar" or "Cancelar" to close it

#### Scenario: confirming deletion issues a second DELETE and shows a toast

- **WHEN** a `DeleteProveedorDialog` is open and the user clicks "Confirmar"
- **THEN** `DELETE /api/proveedores/{id}` is called, on success a success toast appears, the dialog closes, focus returns to the trigger, and the supplier list is refetched

#### Scenario: cancelling the alertdialog leaves the list unchanged

- **WHEN** a `DeleteProveedorDialog` is open and the user clicks "Cancelar"
- **THEN** no second DELETE request is made, the dialog closes, and the supplier remains in the list

