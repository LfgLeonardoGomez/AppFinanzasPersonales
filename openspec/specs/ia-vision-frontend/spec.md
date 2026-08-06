# ia-vision-frontend Specification

## Purpose

New capability: the web interface of the PWA (`facturas-proveedores-web`) that consumes the C-14 `POST /api/facturas/extraer-ia` and `POST /api/pagos/extraer-ia` vision-extraction endpoints and presents the resulting header-only proposal to the user as a pre-filled preview inside the existing `FacturaFormPage` and `PagoFormPage`. Shipped by C-15, this capability adds a "Cargar con imagen (IA)" button inside the create-mode invoice and payment forms that opens a blocking `PropuestaIAModal` accepting an image-only upload, surfaces the vision response (or its failure envelope, 422, 429, or generic error) without ever persisting (the modal is read-and-confirm; the persist call is the existing C-09 / C-11 `useCreateFactura` / `useCreatePago`), and applies RN-VINC supplier matching through the existing `SupplierSearch` from C-07 — never pre-selecting a supplier (the IA returns `proveedor_nombre` as a string, the user picks). The capability enforces RN-IA-04 (no `POST /api/facturas` or `POST /api/pagos` is fired from inside the modal — only from the form's own submit, after the user reviews the pre-filled fields), RN-IA-05 (graceful UI on extractor failure with a manual fallback), and RN-IA-06 (no `proveedor_id` in the response, no pre-selection in the UI). Rate limiting (10 req/hour per `usuario_id`, 429 + `Retry-After`) is surfaced as a recoverable error state with a countdown; the 11th request does not retry silently. All HTTP calls go through the shared Axios client (C-04). After an IA-modal confirm, the client SENDS `origen: 'IA'` in the `POST /api/facturas` or `POST /api/pagos` body (OQ-1 RESOLVED via c-15a, Path B — the backend schemas `app/schemas/factura.py:77` and `app/schemas/pago.py:61` declare `origen: Optional[OrigenDocumento] = None`; the services persist the provided value, defaulting to `MANUAL` only when a fully-manual entry omits the field).
## Requirements
### Requirement: "Cargar con imagen (IA)" button is offered on the create-mode invoice and payment forms

The `FacturaFormPage` and `PagoFormPage` SHALL render a "Cargar con imagen (IA)" button in create mode, alongside the existing "Carga manual" entry. The button SHALL be HIDDEN in edit mode (the IA flow applies to new documents only). Clicking the button SHALL open the `PropuestaIAModal` scoped to the current form type (factura or pago). The button SHALL NOT be the form's primary action — it is an alternative entry point that the user can ignore. The button SHALL be disabled while a different mutation on the form is in flight (the form's existing `useCreateFactura` / `useCreatePago` is `isPending`).

#### Scenario: create-mode invoice form shows the IA button

- **WHEN** the user opens `/facturas/nueva` (the create-mode `FacturaFormPage`)
- **THEN** the form renders a "Cargar con imagen (IA)" button next to the existing manual entry, and clicking it opens the `PropuestaIAModal` with `tipo='factura'`

#### Scenario: create-mode payment form shows the IA button

- **WHEN** the user opens `/pagos/nuevo` (the create-mode `PagoFormPage`)
- **THEN** the form renders a "Cargar con imagen (IA)" button next to the existing manual entry, and clicking it opens the `PropuestaIAModal` with `tipo='pago'`

#### Scenario: edit-mode forms hide the IA button

- **WHEN** the user opens `/facturas/{id}/editar` or `/pagos/{id}/editar` (the edit-mode form pages)
- **THEN** the "Cargar con imagen (IA)" button is NOT rendered in the DOM (verified by query — not by `display: none`), and no IA shortcut is available

#### Scenario: the IA button is disabled while a form mutation is in flight

- **WHEN** the user has clicked the form's "Confirmar" and `useCreateFactura` (or `useCreatePago`) is `isPending`
- **THEN** the "Cargar con imagen (IA)" button is `disabled` and cannot be clicked

