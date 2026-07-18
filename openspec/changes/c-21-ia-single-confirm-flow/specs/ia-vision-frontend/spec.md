## MODIFIED Requirements

### Requirement: Supplier matching via the shared SupplierSearch; the IA never pre-selects

When the modal enters the `proposal` state, it SHALL attempt to **auto-match** the proposal's `proveedor_nombre: string | null` against the user's active suppliers (RN-VINC, reusing the `buscarProveedores` / `useBuscarProveedores` search of the `proveedores-frontend` capability). The match is a **frontend responsibility** (RN-IA-06): the IA never assigns a supplier server-side.

- If `proveedor_nombre` is non-null AND exactly one active supplier matches by **normalized exact name** (lowercase, accents stripped, trimmed), the modal SHALL **pre-select** that supplier (set the internal `selectedProveedor`), enabling the "Confirmar" button, and SHALL surface that the match is a suggestion the user can change.
- If there is no match (or `proveedor_nombre` is null), the modal SHALL offer a **"Crear «X»" action inline within the modal** (no navigation away, no second form). This action SHALL create a supplier with only the name — `ProveedorCreate` requires only `nombre`; `categoria` defaults to `OTRO` and all other fields are omitted — via the existing `useCreateProveedor` mutation, and the name SHALL be **editable** before creating. On success the new supplier becomes the `selectedProveedor` and "Confirmar" becomes enabled.
- The user SHALL always be able to override the auto-match: clear the selection and pick a different supplier via the shared `SupplierSearch`.

The pre-selection is a **suggestion driven by the user's own data**, not an IA assignment: the invoice/payment is still not created until the user explicitly confirms (RN-IA-06 human-confirms is intact). The "Confirmar" button SHALL remain disabled until a `Proveedor` is selected.

#### Scenario: exact normalized name match pre-selects the supplier

- **WHEN** the modal enters `proposal` with `propuesta.proveedor_nombre = "Acme SA"` and the user owns exactly one active `Proveedor` whose normalized name equals "acme sa"
- **THEN** that `Proveedor` becomes the modal's `selectedProveedor`, the "Confirmar" button is enabled, and the UI shows the matched supplier as a changeable selection

#### Scenario: no match offers inline creation with the detected name editable

- **WHEN** the modal enters `proposal` with `propuesta.proveedor_nombre = "Ferretería Nueva"` and the user has no matching active `Proveedor`
- **THEN** the modal shows a "Crear «Ferretería Nueva»" action inside the modal with the name in an editable field; no supplier is selected and "Confirmar" is disabled

#### Scenario: inline creation creates with only the name and default categoria

- **WHEN** the user confirms the inline "Crear «Ferretería Nueva»" action (optionally editing the name first)
- **THEN** `useCreateProveedor` fires with `{ nombre: "Ferretería Nueva", categoria: "OTRO" }` (no other fields), and on success that new `Proveedor` becomes `selectedProveedor` and "Confirmar" becomes enabled — all without leaving the modal

#### Scenario: the user can override the auto-match

- **WHEN** the modal pre-selected a supplier from the auto-match and the user clears it and searches for a different supplier
- **THEN** the `SupplierSearch` re-queries the user's `Proveedor` list and the user can pick a different supplier; the new pick replaces `selectedProveedor`

#### Scenario: null proveedor_nombre leaves the selection empty

- **WHEN** the modal enters `proposal` with `propuesta.proveedor_nombre = null`
- **THEN** no supplier is auto-selected, the `SupplierSearch` starts empty, and "Confirmar" is disabled until the user picks or creates a supplier

#### Scenario: the modal's Confirmar is disabled until a supplier is selected

- **WHEN** the modal is in the `proposal` state and `selectedProveedor` is still `null`
- **THEN** the modal's "Confirmar" button is `disabled` and clicking it has no effect

### Requirement: The confirm action populates the form without firing any persist mutation

The modal is **terminal** for the IA path: a single "Confirmar" creates the resource. When the user clicks "Confirmar" in the `proposal` state (with a `selectedProveedor` set), the modal SHALL:

