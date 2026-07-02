# pagos-frontend Specification

## Purpose

Provide the supplier-scoped payment management UI of the PWA (`facturas-proveedores-web`) that consumes the `pagos-backend` (C-10) HTTP contract without weakening it. Shipped by C-11, this capability exposes a paginated list filterable by supplier (reusing the `SupplierSearch` autocomplete from C-07), a create/edit form for `Pago` (with `monto` > 0, `fecha` not future in UTC-3, `metodo` from the `EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO` enum, and an optional `comprobante` uploaded via the C-09 `FileUploadField` with `tipo='comprobante'`), a `PagoCard` row with `MetodoBadge`, and a `Cargar pago` quick-access action on the home screen. The capability enforces RN-PAG-01 in the UI as defense in depth on top of the backend's `extra="forbid"` schema: the form structurally cannot render, accept, or send a `factura_id`; a persistent in-form note ("El pago se asocia al proveedor, no a una factura específica") and a `PagoCard` label ("Pago al proveedor") make the absence of an invoice link explicit. No `saldo` or `estado` is ever computed on the frontend; both remain on-demand, server-side. The data layer is TanStack Query (`usePagos`, `usePago`, `useCreatePago`, `useUpdatePago`, `useDeletePago`, `useCloudinaryPreset('comprobante')`) and follows the same folder layout, hooks convention, and test stack (Vitest + RTL + MSW) that C-09 established for `facturas-frontend`.
## Requirements
### Requirement: Payment list with supplier filter

The system SHALL render a `PagosPage` listing the authenticated user's active payments fetched from `GET /api/pagos`. The list SHALL be orderable by `fecha DESC, created_at DESC, id DESC` (default page size 50). The page SHALL provide a supplier filter via the shared `SupplierSearch` component; when a supplier is selected, the list SHALL be re-queried with `proveedor_id=...` and SHALL show only that supplier's payments. Clearing the filter SHALL restore the unfiltered list. No `estado` filter is exposed — `Pago` has no `estado` (RN-PAG-01 by design). Each row SHALL display the payment `monto` (formatted via `Intl.NumberFormat` ARS), `fecha`, `metodo` (via `MetodoBadge`), and the supplier name when the unfiltered view is shown. The list SHALL include a delete action with confirmation.

#### Scenario: list renders payments from the API response

- **WHEN** the API returns payments for the authenticated user
- **THEN** the list renders one `PagoCard` per payment with monto (ARS-formatted), fecha, metodo badge, and comprobante link when present

#### Scenario: empty list shows an empty state

- **WHEN** the API returns an empty payment list
- **THEN** the page shows an empty-state message and the "Cargar pago" action, not an error

#### Scenario: filter by supplier narrows the list

- **WHEN** the user selects a supplier in the `SupplierSearch` filter
- **THEN** the list re-queries `GET /api/pagos?proveedor_id=<selected>` and shows only that supplier's payments

#### Scenario: clearing the filter restores the full list

- **WHEN** the user clears the supplier filter
- **THEN** the list re-queries without `proveedor_id` and shows all of the user's payments

### Requirement: Create/edit form without a factura field (RN-PAG-01)

The system SHALL provide a `PagoFormPage` that creates (`POST /api/pagos`) and edits (`PATCH /api/pagos/{id}`) payments. The form SHALL include: `proveedor` (required, via the shared `SupplierSearch`); `monto` (required, > 0); `fecha` (required, not in the future relative to UTC-3); `metodo` (required, enum `EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO`); and an optional `comprobante` upload (single PDF/JPG/PNG). The form SHALL NOT render, accept, or send a `factura_id` field in any mode. A persistent info note inside the form SHALL read "El pago se asocia al proveedor, no a una factura específica" to reinforce RN-PAG-01. In edit mode, the supplier SHALL be read-only because the backend PATCH cannot change `proveedor_id` (D7 in `pagos-backend` spec).

#### Scenario: create a valid payment

- **WHEN** the user selects a supplier, enters `monto > 0`, a non-future `fecha`, a `metodo`, and submits
- **THEN** the form calls `POST /api/pagos` with `{proveedor_id, monto, fecha, metodo, comprobante_url?}` and on success navigates back to the list

#### Scenario: the form contains no factura input

- **WHEN** the form renders
- **THEN** there is no `<input>`, `<select>`, or other form control whose `name` attribute contains "factura" (RN-PAG-01)