### Requirement: The image-only upload drives a vision extraction against the C-14 endpoints

When the user picks an image in the `PropuestaIAModal`, the modal SHALL post the file as `multipart/form-data` to the C-14 endpoint corresponding to the form's type: `POST /api/facturas/extraer-ia` for invoices, `POST /api/pagos/extraer-ia` for payments. The modal SHALL accept only image files (JPEG / PNG / WebP) and SHALL reject other types client-side for UX (PDF, HEIC, GIF, etc.). The file size limit SHALL be 10 MB (matching the C-14 backend's limit, RN-IA-01 / RN-FAC-07). The modal SHALL display an extracting state (spinner + "Leyendo la imagen…") while the request is in flight and SHALL prevent the user from picking a new file or closing the modal during the in-flight request. The modal SHALL NOT persist anything during or after the extraction (RN-IA-04).

#### Scenario: the modal posts a valid image to the matching C-14 endpoint

- **WHEN** the user picks a valid JPEG of 1 MB in the `PropuestaIAModal` of type `factura`
- **THEN** the modal sends one `POST /api/facturas/extraer-ia` with `multipart/form-data` containing the `file` part, and the request reaches the C-14 vision extractor (asserted by the MSW handler receiving the call and the response being a 200 with a `PropuestaFactura` body)

#### Scenario: the pago modal posts to the pago C-14 endpoint

- **WHEN** the user picks a valid PNG in the `PropuestaIAModal` of type `pago`
- **THEN** the modal sends one `POST /api/pagos/extraer-ia` with `multipart/form-data` containing the `file` part

#### Scenario: the modal rejects non-image files client-side

- **WHEN** the user picks a PDF or a HEIC file in the `PropuestaIAModal`
- **THEN** the modal shows "Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP." and does NOT call the C-14 endpoint

#### Scenario: the modal rejects oversized files client-side

- **WHEN** the user picks a file larger than 10 MB
- **THEN** the modal shows "La imagen supera el tamaño máximo de 10 MB." and does NOT call the C-14 endpoint

#### Scenario: the modal prevents closing during the in-flight extraction

- **WHEN** the extraction request is in flight (`useExtraerFacturaIA` is `isPending`)
- **THEN** the modal's "Cancelar" button is `disabled` and pressing `Escape` does NOT close the modal; the in-flight request completes (success or error) before the user can close

#### Scenario: no persistence happens during the extraction

- **WHEN** the extraction request completes (success or error)
- **THEN** no `POST /api/facturas` or `POST /api/pagos` request is made by the modal — the modal is read-and-confirm only (RN-IA-04); the test asserts the only request fired is the `extraer-ia` call

### Requirement: The proposal is shown in a blocking preview modal with the four error states

On a successful 200 response, the modal SHALL transition to the `proposal` state, displaying the response fields as editable inputs. Every field in the response that is `null` SHALL be rendered as an empty input (the modal SHALL NOT invent, guess, or compute a value, RN-IA-03). The modal SHALL block the form's submission while open (the form's "Confirmar" is behind the modal overlay). The modal SHALL expose three actions in the `proposal` state: "Confirmar" (fills the form, closes the modal), "Reintentar" (resets to `idle`, clears the file), and "Cancelar" (closes, discards the proposal without filling the form). The modal SHALL also handle the four error states from the C-14 contract: `error_422` (non-image / oversized on the server side), `error_429` (rate limit, with the `Retry-After` countdown), `error_extractor` (the response has `error: true`, RN-IA-05), and `error_generic` (5xx / network).

#### Scenario: a successful 200 renders the proposal with null fields as empty inputs

