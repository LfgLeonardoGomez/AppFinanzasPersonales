# Proveedores Frontend Specification — Delta for C-13

## Purpose

This delta extends the existing `proveedores-frontend` capability (defined in `openspec/specs/proveedores-frontend/spec.md`) to add the supplier **detail** page — the entry point to the cuenta-corriente view (C-13) — and to surface a "Ver cuenta corriente" link from the existing supplier list. The cuenta-corriente view itself (SaldoBadge, TablaFacturasConEstado, HistorialCronologico, filters) belongs to the new `cuenta-corriente-frontend` capability and is consumed by the detail page via composition. The list, the create/edit form, the delete flow, and `SupplierSearch` are unchanged.

## ADDED Requirements

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