#### Scenario: the form payload contains no factura key

- **WHEN** the user submits the form
- **THEN** the captured payload keys are a subset of `{proveedor_id, monto, fecha, metodo, comprobante_url}` — no key contains "factura" (RN-PAG-01)

#### Scenario: the form displays the RN-PAG-01 reinforcement note

- **WHEN** the form renders
- **THEN** the rendered DOM contains the text "El pago se asocia al proveedor, no a una factura específica"

#### Scenario: future fecha is rejected client-side

- **WHEN** the user enters a `fecha` after today in UTC-3
- **THEN** the form shows a validation message and does not submit; if a future date still reaches the backend, the resulting 422 is surfaced on the field

#### Scenario: non-positive monto is rejected

- **WHEN** the user enters a `monto` of zero or negative
- **THEN** the form shows a validation message and does not submit

#### Scenario: missing metodo is rejected

- **WHEN** the user submits without selecting a `metodo`
- **THEN** the form shows a required-field message and does not submit

#### Scenario: missing supplier is rejected

- **WHEN** the user submits without selecting a supplier
- **THEN** the form shows a required-field message on the supplier control and does not submit

#### Scenario: edit loads existing values and keeps supplier read-only

- **WHEN** the user opens an existing payment for editing
- **THEN** the form is pre-filled from `GET /api/pagos/{id}`, the supplier is shown read-only, and submitting sends only changed fields via PATCH

#### Scenario: backend validation error is shown inline

- **WHEN** the backend returns a 422 for a submitted field
- **THEN** the form displays the error message next to the corresponding field without losing the user's input

### Requirement: Single-file comprobante upload via signed Cloudinary preset

The form SHALL allow attaching a single file (PDF, JPG, or PNG only) as the payment `comprobante`. The upload flow SHALL: (1) request a signed preset from `GET /api/cloudinary/preset-firmado?tipo=comprobante`, (2) upload the file directly to Cloudinary using that signed preset, (3) persist only the resulting `comprobante_url` on the payment. The client SHALL validate file type and size (~10 MB max) before upload for UX; the backend remains the validation authority. Replacing the file SHALL replace `comprobante_url` (single file only). A failed upload SHALL surface an error and SHALL NOT block saving the payment without a file.

#### Scenario: successful comprobante upload stores the URL

- **WHEN** the user selects a valid PDF/JPG/PNG within the size limit and submits
- **THEN** the client fetches the signed `comprobante` preset, uploads to Cloudinary, and the payment is saved with the returned `comprobante_url`

#### Scenario: invalid file type is rejected client-side

- **WHEN** the user selects a file that is not PDF/JPG/PNG
- **THEN** the form shows a type error and does not attempt the upload

#### Scenario: oversized file is rejected client-side

- **WHEN** the user selects a file larger than the ~10 MB limit
- **THEN** the form shows a size error and does not attempt the upload

#### Scenario: payment can be saved without a comprobante

- **WHEN** the user submits without attaching a file
- **THEN** the payment is saved with no `comprobante_url` and no upload is attempted

#### Scenario: upload failure does not lose form data

- **WHEN** the Cloudinary upload fails
- **THEN** an error is shown, the form keeps the entered values, and the user may retry or save without the file

### Requirement: Metodo badge with distinct visual treatment

Each payment row and the form's `metodo` select SHALL display a `MetodoBadge` with a distinct color per `MetodoPago` enum value. The badge SHALL only display the response field — it SHALL NOT compute or transform it. The list SHALL always include the badge so users can scan payment history at a glance.

#### Scenario: badge reflects the metodo from the response

- **WHEN** a payment with a given `metodo` is rendered
- **THEN** the badge shows the matching label and color (EFECTIVO emerald, TRANSFERENCIA blue, TARJETA violet, MERCADOPAGO sky, OTRO gray) — no other transformation is applied

### Requirement: Delete payment from the list

The system SHALL allow deleting a payment via `DELETE /api/pagos/{id}` from the list, behind a confirmation. On success the list query SHALL be invalidated so the deleted payment disappears. Deletion is a soft delete on the backend and is presented to the user as a normal deletion (RN-PAG-05). Deleting a payment does NOT directly affect any invoice (no `factura_id` link); the next on-demand re-aggregation of the FIFO pool (C-08 / C-12) automatically excludes the soft-deleted payment.

#### Scenario: delete invalidates the list