- **WHEN** the C-14 endpoint returns 200 with `{"proveedor_nombre": "Acme SA", "numero": null, "fecha_emision": "2026-06-15", "monto_total": null, "error": false, "error_message": null}`
- **THEN** the modal's `proposal` state renders inputs: `proveedor_nombre="Acme SA"`, `numero=""`, `fecha_emision="2026-06-15"`, `monto_total=""` — and the form's "Confirmar" is NOT clickable while the modal is open (asserted by the modal overlay being mounted and the form's submit button being visually behind it)

#### Scenario: a 422 response reverts the modal to idle with a clear message

- **WHEN** the C-14 endpoint returns 422 (e.g. the user's file passed the client check but the magic bytes are not a supported image, or the file is 10 MB + 1 byte on the server side)
- **THEN** the modal's `error_422` state shows "Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB." and the user can pick a new file

#### Scenario: a 429 response shows the Retry-After countdown

- **WHEN** the C-14 endpoint returns 429 with a `Retry-After: 600` header (10 minutes)
- **THEN** the modal's `error_429` state shows "Demasiadas solicitudes. Has alcanzado el límite de extracciones con IA (10 por hora). Intentá en 10 minutos." and a countdown that decrements every second; the user can "Cancelar" to dismiss the modal; the modal does NOT auto-retry when the countdown reaches 0

#### Scenario: an error:true envelope (RN-IA-05) shows the manual fallback

- **WHEN** the C-14 endpoint returns 200 with `{"proveedor_nombre": null, "numero": null, "fecha_emision": null, "monto_total": null, "error": true, "error_message": "Image too blurry"}`
- **THEN** the modal's `error_extractor` state shows "No se pudo leer la imagen. La IA no pudo extraer los datos. Podés cargar manualmente." with two buttons: "Cargar manualmente" (closes the modal, leaves the form empty) and "Reintentar con otra foto" (back to `idle`)

#### Scenario: a generic 5xx / network error shows a recoverable retry

- **WHEN** the C-14 endpoint returns 500 or the request fails with a network error
- **THEN** the modal's `error_generic` state shows "Algo salió mal. Reintentá o cargá manualmente." with "Reintentar" (re-fires the mutation with the same file) and "Cargar manualmente" (closes the modal)

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

### Requirement: The Pydantic-to-TS contract is closed in api.d.ts

The frontend SHALL extend `src/shared/api/api.d.ts` with the types `PropuestaFactura` and `PropuestaPago`, mirroring the C-14 Pydantic shapes from `app/schemas/factura.py:192` and `app/schemas/pago.py:104`. The decimals (`monto_total`, `monto`) SHALL be typed as `number` (the API helper parses the Pydantic-v2 string-decimal at the boundary). The `metodo` field in `PropuestaPago` SHALL be of type `MetodoPago | null` (the C-14 Pydantic normalizes invalid enum values to `None`). A compile-time test (`api.iaVision.test-d.ts`) SHALL assert that `PropuestaFactura` and `PropuestaPago` have NO `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`, or `updated_at` keys (the C-14 spec is explicit: vision proposals are header-only, identity-less, and the `origen=IA` flag is NOT set by the C-14 endpoints). A runtime-guard test SHALL assert that the type instances carry no `origen` or `factura_id` key (defense in depth for RN-IA-06 and RN-PAG-01 on the IA surface).

#### Scenario: api.d.ts declares the closed types with all-nullable fields

- **WHEN** the compile-time test runs at `tsc --noEmit`
- **THEN** `PropuestaFactura` and `PropuestaPago` compile with all the documented fields and no extra fields — the type union is closed and any drift from the C-14 Pydantic shape is caught at type-check time

#### Scenario: PropuestaFactura has no id, usuario_id, proveedor_id, origen, or timestamps

- **WHEN** the compile-time test inspects the `PropuestaFactura` type
- **THEN** the assertion that `PropuestaFactura` has no `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`, or `updated_at` key compiles cleanly — the structural absence is locked at the type level

#### Scenario: PropuestaPago has no factura_id (RN-PAG-01 on the IA surface)

- **WHEN** the compile-time test inspects the `PropuestaPago` type
- **THEN** the assertion that `PropuestaPago` has no `factura_id` key compiles cleanly — the IA surface cannot smuggle a `factura_id` even at the type level

### Requirement: Data layer over the C-14 endpoints with the five response shapes

The frontend SHALL implement two TanStack Query mutation hooks (`useExtraerFacturaIA`, `useExtraerPagoIA`) over a typed Axios function that posts `multipart/form-data`. The mutation hooks SHALL NOT retry on failure (a 429 is a real answer; an `error: true` envelope is a real answer; 422 is a real answer; only generic 5xx / network is a candidate for manual retry via the "Reintentar" button). The mutations SHALL NOT invalidate any TanStack Query keys (the proposal is a transient value held in modal state; the actual persist happens via the existing C-09 / C-11 mutation hooks, which already invalidate the cuenta-corriente cache per C-13). The raw Axios call SHALL parse the response's `Decimal` strings into `number` at the API boundary (the same pattern as C-13's `parseCuentaCorriente`). The MSW tests SHALL cover all five response shapes: 200 success, 422 (non-image / oversized), 429 (rate limit, with `Retry-After`), 200 with `error: true` envelope, 500 generic.

#### Scenario: 200 success returns a fully-typed proposal

- **WHEN** `useExtraerFacturaIA().mutate(file)` is called and the C-14 endpoint returns 200 with a complete `PropuestaFactura` JSON
- **THEN** the mutation's `onSuccess` is called with a `PropuestaFactura` value (all fields typed per the `api.d.ts` extension), the `error` field is `false`, and the `monto_total` decimal string has been parsed to a `number`

#### Scenario: 422 surfaces as a recoverable error with the backend message

- **WHEN** the C-14 endpoint returns 422 (non-image / oversized on the server side)
- **THEN** the mutation's `onError` is called with a typed error containing the status code 422 and the backend's error message; the modal transitions to the `error_422` state with the message displayed verbatim

#### Scenario: 429 surfaces with the Retry-After header parsed

- **WHEN** the C-14 endpoint returns 429 with `Retry-After: 600` (seconds)
- **THEN** the mutation's `onError` is called with a typed error containing the status code 429 and `retryAfterSeconds: 600`; the modal transitions to the `error_429` state with a countdown that decrements every second

#### Scenario: 200 with error:true surfaces the manual fallback

- **WHEN** the C-14 endpoint returns 200 with `error: true` and `error_message: "Image too blurry"`
- **THEN** the mutation's `onSuccess` is called with a `PropuestaFactura` value where `error` is `true` and `error_message` is the backend's string; the modal transitions to the `error_extractor` state with the message displayed and the "Cargar manualmente" / "Reintentar con otra foto" actions

#### Scenario: 500 / network surfaces a generic retry

- **WHEN** the C-14 endpoint returns 500 or the request fails with a network error
- **THEN** the mutation's `onError` is called with a generic error; the modal transitions to the `error_generic` state with "Reintentar" and "Cargar manualmente" actions

#### Scenario: no cache invalidation on extraction

- **WHEN** the extraction mutation succeeds (any of the five response shapes)
- **THEN** no `invalidateQueries` is called by the C-15 hooks (verified by spying on the QueryClient); the proposal is held in modal state, and any persist happens via the existing C-09 / C-11 mutations which already manage their own invalidations (C-13 wiring)

### Requirement: The IA shortcuts respect RN-PAG-01 and RN-FAC-01..09 via the underlying forms

The IA flow is a pre-filler for the existing C-09 / C-11 forms. The pre-filled values SHALL be subject to the same backend validations as the manual flow:
- Factura: `monto_total > 0` (RN-FAC-01), `fecha_emision` not future (RN-FAC-02), `proveedor_id` must belong to the user (HARD RULE in C-08).
- Pago: `monto > 0` (RN-PAG-02), `fecha` not future (RN-PAG-03), `metodo` from the enum (RN-PAG-04), `proveedor_id` must belong to the user (HARD RULE in C-10).

The modal SHALL NOT bypass these validations. If the proposal contains values that would fail the backend validation (e.g. a negative `monto_total`), the existing form validation surfaces the error inline on the form's submit. The test asserts that a confirm with a negative `monto_total` results in a form that blocks submit and shows the existing C-09 validation message.

#### Scenario: a pre-filled negative monto_total is rejected by the existing form

- **WHEN** the user confirms a proposal with `monto_total = -100` (an impossible vision result, but defensive)
- **THEN** the form's `monto_total` input shows `-100` and the form's "Confirmar" is enabled, but clicking it shows the existing C-09 "El monto total debe ser mayor a 0" inline error and does NOT call `POST /api/facturas` (the backend is the authority per the C-09 / C-11 spec)

#### Scenario: a pre-filled metodo from the IA proposal populates the form's select

- **WHEN** the user confirms a pago proposal with `metodo = "TRANSFERENCIA"`
- **THEN** the form's `metodo` select shows "TRANSFERENCIA" as the selected value; the existing C-11 validation passes and `POST /api/pagos` is accepted by the backend

#### Scenario: a pre-filled metodo with a null value leaves the form's select empty

- **WHEN** the user confirms a pago proposal with `metodo = null`
- **THEN** the form's `metodo` select is empty (the placeholder is shown); the user must pick a method before the form can submit (per the C-11 `pagos-frontend` spec's "missing metodo is rejected" scenario)

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

