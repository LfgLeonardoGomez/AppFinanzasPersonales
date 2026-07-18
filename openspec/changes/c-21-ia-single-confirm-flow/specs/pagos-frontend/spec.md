## MODIFIED Requirements

### Requirement: The create-mode payment form offers a "Cargar con imagen (IA)" shortcut

The `PagoFormPage` SHALL render a "Cargar con imagen (IA)" entry in create mode, alongside the existing "Carga manual" entry. Choosing it SHALL open the `PropuestaIAModal` (defined in the `ia-vision-frontend` capability) with `tipo='pago'`. The button SHALL be HIDDEN in edit mode (the IA flow applies to new documents only).

For the IA path, the modal is **terminal**: on the modal's single "Confirmar", the resource is created directly from the modal (via `useCreatePago`) and the large manual form is NOT shown. The page SHALL pass `useCreatePago` (and the supplier-search/create wiring) into the modal, and SHALL NOT route the IA path into the manual `PagoForm`. The manual path (mode selector → `PagoForm`) is unchanged. The IA-created payload SHALL structurally remain unable to carry a `factura_id` (RN-PAG-01) — the create payload is `{ proveedor_id, monto, fecha, metodo, comprobante_url, origen: 'IA' }` with `extra="forbid"` enforced by the C-10 schema.

#### Scenario: create-mode form shows the IA entry

- **WHEN** the user opens `/pagos/nuevo` (the create-mode `PagoFormPage`)
- **THEN** the page renders a "Cargar con imagen (IA)" entry next to the manual entry, and choosing it opens the `PropuestaIAModal` with `tipo='pago'`

#### Scenario: edit-mode hides the IA entry

- **WHEN** the user opens `/pagos/{id}/editar` (the edit-mode `PagoFormPage`)
- **THEN** the "Cargar con imagen (IA)" entry is NOT rendered in the DOM

#### Scenario: the IA confirm creates the pago directly (no second form)

- **WHEN** the user confirms the modal with `propuesta = { proveedor_nombre: "Acme SA", monto: 5000, fecha: "2026-06-20", metodo: "TRANSFERENCIA" }` and a selected supplier
- **THEN** exactly one `POST /api/pagos` fires from the modal with `{ proveedor_id, monto: 5000, fecha: "2026-06-20", metodo: "TRANSFERENCIA", comprobante_url, origen: 'IA' }`, the modal closes, and the manual `PagoForm` is never rendered for this path

#### Scenario: the IA-created pago still cannot send a factura_id

- **WHEN** the IA confirm fires `POST /api/pagos`
- **THEN** the request body has no `factura_id` key (RN-PAG-01, structural absence)

## ADDED Requirements

### Requirement: Creating a payment redirects to the supplier's cuenta corriente

After a successful payment creation (both the manual `PagoForm` path and the IA modal path), the app SHALL navigate to the supplier's detail / cuenta-corriente route `/proveedores/:id`, using the `proveedor_id` of the created pago, so the user sees the payment reflected in the ledger. This aligns payment creation with the existing invoice behavior (`FacturaFormPage` already redirects to `/proveedores/:id`). A success message SHALL be surfaced on arrival.

#### Scenario: manual pago creation lands on the supplier's cuenta corriente

- **WHEN** the user creates a pago via the manual form and the `POST /api/pagos` succeeds with `proveedor_id = "uuid-123"`
- **THEN** the app navigates to `/proveedores/uuid-123` (not `/pagos`) with a success message

#### Scenario: IA pago creation lands on the supplier's cuenta corriente

- **WHEN** the user creates a pago via the IA modal and the create succeeds with `proveedor_id = "uuid-123"`
- **THEN** the app navigates to `/proveedores/uuid-123` with a success message