- **WHEN** the user confirms deletion of a payment
- **THEN** the client calls `DELETE /api/pagos/{id}`, invalidates the payment list query, and the payment no longer appears

#### Scenario: deletion is confirmed before executing

- **WHEN** the user clicks delete
- **THEN** a confirmation is shown and no request is sent until the user confirms

### Requirement: TanStack Query data layer for payments

The system SHALL implement the payment data layer with TanStack Query hooks built over typed Axios functions, mirroring the C-09 pattern: `usePagos(proveedor_id?)`, `usePago(id)`, `useCreatePago`, `useUpdatePago`, and `useDeletePago`, plus the existing `useCloudinaryPreset('comprobante')` hook from C-09. Server state (payment list, single payment) SHALL live in TanStack Query, not in Zustand. Mutations SHALL invalidate the relevant payment queries on success. All API types SHALL be sourced from the extended `api.d.ts` and SHALL NOT use `any` (TypeScript strict). The `PagoCreate` payload type SHALL declare only `proveedor_id`, `monto`, `fecha`, `metodo`, `comprobante_url?` — no `factura_id` key.

#### Scenario: usePagos fetches the list

- **WHEN** `usePagos(proveedor_id)` is invoked
- **THEN** it issues `GET /api/pagos?proveedor_id=...&page=1` and returns typed results, with no `any` types in the data path

#### Scenario: create mutation invalidates the list

- **WHEN** `useCreatePago` succeeds
- **THEN** the payment list query is invalidated and refetched so the new payment appears

#### Scenario: update mutation invalidates affected queries

- **WHEN** `useUpdatePago` succeeds for a payment id
- **THEN** both the single-payment query for that id and the payment list query are invalidated

#### Scenario: delete mutation invalidates the list

- **WHEN** `useDeletePago` succeeds
- **THEN** the payment list query is invalidated

#### Scenario: PagoCreate type forbids factura_id

- **WHEN** the `PagoCreate` type is checked
- **THEN** it has no `factura_id` key and the `useCreatePago` mutation function does not accept one in its argument type

### Requirement: Reuse the shared SupplierSearch component

The pagos feature SHALL reuse the existing `src/shared/components/SupplierSearch/` component shipped by C-07 for supplier selection in both the form and the list filter. The change SHALL NOT introduce a duplicate supplier autocomplete component. Supplier linkage SHALL follow RN-VINC behavior already implemented by `SupplierSearch` (normalized name search, suggestions, "Buscar proveedor", "Crear nuevo proveedor").

#### Scenario: form uses the shared component

- **WHEN** the payment form renders the supplier selector
- **THEN** it instantiates the existing `SupplierSearch` shared component, not a new copy

#### Scenario: list filter uses the shared component

- **WHEN** the list supplier filter renders
- **THEN** it instantiates the same shared `SupplierSearch` component

### Requirement: Home quick access to load a payment

The home screen SHALL present a "Cargar pago" quick-access action that navigates to the payment create form (F-HOME-01), consistent with the existing "Cargar factura" entry.

#### Scenario: home shows the load-payment action

- **WHEN** an authenticated user views the home screen
- **THEN** a "Cargar pago" action is visible and navigates to the payment create form

### Requirement: Pago routes are private

All pago routes SHALL be registered under the existing authentication guard in `src/app/router.tsx`. Unauthenticated access SHALL be redirected to login, consistent with the C-04 auth flow.

#### Scenario: unauthenticated access redirects to login

- **WHEN** an unauthenticated user navigates to a pago route
- **THEN** they are redirected to the login page and do not see payment data

### Requirement: PagoCard reinforces the supplier-only scope

Each `PagoCard` in the list SHALL display a visible label "Pago al proveedor" (or equivalent) so that, when scanning the payment history, users see no invoice reference and understand that the payment is supplier-scoped (RN-PAG-01).

#### Scenario: PagoCard shows the supplier-only label

- **WHEN** a `PagoCard` is rendered
- **THEN** the rendered DOM contains the "Pago al proveedor" label or an equivalent reinforcement

### Requirement: The create-mode payment form offers a "Cargar con imagen (IA)" shortcut

