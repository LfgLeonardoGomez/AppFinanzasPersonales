# Facturas Frontend Specification

## Purpose

Provide the invoice management UI of the PWA (`facturas-proveedores-web`) that consumes the `facturas-api` (C-08) HTTP contract without weakening it. Shipped by C-09 and extended by C-15, this capability exposes a paginated list of the authenticated user's invoices with computed-estado badges (PENDIENTE / PARCIAL / PAGADA — read verbatim from the response, never recomputed client-side, RN-FAC-09), supplier / estado / date-range filters, a create/edit form with dynamic line items, a non-blocking `items_sum_mismatch` warning, and a single-file PDF/JPG/PNG upload via the signed Cloudinary preset endpoint. Supplier linkage uses the shared `SupplierSearch` from C-07 in both the form and the list filter. The data layer is TanStack Query (`useFacturas`, `useFactura`, `useCreateFactura`, `useUpdateFactura`, `useDeleteFactura`, `useCloudinaryPreset('factura')`) and follows the same folder layout, hooks convention, and test stack (Vitest + RTL + MSW) that C-07 established for `proveedores-frontend`. C-15 adds the optional "Cargar con imagen (IA)" entry point on the create-mode form that delegates to the `ia-vision-frontend` `PropuestaIAModal`; the IA pre-fill goes through the same `useCreateFactura` mutation and the same backend validations (RN-FAC-01..09). No `saldo` is ever computed on the frontend; `saldo` and `estado` remain on-demand, server-side.
## Requirements
### Requirement: Invoice list with computed-estado badges

The system SHALL render a `FacturasPage` listing the authenticated user's invoices fetched from `GET /api/facturas`. Each row SHALL display an `estado` badge whose value comes verbatim from the API response field `estado` (PENDIENTE / PARCIAL / PAGADA). The frontend SHALL NOT compute or recompute the FIFO `estado`; it SHALL only read the value the backend returns (RN-FAC-09). Badge colors SHALL be: PENDIENTE orange, PARCIAL yellow, PAGADA green. Monetary amounts (`monto_total`) SHALL be formatted for display with `Intl.NumberFormat` (ARS) and never recomputed.

#### Scenario: list renders estado badge from the response field

- **WHEN** the API returns invoices with `estado` values PENDIENTE, PARCIAL, and PAGADA
- **THEN** each invoice row shows a badge with the matching label and color (orange / yellow / green), and the displayed `estado` equals the response field with no client-side FIFO computation

#### Scenario: empty list shows an empty state

- **WHEN** the API returns an empty invoice list
- **THEN** the page shows an empty-state message and the "Cargar factura" action, not an error

#### Scenario: monto_total is formatted, never recomputed

- **WHEN** an invoice with a `monto_total` is rendered
- **THEN** the amount is displayed via `Intl.NumberFormat` ARS formatting and is taken directly from the response

### Requirement: List filters applied over the response

The system SHALL provide filters on `FacturasPage` for supplier (using the shared `SupplierSearch` autocomplete), `estado` (PENDIENTE / PARCIAL / PAGADA), and a date range (`fecha_desde` / `fecha_hasta`). Supplier and date-range filters MAY be passed as query parameters to `GET /api/facturas` (`proveedor_id`, `fecha_desde`, `fecha_hasta`). The `estado` filter SHALL operate on the computed `estado` field of the response; the frontend SHALL NOT request a SQL-level estado filter beyond passing the supported `estado` query parameter the backend resolves in Python after FIFO. Clearing all filters SHALL restore the full list.

#### Scenario: filter by supplier uses SupplierSearch

- **WHEN** the user selects a supplier in the list's `SupplierSearch` control
- **THEN** the list re-queries scoped to that `proveedor_id` and shows only that supplier's invoices, each with its computed `estado`

#### Scenario: filter by estado reflects the computed field

- **WHEN** the user selects estado PAGADA
- **THEN** only invoices whose response `estado` is PAGADA are shown, and the frontend does not derive estado on its own

#### Scenario: filter by date range

- **WHEN** the user sets `fecha_desde` and/or `fecha_hasta`
- **THEN** the list shows only invoices within that range, applied through the supported query parameters

#### Scenario: clearing filters restores the full list

- **WHEN** the user clears all active filters
- **THEN** the list re-queries without filter parameters and shows all of the user's invoices

### Requirement: Invoice create/edit form with supplier linkage

The system SHALL provide a `FacturaFormPage` that creates (`POST /api/facturas`) and edits (`PATCH /api/facturas/{id}`) invoices. The form SHALL include: `proveedor` (required, selected via the shared `SupplierSearch` component), `fecha_emision` (required, not in the future relative to UTC-3), `monto_total` (required, > 0), `numero` (optional), and `fecha_vencimiento` (optional). Client-side validation SHALL be applied for UX, but the backend (Pydantic) SHALL remain the authority; a backend 422 SHALL be surfaced inline on the offending field. On PATCH, `proveedor` SHALL NOT be changeable (the backend rejects changing `proveedor_id`), so the form SHALL present the supplier as read-only in edit mode.

