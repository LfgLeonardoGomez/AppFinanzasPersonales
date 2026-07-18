## MODIFIED Requirements

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
