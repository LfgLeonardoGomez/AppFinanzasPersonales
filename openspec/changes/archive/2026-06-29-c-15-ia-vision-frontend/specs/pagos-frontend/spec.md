# pagos-frontend Specification (delta for c-15-ia-vision-frontend)

## ADDED Requirements

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