#### Scenario: create a valid invoice

- **WHEN** the user selects a supplier, enters a non-future `fecha_emision` and a `monto_total > 0`, and submits
- **THEN** the form calls `POST /api/facturas`, and on success navigates to the list which reflects the new invoice with its computed `estado`

#### Scenario: supplier is selected through SupplierSearch and is required

- **WHEN** the user attempts to submit without selecting a supplier
- **THEN** the form blocks submission and shows a required-field message on the supplier control

#### Scenario: future fecha_emision is rejected for UX before the backend

- **WHEN** the user enters a `fecha_emision` in the future (UTC-3)
- **THEN** the form shows a validation message and does not submit; if a future date still reaches the backend, the resulting 422 is surfaced on the field

#### Scenario: non-positive monto_total is rejected

- **WHEN** the user enters a `monto_total` of zero or negative
- **THEN** the form shows a validation message and does not submit

#### Scenario: edit loads existing values and keeps supplier read-only

- **WHEN** the user opens an existing invoice for editing
- **THEN** the form is pre-filled from `GET /api/facturas/{id}` (including items), the supplier is shown read-only, and submitting sends only changed fields via PATCH

#### Scenario: backend validation error is shown inline

- **WHEN** the backend returns a 422 for a submitted field
- **THEN** the form displays the error message next to the corresponding field without losing the user's input

### Requirement: Dynamic line items with non-blocking sum warning

The form SHALL support dynamic line items, allowing the user to add and remove rows, each with `descripcion`, `cantidad` (> 0), and `precio_unitario` (>= 0). Items SHALL be optional (RN-FAC-04). When the sum of `cantidad * precio_unitario` across items differs from `monto_total`, the UI SHALL display a non-blocking warning and SHALL still allow saving. The authoritative mismatch signal is the backend response field `items_sum_mismatch`; the client warning is a UX aid and SHALL NOT block submission.

#### Scenario: add and remove item rows

- **WHEN** the user clicks "add item" and later removes a row
- **THEN** the items list updates accordingly and an empty items list is a valid submission

#### Scenario: sum mismatch shows a non-blocking warning

- **WHEN** the sum of the items differs from `monto_total`
- **THEN** the form shows a warning indicating the mismatch but the submit action stays enabled and saving succeeds

#### Scenario: matching items show no warning

- **WHEN** the sum of items equals `monto_total`
- **THEN** no mismatch warning is shown

#### Scenario: backend items_sum_mismatch is reflected after save

- **WHEN** the create/update response includes `items_sum_mismatch = true`
- **THEN** the UI surfaces the warning consistent with the client-side indication, and the invoice is treated as successfully saved

### Requirement: Single-file upload via signed Cloudinary preset

The form SHALL allow attaching a single file (PDF, JPG, or PNG only — RN-FAC-07). The upload flow SHALL: (1) request a signed preset from `GET /api/cloudinary/preset-firmado?tipo=factura`, (2) upload the file directly to Cloudinary using that signed preset, (3) persist only the resulting `archivo_url` on the invoice. The client SHALL validate file type and size (~10 MB max) before upload for UX; the backend remains the validation authority. Replacing the file SHALL replace `archivo_url` (single file only). A failed upload SHALL surface an error and SHALL NOT block saving the invoice without a file.

#### Scenario: successful file upload stores the URL

- **WHEN** the user selects a valid PDF/JPG/PNG within the size limit and submits
- **THEN** the client fetches the signed preset, uploads to Cloudinary, and the invoice is saved with the returned `archivo_url`

#### Scenario: invalid file type is rejected client-side

- **WHEN** the user selects a file that is not PDF/JPG/PNG
- **THEN** the form shows a type error and does not attempt the upload

#### Scenario: oversized file is rejected client-side

- **WHEN** the user selects a file larger than the ~10 MB limit
- **THEN** the form shows a size error and does not attempt the upload

#### Scenario: invoice can be saved without a file

- **WHEN** the user submits without attaching a file
- **THEN** the invoice is saved with no `archivo_url` and no upload is attempted

#### Scenario: upload failure does not lose form data

- **WHEN** the Cloudinary upload fails
- **THEN** an error is shown, the form keeps the entered values, and the user may retry or save without the file

### Requirement: Delete invoice from the list

The system SHALL allow deleting an invoice via `DELETE /api/facturas/{id}` from the list or detail view, behind a confirmation. On success the list query SHALL be invalidated so the deleted invoice disappears. Deletion is a soft delete on the backend and is presented to the user as a normal deletion (RN-FAC-06).

#### Scenario: delete invalidates the list

- **WHEN** the user confirms deletion of an invoice
- **THEN** the client calls `DELETE /api/facturas/{id}`, invalidates the invoice list query, and the invoice no longer appears

#### Scenario: deletion is confirmed before executing

- **WHEN** the user clicks delete
- **THEN** a confirmation is shown and no request is sent until the user confirms

### Requirement: TanStack Query data layer for invoices