1. Upload the image the IA read to Cloudinary via the signed preset (see the "confirmed image is persisted" requirement), obtaining a `secure_url`.
2. Fire the existing create mutation directly — `useCreateFactura` for `tipo='factura'`, `useCreatePago` for `tipo='pago'` — with a payload built from the edited proposal plus `proveedor_id = selectedProveedor.id`, the uploaded URL (`archivo_url` for factura, `comprobante_url` for pago), and `origen: 'IA'` (D-18 / c-15a Path B).
3. On success, close the modal and hand the created resource back to the page so it can redirect to the supplier's cuenta corriente (`/proveedores/:id`).

The IA path SHALL NOT fall through to the large manual form (that second step is removed for IA). The manual path (mode selector → form) is unchanged. This **supersedes** the C-15 decision that "the modal does not POST; the form creates on its own Confirmar": the extraction endpoint still never persists (RN-IA-04 backend intact), but the **human confirm inside the modal** now creates the resource.

The modal SHALL still respect all backend validations: only non-null proposal fields are sent; `monto`/`monto_total > 0`, non-future dates, and `metodo` from the enum are enforced by the backend Pydantic schemas, and a 422 surfaces as an error the user can correct from the modal.

#### Scenario: a single Confirmar creates the factura and closes the modal

- **WHEN** the user clicks "Confirmar" in a `tipo='factura'` modal with a valid edited proposal and `selectedProveedor = { id: "uuid", nombre: "Acme SA" }`
- **THEN** the image is uploaded, exactly one `POST /api/facturas` fires with `{ proveedor_id: "uuid", fecha_emision, monto_total, numero?, archivo_url, origen: 'IA' }`, the modal closes on success, and no second form is shown

#### Scenario: a single Confirmar creates the pago and closes the modal

- **WHEN** the user clicks "Confirmar" in a `tipo='pago'` modal with a valid edited proposal and a selected supplier
- **THEN** exactly one `POST /api/pagos` fires with `{ proveedor_id, monto, fecha, metodo, comprobante_url, origen: 'IA' }`, with **no** `factura_id` key (RN-PAG-01), and the modal closes on success

#### Scenario: the created payload carries origen 'IA'

- **WHEN** the modal's create mutation fires after an IA confirm
- **THEN** the request body includes `origen: 'IA'` (D-18 / c-15a Path B)

#### Scenario: a backend validation error keeps the modal open for correction

- **WHEN** the confirm fires `POST /api/facturas` with `monto_total = -100` and the backend returns 422
- **THEN** the modal stays open, shows the validation error, and does not close or redirect; the user can fix the field and re-confirm

#### Scenario: the IA path never routes to the large manual form

- **WHEN** the user confirms via the modal (IA path)
- **THEN** the page does not transition into the manual `FacturaForm` / `PagoForm` step — the resource is created directly from the modal

## ADDED Requirements

### Requirement: The confirmed image is uploaded to Cloudinary and persisted on the created resource

The `File` the IA read SHALL be carried through the confirm and, on "Confirmar", uploaded to Cloudinary using the same signed-preset flow as `FileUploadField` (`getCloudinaryPreset` / `useCloudinaryPreset`, `tipo='factura'` for invoices, `tipo='comprobante'` for payments). The resulting `secure_url` SHALL be persisted as `archivo_url` (Factura) or `comprobante_url` (Pago) on the create payload, so the document the IA read remains attached as the comprobante. Cloudinary SHALL be mocked in tests (hard rule #9).

#### Scenario: the read image becomes the factura's archivo_url

- **WHEN** the user picks an image, the IA extracts it, and the user confirms a `tipo='factura'` proposal
- **THEN** the image is uploaded to Cloudinary and the `POST /api/facturas` body includes `archivo_url` set to the returned `secure_url`

#### Scenario: the read image becomes the pago's comprobante_url

- **WHEN** the user confirms a `tipo='pago'` proposal
- **THEN** the image is uploaded with `tipo='comprobante'` and the `POST /api/pagos` body includes `comprobante_url` set to the returned `secure_url`

#### Scenario: an upload failure keeps the modal open and does not create the resource

- **WHEN** the Cloudinary upload fails during confirm
- **THEN** the modal shows an upload error, no `POST /api/facturas` or `POST /api/pagos` is made, and the user can retry the confirm