The `PagoFormPage` SHALL render a "Cargar con imagen (IA)" button in create mode, alongside the existing "Carga manual" entry. Clicking the button SHALL open the `PropuestaIAModal` (defined in the `ia-vision-frontend` capability) with `tipo='pago'`. The button SHALL be HIDDEN in edit mode (the IA flow applies to new documents only). The form SHALL accept a `prefillFromProposal` prop (or controlled state equivalent) so the modal can populate the form's fields on confirm. The pre-fill SHALL be subject to the same backend validations as the manual flow (RN-PAG-01..05 enforced by the C-10 Pydantic schema, including `extra="forbid"` that prevents any non-schema field from being sent). The button SHALL be disabled while the form's own `useCreatePago` mutation is `isPending`. The form SHALL structurally remain unable to render, accept, or send a `factura_id` (RN-PAG-01); the IA flow inherits this structural guarantee because the form's own mutation payload is unchanged.

#### Scenario: create-mode form shows the IA button

- **WHEN** the user opens `/pagos/nuevo` (the create-mode `PagoFormPage`)
- **THEN** the form renders a "Cargar con imagen (IA)" button next to the existing manual entry, and clicking it opens the `PropuestaIAModal` with `tipo='pago'`

#### Scenario: edit-mode form hides the IA button

- **WHEN** the user opens `/pagos/{id}/editar` (the edit-mode `PagoFormPage`)
- **THEN** the "Cargar con imagen (IA)" button is NOT rendered in the DOM

#### Scenario: the IA confirm pre-fills the form fields

- **WHEN** the user clicks the modal's "Confirmar" with `propuesta = { proveedor_nombre: "Acme SA", monto: 5000, fecha: "2026-06-20", metodo: "TRANSFERENCIA" }` and `selectedProveedor = { id: "uuid", nombre: "Acme SA" }`
- **THEN** the form's `selectedProveedor` becomes the picked `Proveedor`, the `monto` input shows `5000`, the `fecha` input shows "2026-06-20", the `metodo` select shows "TRANSFERENCIA" as the selected value, and the modal is no longer in the DOM

#### Scenario: the IA confirm does not fire the manual POST

- **WHEN** the user clicks the modal's "Confirmar"
- **THEN** no `POST /api/pagos` request is made (the modal is read-and-confirm only; the manual POST fires when the user clicks the form's own "Confirmar")

#### Scenario: the IA-confirmed form still cannot send a factura_id

- **WHEN** the user clicks the modal's "Confirmar" and then clicks the form's "Confirmar"
- **THEN** the `POST /api/pagos` request body has no `factura_id` key (RN-PAG-01, structural absence inherited from the C-11 form)

#### Scenario: the IA button is disabled while the form mutation is in flight

- **WHEN** the user has clicked the form's "Confirmar" and `useCreatePago` is `isPending`
- **THEN** the "Cargar con imagen (IA)" button is `disabled`

### Requirement: Edit-mode PagoFormPage displays the supplier name from PagoResponse.proveedor_nombre

The system SHALL display the supplier's `nombre` in the readonly supplier field of the `PagoFormPage` edit mode, using the new `PagoResponse.proveedor_nombre` field (populated by the backend per the `pagos-backend` delta). When the field is populated (the supplier is active), the display SHALL be the supplier's name (e.g., "YPF S.A."). When the field is `None` (the supplier is soft-deleted), the display SHALL fall back to the supplier's UUID (the previous behavior, preserved for the soft-deleted case). The fix removes the UUID-as-name fallback that c-11 introduced as a workaround for the missing backend field; the workaround is no longer needed because the backend now provides the field.

#### Scenario: edit-mode display shows the supplier's name when the field is populated

- **WHEN** the user opens `/pagos/:id/editar` for a pago whose `PagoResponse.proveedor_nombre` is "YPF S.A."
- **THEN** the readonly supplier field displays "YPF S.A." (NOT the UUID)

#### Scenario: edit-mode display falls back to UUID when the field is None

- **WHEN** the user opens `/pagos/:id/editar` for a pago whose `PagoResponse.proveedor_nombre` is `None` (the supplier was soft-deleted)
- **THEN** the readonly supplier field displays the supplier's UUID (the fallback behavior is preserved for the soft-deleted case)

#### Scenario: the readonly supplier field is structurally read-only (RN-PAG-01)

- **WHEN** the user opens `/pagos/:id/editar`
- **THEN** the readonly supplier field has no `<input>`, `<select>`, or other form control; the user cannot change the supplier (the backend PATCH cannot change `proveedor_id` per the `pagos-backend` D7 invariant; the frontend mirrors this)

