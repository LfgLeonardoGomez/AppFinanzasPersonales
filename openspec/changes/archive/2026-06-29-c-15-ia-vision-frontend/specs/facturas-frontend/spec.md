# facturas-frontend Specification (delta for c-15-ia-vision-frontend)

## ADDED Requirements

### Requirement: The create-mode invoice form offers a "Cargar con imagen (IA)" shortcut

The `FacturaFormPage` SHALL render a "Cargar con imagen (IA)" button in create mode, alongside the existing "Carga manual" entry. Clicking the button SHALL open the `PropuestaIAModal` (defined in the `ia-vision-frontend` capability) with `tipo='factura'`. The button SHALL be HIDDEN in edit mode (the IA flow applies to new documents only). The form SHALL accept a `prefillFromProposal` prop (or controlled state equivalent) so the modal can populate the form's fields on confirm. The pre-fill SHALL be subject to the same backend validations as the manual flow (RN-FAC-01..09 enforced by the C-08 Pydantic schema). The button SHALL be disabled while the form's own `useCreateFactura` mutation is `isPending`.

#### Scenario: create-mode form shows the IA button

- **WHEN** the user opens `/facturas/nueva` (the create-mode `FacturaFormPage`)
- **THEN** the form renders a "Cargar con imagen (IA)" button next to the existing manual entry, and clicking it opens the `PropuestaIAModal` with `tipo='factura'`

#### Scenario: edit-mode form hides the IA button

- **WHEN** the user opens `/facturas/{id}/editar` (the edit-mode `FacturaFormPage`)
- **THEN** the "Cargar con imagen (IA)" button is NOT rendered in the DOM

#### Scenario: the IA confirm pre-fills the form fields

- **WHEN** the user clicks the modal's "Confirmar" with `propuesta = { proveedor_nombre: "Acme SA", numero: "0001-1234", fecha_emision: "2026-06-15", monto_total: 1234.56 }` and `selectedProveedor = { id: "uuid", nombre: "Acme SA" }`
- **THEN** the form's `selectedProveedor` becomes the picked `Proveedor`, the `numero` input shows "0001-1234", the `fecha_emision` input shows "2026-06-15", the `monto_total` input shows `1234.56`, and the modal is no longer in the DOM

#### Scenario: the IA confirm does not fire the manual POST

- **WHEN** the user clicks the modal's "Confirmar"
- **THEN** no `POST /api/facturas` request is made (the modal is read-and-confirm only; the manual POST fires when the user clicks the form's own "Confirmar")

#### Scenario: the IA button is disabled while the form mutation is in flight

- **WHEN** the user has clicked the form's "Confirmar" and `useCreateFactura` is `isPending`
- **THEN** the "Cargar con imagen (IA)" button is `disabled`