The system SHALL implement the invoice data layer with TanStack Query hooks built over typed Axios functions, mirroring the C-07 pattern: `useFacturas(filters)`, `useFactura(id)`, `useCreateFactura`, `useUpdateFactura`, and `useDeleteFactura`, plus a hook to obtain the signed Cloudinary preset. Server state (invoice list, single invoice) SHALL live in TanStack Query, not in Zustand. Mutations SHALL invalidate the relevant invoice queries on success. All API types SHALL be sourced from the generated/extended `api.d.ts` and SHALL NOT use `any` (TypeScript strict).

#### Scenario: query hook fetches the filtered list

- **WHEN** `useFacturas(filters)` is invoked with supplier, estado, and date-range filters
- **THEN** it issues `GET /api/facturas` with the supported query parameters and returns typed results, with no `any` types in the data path

#### Scenario: create mutation invalidates the list

- **WHEN** `useCreateFactura` succeeds
- **THEN** the invoice list query is invalidated and refetched so the new invoice appears

#### Scenario: update mutation invalidates affected queries

- **WHEN** `useUpdateFactura` succeeds for an invoice id
- **THEN** both the single-invoice query for that id and the invoice list query are invalidated

#### Scenario: delete mutation invalidates the list

- **WHEN** `useDeleteFactura` succeeds
- **THEN** the invoice list query is invalidated

### Requirement: Reuse the shared SupplierSearch component

The invoice feature SHALL reuse the existing `src/shared/components/SupplierSearch/` component shipped by C-07 for supplier selection in both the form and the list filter. The change SHALL NOT introduce a duplicate supplier autocomplete component. Supplier linkage SHALL follow RN-VINC behavior already implemented by `SupplierSearch` (normalized name search, suggestions, "Buscar proveedor", "Crear nuevo proveedor").

#### Scenario: form uses the shared component

- **WHEN** the invoice form renders the supplier selector
- **THEN** it instantiates the existing `SupplierSearch` shared component, not a new copy

#### Scenario: list filter uses the shared component

- **WHEN** the list supplier filter renders
- **THEN** it instantiates the same shared `SupplierSearch` component

### Requirement: Home quick access to load an invoice

The home screen SHALL present a "Cargar factura" quick-access action that navigates to the invoice create form (F-HOME-01).

#### Scenario: home shows the load-invoice action

- **WHEN** an authenticated user views the home screen
- **THEN** a "Cargar factura" action is visible and navigates to the invoice create form

### Requirement: Invoice routes are private

All invoice routes SHALL be registered under the existing authentication guard in `src/app/router.tsx`. Unauthenticated access SHALL be redirected to login, consistent with the C-04 auth flow.

#### Scenario: unauthenticated access redirects to login

- **WHEN** an unauthenticated user navigates to an invoice route
- **THEN** they are redirected to the login page and do not see invoice data

### Requirement: The create-mode invoice form offers a "Cargar con imagen (IA)" shortcut

The `FacturaFormPage` SHALL render a "Cargar con imagen (IA)" entry in create mode, alongside the existing "Carga manual" entry. Choosing it SHALL open the `PropuestaIAModal` (defined in the `ia-vision-frontend` capability) with `tipo='factura'`. The button SHALL be HIDDEN in edit mode (the IA flow applies to new documents only).

For the IA path, the modal is **terminal**: on the modal's single "Confirmar", the invoice is created directly from the modal (via `useCreateFactura`) and the large manual form is NOT shown. The page SHALL pass `useCreateFactura` (and the supplier-search/create wiring) into the modal, and SHALL NOT route the IA path into the manual `FacturaForm`. The manual path (mode selector → `FacturaForm`) is unchanged. After a successful IA create, the page SHALL redirect to the supplier's cuenta corriente `/proveedores/:id` (the existing invoice behavior), using the `proveedor_id` of the created factura.

#### Scenario: create-mode form shows the IA entry

- **WHEN** the user opens `/facturas/nueva` (the create-mode `FacturaFormPage`)
- **THEN** the page renders a "Cargar con imagen (IA)" entry next to the manual entry, and choosing it opens the `PropuestaIAModal` with `tipo='factura'`

#### Scenario: edit-mode hides the IA entry

- **WHEN** the user opens `/facturas/{id}/editar` (the edit-mode `FacturaFormPage`)
- **THEN** the "Cargar con imagen (IA)" entry is NOT rendered in the DOM

#### Scenario: the IA confirm creates the factura directly (no second form)

- **WHEN** the user confirms the modal with `propuesta = { proveedor_nombre: "Acme SA", numero: "0001-1234", fecha_emision: "2026-06-15", monto_total: 1234.56 }` and a selected supplier
- **THEN** exactly one `POST /api/facturas` fires from the modal with `{ proveedor_id, numero: "0001-1234", fecha_emision: "2026-06-15", monto_total: 1234.56, archivo_url, origen: 'IA' }`, the modal closes, and the manual `FacturaForm` is never rendered for this path

#### Scenario: the IA factura creation lands on the supplier's cuenta corriente

- **WHEN** the IA confirm creates the factura with `proveedor_id = "uuid-123"`
- **THEN** the app navigates to `/proveedores/uuid-123` with a success message

