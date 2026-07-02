# IA Vision Frontend Specification

## Purpose

New capability: the web interface of the PWA (`facturas-proveedores-web`) that consumes the C-14 `POST /api/facturas/extraer-ia` and `POST /api/pagos/extraer-ia` vision-extraction endpoints and presents the resulting header-only proposal to the user as a pre-filled preview inside the existing `FacturaFormPage` and `PagoFormPage`. Shipped by C-15, this capability adds a "Cargar con imagen (IA)" button inside the create-mode invoice and payment forms that opens a blocking `PropuestaIAModal` accepting an image-only upload, surfaces the vision response (or its failure envelope, 422, 429, or generic error) without ever persisting (the modal is read-and-confirm; the persist call is the existing C-09 / C-11 `useCreateFactura` / `useCreatePago`), and applies RN-VINC supplier matching through the existing `SupplierSearch` from C-07 — never pre-selecting a supplier (the IA returns `proveedor_nombre` as a string, the user picks). The capability enforces RN-IA-04 (no `POST /api/facturas` or `POST /api/pagos` is fired from inside the modal — only from the form's own submit, after the user reviews the pre-filled fields), RN-IA-05 (graceful UI on extractor failure with a manual fallback), and RN-IA-06 (no `proveedor_id` in the response, no pre-selection in the UI). Rate limiting (10 req/hour per `usuario_id`, 429 + `Retry-After`) is surfaced as a recoverable error state with a countdown; the 11th request does not retry silently. All HTTP calls go through the shared Axios client (C-04). No `origen` field is sent from the client (governed by the open question in `proposal.md` — Path A is the default; the backend currently hardcodes `origen=MANUAL` in the service layer, so sending `origen` from the client would either be silently ignored on `FacturaCreate` or rejected with 422 on `PagoCreate`).

## ADDED Requirements

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

The modal SHALL pass the proposal's `proveedor_nombre: string | null` to the shared `SupplierSearch` component (C-07) as the initial search query. The `SupplierSearch`'s `value` SHALL be `null` (no pre-selected supplier) even when the proposal includes a non-null `proveedor_nombre` (RN-IA-06). The user SHALL be able to: (1) accept an autocomplete suggestion, (2) clear the input and search the full `Proveedor` list, or (3) create a new supplier on the spot via the existing `useCreateProveedor` mutation (C-07). The modal's "Confirmar" button SHALL be disabled until the user has selected a `Proveedor` (because the existing C-09 / C-11 mutation hooks require `proveedor_id` in the payload).

#### Scenario: the modal passes the detected name as the initial query and value is null

- **WHEN** the modal's `proposal` state receives `propuesta.proveedor_nombre = "Acme SA"`
- **THEN** the `SupplierSearch` component's input value is the string "Acme SA" (initial query) but the selected `value` is `null` — no supplier is pre-selected (RN-IA-06)

#### Scenario: the user can accept an autocomplete suggestion

- **WHEN** the `SupplierSearch` shows a suggestion list (e.g. the user owns a `Proveedor` named "Acme SA") and the user picks one
- **THEN** the `SupplierSearch` `value` becomes that `Proveedor` and the modal's "Confirmar" button becomes enabled

#### Scenario: the user can clear the input and search the full list

- **WHEN** the user clears the search input and types a different name
- **THEN** the `SupplierSearch` re-queries the user's `Proveedor` list and shows the matching suggestions; no auto-selection happens

#### Scenario: the user can create a new supplier on the spot

- **WHEN** the `SupplierSearch` shows no matching suggestion and the user clicks "Crear nuevo proveedor" (the RN-VINC step 3)
- **THEN** the existing `useCreateProveedor` mutation fires; on success, the new `Proveedor` becomes the `SupplierSearch` value and the modal's "Confirmar" becomes enabled

#### Scenario: the modal's Confirmar is disabled until a supplier is selected

- **WHEN** the modal is in the `proposal` state and the `SupplierSearch` `value` is still `null`
- **THEN** the modal's "Confirmar" button is `disabled` and clicking it has no effect

#### Scenario: a non-null proveedor_nombre never auto-selects even on exact match

- **WHEN** the user owns a `Proveedor` named "Acme SA" (exact normalized match with the proposal) and the modal opens
- **THEN** the `SupplierSearch` value is `null` and the user MUST explicitly pick the suggestion (or pick a different one) before confirming; the test asserts that no automatic `onChange` is fired with the matching `Proveedor`

### Requirement: The confirm action populates the form without firing any persist mutation

When the user clicks the modal's "Confirmar", the modal SHALL call `onConfirm(propuesta, selectedProveedor)` and close. The parent form (`FacturaFormPage` or `PagoFormPage`) SHALL set its form state from the proposal:
- `selectedProveedor` ← the user-picked `Proveedor`
- `fecha_emision` (or `fecha`) ← `propuesta.fecha_emision` (or `propuesta.fecha`) if non-null
- `monto_total` (or `monto`) ← `propuesta.monto_total` (or `propuesta.monto`) if non-null
- `numero` (facturas only) ← `propuesta.numero` if non-null
- `metodo` (pagos only) ← `propuesta.metodo` if non-null

The modal SHALL NOT call `useCreateFactura.mutate` or `useCreatePago.mutate` directly (RN-IA-04). The actual persist happens when the user clicks the form's own "Confirmar" button, which fires the existing C-09 / C-11 mutation. The `useCreateFactura` / `useCreatePago` request body SHALL include `origen: 'IA'` (OQ-1 RESOLVED via c-15a, Path B — the backend schemas now declare `origen: Optional[OrigenDocumento] = None` and the services persist the provided value, defaulting to `MANUAL` only when `origen` is omitted from a fully-manual entry).

#### Scenario: the modal's Confirmar fills the form state and closes

- **WHEN** the user clicks "Confirmar" in the modal with `propuesta.monto_total = 1234.56` and `selectedProveedor = { id: "uuid", nombre: "Acme SA" }`
- **THEN** the form's `selectedProveedor` is set to the picked `Proveedor`, the form's `monto_total` input shows `1234.56`, and the modal is no longer in the DOM (verified by query)

#### Scenario: the modal's Confirmar does NOT fire the manual POST

- **WHEN** the user clicks "Confirmar" in the modal
- **THEN** no `POST /api/facturas` or `POST /api/pagos` request is made (asserted by the MSW handler not receiving the call) — the modal is read-and-confirm only (RN-IA-04)

#### Scenario: the form's manual POST carries `origen: 'IA'` after an IA-modal confirm

- **WHEN** after a successful modal confirm (IA flow), the user clicks the form's "Confirmar" and the manual `POST /api/facturas` (or `POST /api/pagos`) fires
- **THEN** the request body includes `origen: 'IA'` (OQ-1 RESOLVED via c-15a, Path B); the test asserts the body keys include `origen: 'IA'` plus the existing C-09 / C-11 manual payload shape

#### Scenario: null proposal fields are NOT pre-filled

- **WHEN** the user clicks "Confirmar" with `propuesta.fecha_emision = null`
- **THEN** the form's `fecha_emision` field is NOT changed from its current value (empty / existing user input); the test asserts the form's date input is empty after the confirm when the proposal field was null (RN-IA-03)

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