### Requirement: The human can reject the AI's supplier match

The AI-proposed supplier SHALL be dismissible. When the extraction auto-matches a supplier and pre-selects it, the user MUST be able to clear that selection and choose or create a different supplier. A confirmation step in which only "accept" is reachable is not a confirmation (RN-IA-06: the AI proposes, the human confirms).

#### Scenario: Clearing an auto-matched supplier keeps it cleared

- **WHEN** the AI auto-matches a supplier, pre-selects it, and the user activates the clear control
- **THEN** the selection is emptied and STAYS empty across subsequent renders, so the user can search for or create a different supplier

#### Scenario: Auto-match still pre-selects on a fresh proposal

- **WHEN** an extraction returns a supplier name that uniquely matches one of the user's suppliers
- **THEN** that supplier is pre-selected automatically, exactly as before

#### Scenario: A new AI reading may auto-match again after a previous dismissal

- **WHEN** the user cleared the auto-matched supplier and then a new extraction produces a different detected supplier name
- **THEN** the auto-match applies again for the new name — the dismissal applies to the proposal the user rejected, not to the control forever

#### Scenario: The dismissal applies to both invoices and payments

- **WHEN** the clear control is used in either the invoice or the payment AI flow
- **THEN** the behaviour is identical, because both flows share one supplier-match control

### Requirement: The carga modal behaves like every other dialog

The carga modal SHALL be built on the same dialog primitive as the rest of the application. It MUST trap focus while open, dismiss on `Esc` and on backdrop activation, and restore focus to the element that opened it — the same contract every other dialog has satisfied since C-20.

#### Scenario: Focus is trapped while the modal is open

- **WHEN** the modal is open and the user moves focus forward past the last focusable control
- **THEN** focus stays within the modal instead of reaching the page behind it

#### Scenario: Dismissal is conventional

- **WHEN** the user presses `Esc`, or activates the backdrop, while dismissal is allowed
- **THEN** the modal closes

#### Scenario: Dismissal stays blocked while the AI is reading the image

- **WHEN** the extraction is in progress and the user presses `Esc` or activates the backdrop
- **THEN** the modal does NOT close, preserving the guard the previous implementation enforced

#### Scenario: Existing behaviour is unchanged

- **WHEN** the modal is used for any of its flows — origen, processing, review, success, for factura or pago, image or manual
- **THEN** it behaves exactly as before the dialog primitive was swapped

