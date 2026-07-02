# Design: c-15-ia-vision-frontend

## Context

C-14 (`ia-vision-backend`, archived 2026-06-27) ships two additive endpoints (per `openspec/specs/ia-vision-backend/spec.md` and the live `facturas-proveedores-api/app/routers/facturas.py` / `pagos.py`):

| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/api/facturas/extraer-ia` | `multipart/form-data` with a single `file` part (JPEG/PNG/WebP, ≤ 10 MB, validated by magic bytes) | 200 with `PropuestaFactura` JSON; 422 on bad type/oversize; 429 + `Retry-After` on rate limit; 401 unauthenticated |
| POST | `/api/pagos/extraer-ia` | same | 200 with `PropuestaPago` JSON; same error contract |

The Pydantic response shapes (mirrored in `app/schemas/factura.py:192` and `app/schemas/pago.py:104`):

```json
// PropuestaFactura
{
  "proveedor_nombre": "Acme SA" | null,
  "numero": "0001-00012345" | null,
  "fecha_emision": "2026-06-15" | null,
  "monto_total": "12345.67" | null,
  "error": false,
  "error_message": null
}

// PropuestaPago
{
  "proveedor_nombre": "Acme SA" | null,
  "monto": "5000.00" | null,
  "fecha": "2026-06-20" | null,
  "metodo": "TRANSFERENCIA" | null,   // EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO
  "error": false,
  "error_message": null
}
```

**Hard invariants from the C-14 spec (load-bearing for C-15):**
- **RN-IA-04** — the C-14 endpoints NEVER persist. A `before_flush` SQLAlchemy listener in the C-14 test suite asserts zero INSERT/UPDATE/DELETE during a request.
- **RN-IA-05** — the C-14 endpoints NEVER return 500. Any extractor exception is encapsulated as `error: true` + `error_message: str` + all other fields `None`; the response is still 200.
- **RN-IA-06** — the C-14 response contains `proveedor_nombre: str | None`, NEVER a `proveedor_id`. The frontend is solely responsible for matching against the user's `Proveedor` list (RN-VINC).
- **Rate limit** — 10 req/hour per `usuario_id` (keyed by user, not IP, per the C-14 spec's defense-in-depth against shared NAT). The 11th request returns 429 with a `Retry-After` header in seconds.

C-09 (`facturas-frontend`, archived 2026-06-25) and C-11 (`pagos-frontend`, archived 2026-06-27) shipped the two form pages whose mutation hooks this change consumes:
- `FacturaFormPage` + `useCreateFactura` (`src/features/facturas/`) — manual POST, payload `{proveedor_id, fecha_emision, monto_total, numero?, fecha_vencimiento?, archivo_url?, items?}`.
- `PagoFormPage` + `useCreatePago` (`src/features/pagos/`) — manual POST, payload `{proveedor_id, monto, fecha, metodo, comprobante_url?}`.

C-07 (`proveedores-frontend`, archived 2026-06-21) shipped the shared `SupplierSearch` component (debounced 300ms, `enabled: query.length >= 2`) and `useCreateProveedor` for the "Crear nuevo proveedor" flow (RN-VINC).

C-04 (`auth-frontend`, archived 2026-06-21) shipped the `apiClient` with `withCredentials: true` and a 401 interceptor that redirects to `/login`. The C-15 mutations reuse this client without modification.

**The gap (this change closes it):**
- No frontend consumes the C-14 endpoints.
- The `FacturaFormPage` and `PagoFormPage` have no IA shortcut.
- The cuenta-corriente view (C-13) shows `origen` per row but no UI to LOAD with origen=IA.

**Cross-cutting gap surfaced during design (see OPEN QUESTION 1 in `proposal.md`):** the C-14 spec asserts that "the `origen=IA` flag is set by the existing manual `POST /api/facturas` / `POST /api/pagos` endpoints when the user confirms the proposal in C-15" — but the C-08/C-10 backend hardcodes `origen=OrigenDocumento.MANUAL` in the service layer (`app/services/factura_service.py:273`, `app/services/pago_service.py:169`) and the Pydantic schemas do not declare an `origen` field (`app/schemas/factura.py:58-76`, `app/schemas/pago.py:35-60`; `PagoCreate` has `extra="forbid"` at `app/schemas/pago.py:54`). C-15 takes Path A (safe default, no `origen` from the client) per the proposal's recommendation.

## Goals / Non-Goals

**Goals:**
- A complete, typed (TS strict, no `any`) IA loading UI exposed as a "Cargar con imagen (IA)" button inside the existing `FacturaFormPage` and `PagoFormPage`.
- A blocking `PropuestaIAModal` with three states (idle / extracting / proposal) that presents the C-14 response and never persists directly (RN-IA-04).
- RN-VINC supplier matching via the existing `SupplierSearch` from C-07, with a NEVER-pre-selected supplier (RN-IA-06).
- Clean handling of 422 / 429 / `error: true` / generic-error responses from the C-14 endpoints.
- Confirm flow that populates the existing form state and lets the user review before clicking the form's own "Confirmar" (the existing `useCreateFactura` / `useCreatePago` does the persist).
- TDD-ready code (Strict TDD: every behavior tested by RED → GREEN → TRIANGULATE).
- A single `formatMonto` helper (already in `src/shared/utils/currency.ts` from C-13) is reused for all monetary display in the modal.

**Non-Goals:**
- Any backend change (C-14 already ships the two endpoints; C-08/C-10 are NOT touched per the user's "no backend code, no schema changes, no new endpoints" constraint).
- Editing or extracting from an EXISTING invoice / payment (the "Cargar con IA" button is hidden in edit mode).
- Items extraction (RN-IA-02: only header is extracted).
- Multi-image / batch upload.
- Sending `origen: 'IA'` from the client (governed by OPEN QUESTION 1, Path A is the default).
- Cloudinary uploads in this change — the image goes to the C-14 endpoint as multipart, the backend handles the vision-provider upload.
- New routes, new home-screen entries, new shared components.
- The `SupplierSearch` normalization logic (already shipped by C-07).

## Decisions

### D-1 — "Cargar con IA" is a button INSIDE the existing form, not a separate page

The "Cargar con imagen (IA)" entry is rendered inside `FacturaFormPage` and `PagoFormPage`, next to the existing "Carga manual" entry. The original CHANGES.md C-15 scope proposed a 3-step separate page (`FacturaIAPage`, `PagoIAPage`); this change **rejects that** and uses an in-form modal for three reasons:

1. **Less surface area.** The existing form already has all the fields, the validation, the Cloudinary file upload (for the manual `archivo_url` / `comprobante_url`), and the cache-invalidation wiring (C-13). A separate page would duplicate all of that.
2. **Less state-management complexity.** The IA flow's output is just pre-filled form values. Routing them through form state (vs. a separate page) keeps the data flow linear and the cache invalidation identical.
3. **Better UX.** The user sees the proposal, confirms, and the form is already pre-filled. They review, edit if needed, and click the form's own "Confirmar" — the same button they would have clicked for a manual load. One mental model, two entry points.

**Visibility rules:**
- **Create mode** (`mode === 'create'`): the button is visible next to the "Carga manual" entry.
- **Edit mode** (`mode === 'edit'`): the button is HIDDEN. The IA flow applies to new documents only (RN-IA-01: the C-14 endpoints expect a photographed invoice / receipt, not a database record).

The button label is "Cargar con imagen (IA)" — explicit about the IA and about the input type (image). A small icon (camera or sparkle) signals IA at a glance.

### D-2 — Extracted proposal is shown in a blocking preview modal

The `PropuestaIAModal` is a controlled, blocking modal. Three states:

| State | Renders | User can |
|---|---|---|
| **idle** | The `ImagenPicker` (drag-and-drop + "Elegir archivo" button). Type/size hint. | Pick an image, cancel |
| **extracting** | Spinner + "Leyendo la imagen…" | Cancel (disabled while the request is in-flight to avoid duplicate uploads) |
| **proposal** | The pre-filled fields, the `SupplierSearch` with the detected name as the initial query, and three actions: "Confirmar", "Reintentar", "Cancelar" | Confirm (fills the form, closes the modal), Retry (resets to idle, re-pick), Cancel (closes, discards proposal) |

**Blocking means:** while the modal is open, the form's "Confirmar" button is NOT clickable (the modal is mounted in the form's render tree and the form is visually behind the modal overlay). The form's fields are NOT editable while the modal is open. This is the only way to enforce the contract that "the user MUST review the proposal before submitting."

**Error sub-states inside the `proposal` state (D-5 covers the API-level errors):**
- 422 (non-image / oversized): the modal shows "Formato no soportado" and reverts to `idle`. No retry from the same file.
- 429 (rate limited): the modal shows a "Demasiadas solicitudes" panel with the `Retry-After` countdown and a "Cancelar" button. The user CAN still cancel and use the manual form (which the modal is BLOCKING, so the user must dismiss the modal first).
- `error: true` envelope: the modal switches to a "No se pudo leer la imagen" panel with the option to "Cargar manualmente" (which dismisses the modal and leaves the form empty) or "Reintentar" (back to `idle`).
- Generic 5xx / network: the modal shows "Algo salió mal" with "Reintentar" and "Cancelar".

**Accessibility:**
- The modal traps focus (Tab cycles within the modal).
- `aria-busy="true"` while extracting.
- `aria-live="polite"` on the status panel (so screen readers announce the state change).
- Close on `Escape` only when the state is `idle` or `proposal` (NOT `extracting` — to prevent losing the in-flight request).

### D-3 — Supplier matching uses the existing `SupplierSearch`; the IA NEVER pre-selects

The `PropuestaIAModal` receives the proposal's `proveedor_nombre: string | null` as a prop. It passes this string to the existing `SupplierSearch` (C-07) as the initial `query` value. The `SupplierSearch`:

- Renders an empty `value` (no chip, no selected supplier) — the user MUST pick, search, or create.
- The detected name is pre-filled in the search INPUT (so the user sees what the IA detected and the autocomplete shows RN-VINC matches).
- The user can:
  1. **Accept an autocomplete suggestion** (which sets the value via `SupplierSearch`'s `onChange`).
  2. **Clear the input and search the full list** (the "Buscar proveedor" path in RN-VINC).
  3. **Create a new supplier on the spot** via the existing `useCreateProveedor` mutation (C-07), then select the newly created supplier.

**Hard rule (RN-IA-06):** the modal never pre-selects a supplier. Even if the detected name is an EXACT normalized match against the user's `Proveedor` list, the modal does NOT auto-pick it. The user is always the one who confirms the match. (This is the C-14 spec's "the IA never assigns a supplier" guarantee carried into the UI as a structural rule.)

**Test:** `PropuestaIAModal.test.tsx` asserts that even with a non-null `propuesta.proveedor_nombre`, the `SupplierSearch` value is `null` until the user interacts with it.

### D-4 — On confirm, the existing manual `POST` is called (with `origen='IA'` flagged as OPEN QUESTION 1)

When the user clicks the modal's "Confirmar" button:

1. The modal calls `onConfirm(propuesta, selectedProveedor)` with the full proposal and the user-picked `Proveedor`.
2. The parent form (`FacturaFormPage` or `PagoFormPage`) receives this callback and sets its local form state:
   - `proveedor` ← `selectedProveedor` (the chip becomes visible).
   - `fecha_emision` (or `fecha`) ← `propuesta.fecha_emision` / `propuesta.fecha` (if non-null).
   - `monto_total` (or `monto`) ← `propuesta.monto_total` / `propuesta.monto` (if non-null).
   - `numero` (facturas only) ← `propuesta.numero` (if non-null).
   - `metodo` (pagos only) ← `propuesta.metodo` (if non-null).
3. The modal closes.
4. The form is now pre-filled. The user reviews, edits, optionally adds a `archivo_url` / `comprobante_url` (Cloudinary), and clicks the form's own "Confirmar".
5. The existing `useCreateFactura` / `useCreatePago` mutation fires the manual POST.

**RN-IA-04 enforcement:** the modal's `onConfirm` does NOT call `useCreateFactura.mutate` or `useCreatePago.mutate` directly. Only the form's submit handler does. A regression test (`PropuestaIAModal.test.tsx` + a new `FacturaFormPage.iaConfirm.test.tsx`) asserts that triggering `onConfirm` in the modal does NOT result in a `POST /api/facturas` or `POST /api/pagos` request.

**`origen='IA'` (OPEN QUESTION 1, Path A):** the C-15 frontend does NOT send `origen` from the client. The manual `POST` payload is the same as the C-09/C-11 manual flow. The backend stamps `origen=MANUAL`. The UI shows an "Cargado con IA" badge next to the form's title for the duration of the current create session (purely visual, not persisted). If the user/orchestrator chooses Path B (backend hotfix) later, the only C-15 change is to add `origen: 'IA'` to the `useCreateFactura` / `useCreatePago` payload — a 1-line change, no UI impact.

### D-5 — Rate limit UI shows the `Retry-After` countdown; extractor error UI shows the manual fallback

The C-14 endpoints return 429 with a `Retry-After` header in seconds. The Axios interceptor does NOT special-case 429 (only 401). The C-15 mutation hook inspects the error response and surfaces it to the modal.

**Rate limit UI (429):**

```
┌────────────────────────────────────────────────────┐
│ Demasiadas solicitudes                             │
│                                                    │
│ Has alcanzado el límite de extracciones con IA     │
│ (10 por hora). Intentá en 14 minutos.              │
│                                                    │
│ [Cancelar]                                         │
└────────────────────────────────────────────────────┘
```

- A countdown shows the remaining seconds (parsed from `Retry-After`), updated every second.
- The countdown is purely informational; the user can click "Cancelar" at any time.
- The modal is BLOCKING, so the user cannot use the manual form until they cancel. (A deliberate UX decision per OPEN QUESTION 2 in the proposal — see design tradeoff below.)
- No retry button (the user has to wait the full window or use the manual form).

**Extractor error UI (`error: true` envelope, HTTP 200):**

```
┌────────────────────────────────────────────────────┐
│ No se pudo leer la imagen                          │
│                                                    │
│ La IA no pudo extraer los datos de esta imagen.    │
│ Podés cargar la factura/pago manualmente.          │
│                                                    │
│ [Cargar manualmente]    [Reintentar con otra foto] │
└────────────────────────────────────────────────────┘
```

- "Cargar manualmente" closes the modal and leaves the form empty. The user fills the form by hand (the standard C-09/C-11 flow).
- "Reintentar con otra foto" returns the modal to `idle`. The user picks a new file.

**422 UI (non-image / oversized):** the modal reverts to `idle` with a small inline error: "Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB." No retry from the same file (the user must pick a different file).

**Generic 5xx / network UI:** "Algo salió mal. Reintentá o cargá manualmente." with a "Reintentar" button (calls the mutation again with the same file) and a "Cargar manualmente" button.

### D-6 — Folder structure mirrors C-09 / C-11 / C-13

```
src/features/ia-vision/
├── api/
│   ├── iaVisionApi.ts            # raw Axios: extraerFacturaIA(file), extraerPagoIA(file)
│   ├── iaVisionHooks.ts          # useExtraerFacturaIA, useExtraerPagoIA, IA_VISION_KEYS
│   └── iaVisionHooks.test.tsx    # MSW tests (success / 422 / 429 / error envelope / 500)
├── components/
│   ├── PropuestaIAModal.tsx      # the blocking modal, three states
│   ├── PropuestaIAModal.test.tsx
│   ├── PropuestaFacturaFields.tsx # presentational field group for factura proposal
│   ├── PropuestaFacturaFields.test.tsx
│   ├── PropuestaPagoFields.tsx    # presentational field group for pago proposal
│   ├── PropuestaPagoFields.test.tsx
│   ├── ImagenPicker.tsx          # image-only input, drag-and-drop, type/size validation
│   └── ImagenPicker.test.tsx
├── hooks/
│   └── usePropuestaIAFlow.ts     # orchestration: idle → extracting → proposal → onConfirm
└── types.ts                       # re-exports from @shared/api/api
```

`PropuestaIAModal` is the public surface. The form pages (`FacturaFormPage`, `PagoFormPage`) import it and pass a small adapter (factura vs pago shape) plus the `onConfirm` callback.

### D-7 — `api.d.ts` extension

```ts
// ── C-15: IA vision proposal types (output-only) ────────────────────────────

export interface PropuestaFactura {
  proveedor_nombre: string | null
  numero: string | null
  fecha_emision: string | null          // ISO date string (YYYY-MM-DD)
  monto_total: number | null            // parsed from JSON Decimal string
  error: boolean
  error_message: string | null
}

export interface PropuestaPago {
  proveedor_nombre: string | null
  monto: number | null                  // parsed from JSON Decimal string
  fecha: string | null                  // ISO date string
  metodo: MetodoPago | null
  error: boolean
  error_message: string | null
}
```

**Hard rules locked in at the type level:**
- No `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`, `updated_at` — the C-14 spec is explicit: "the `origen=IA` flag is NOT set here." A compile-time test (`api.iaVision.test-d.ts`) asserts the structural absence of these fields.
- `metodo: MetodoPago | null` (the C-14 Pydantic normalizes invalid enum values to `None`; the TS type mirrors this).
- Decimals typed as `number` (the API helper parses the Pydantic-v2 string-decimal at the boundary, same pattern as C-13's `parseCuentaCorriente`).
- A runtime-guard test asserts that `PropuestaFactura` and `PropuestaPago` have no `origen` or `factura_id` key (defense in depth for RN-IA-06 and RN-PAG-01).

**No changes to the existing `FacturaCreate` / `PagoCreate` types** (C-09 / C-11 own them). The modal's confirm path uses the existing mutation hooks unchanged.

### D-8 — `useExtraerFacturaIA` / `useExtraerPagoIA` mutation hooks

```ts
export const IA_VISION_KEYS = {
  all: ['ia-vision'] as const,
}

export function useExtraerFacturaIA() {
  return useMutation({
    mutationFn: (file: File) => extraerFacturaIA(file),
    // No retry: 429 / error:true are real answers, not transient
    retry: false,
  })
}

export function useExtraerPagoIA() {
  return useMutation({
    mutationFn: (file: File) => extraerPagoIA(file),
    retry: false,
  })
}
```

**Why no `invalidateQueries`:** these mutations do NOT write to the application cache. The proposal is a transient value held in modal state. When the user confirms, the existing C-09/C-11 mutation fires and the C-13 cache-invalidation chain takes over (cuenta-corriente refresh). No new keys to manage.

**Why no `mutationKey`:** the mutation is one-shot per modal session. No need to track the in-flight state in the cache.

### D-9 — `PropuestaIAModal` state machine

```ts
type ModalState =
  | { kind: 'idle' }
  | { kind: 'extracting' }
  | { kind: 'proposal'; propuesta: PropuestaFactura | PropuestaPago; tipo: 'factura' | 'pago' }
  | { kind: 'error_422'; message: string }
  | { kind: 'error_429'; retryAfterSeconds: number }
  | { kind: 'error_extractor'; message: string }
  | { kind: 'error_generic'; message: string }
```

The state machine is exhaustive (TS `never` check). The reducer transitions:
- `idle` → `extracting` (on file pick)
- `extracting` → `proposal` (on 200 success)
- `extracting` → `error_422` (on 422)
- `extracting` → `error_429` (on 429, parsing `Retry-After` header)
- `extracting` → `error_extractor` (on 200 with `error: true`)
- `extracting` → `error_generic` (on 5xx / network)
- `*` → `idle` (on "Reintentar" / "Cancelar")
- `proposal` → `idle` (on "Confirmar" — calls `onConfirm` then closes)

The reducer is unit-tested for every transition (the 6 error states + the 3 success transitions).

### D-10 — `FacturaFormPage` / `PagoFormPage` extension (additive)

The form page gains:

```tsx
const [iaProposal, setIaProposal] = useState<PropuestaFactura | null>(null)
const [iaModalOpen, setIaModalOpen] = useState(false)

// in JSX (create mode only):
{mode === 'create' && (
  <button type="button" onClick={() => setIaModalOpen(true)}>
    Cargar con imagen (IA)
  </button>
)}

<PropuestaIAModal
  open={iaModalOpen}
  tipo="factura"   // or 'pago'
  onClose={() => setIaModalOpen(false)}
  onConfirm={(propuesta, proveedor) => {
    // fill form state
    setSelectedProveedor(proveedor)
    if (propuesta.fecha_emision) setFechaEmision(propuesta.fecha_emision)
    if (propuesta.monto_total != null) setMontoTotal(propuesta.monto_total)
    if (propuesta.numero) setNumero(propuesta.numero)
    setIaModalOpen(false)
    setIaProposal(propuesta)  // optional: show "Cargado con IA" badge
  }}
/>
```

The form's existing `useCreateFactura` / `useCreatePago` mutation is unchanged. The form's existing submit handler is unchanged. The IA flow only adds a way to pre-fill the form's state.

**Edit mode is untouched:** the conditional `{mode === 'create' && ...}` ensures the button does not render in edit mode.

### D-11 — TDD layering (Strict TDD)

| Layer | Files | Test file pattern |
|---|---|---|
| Unit | `ImagenPicker`, `PropuestaFacturaFields`, `PropuestaPagoFields`, `formatMonto`-equivalent (shared from C-13) | `*.test.tsx` next to the component, plain props, no MSW |
| Component | `PropuestaIAModal` — three states, four error states, supplier matching, confirm/cancel/retry | `PropuestaIAModal.test.tsx` with MSW for the mutation, fixtures for the proposal |
| Hook | `useExtraerFacturaIA`, `useExtraerPagoIA` (success / 422 / 429 / `error: true` / 500) | `iaVisionHooks.test.tsx` with MSW |
| Integration | `FacturaFormPage` + `PagoFormPage` with the modal mounted — verify the confirm flow fills the form, the cancel flow discards, the edit-mode hide rule | `FacturaFormPage.iaConfirm.test.tsx` / `PagoFormPage.iaConfirm.test.tsx` with MSW |

Every task that creates a behavior follows: 0. Safety Net (only for modified files: `FacturaFormPage`, `PagoFormPage`, `api.d.ts`) → 1. Understand → 2. RED → 3. GREEN → 4. TRIANGULATE (≥2 cases per behavior) → 5. REFACTOR → 6. Mark complete. New files don't need Safety Net.

### D-12 — Visual direction

The IA modal is a transient layer over the form. It should feel **lighter** than the form, not heavier — the user is sampling a feature, not committing to a long flow. Decisions:

- **Background:** soft-structuralism, the project's emerging visual language (silver-grey / soft shadow / double-bezel card). The modal sits as a single-bezel card centered on a 40% black overlay.
- **Typography:** same as the form (the project's body font; Inter is banned per the project's high-end rule). A short, friendly headline: "Cargar con imagen (IA)" or "Revisá la propuesta" depending on state.
- **Color tokens:**
  - `idle` state: neutral.
  - `extracting` state: a single accent color (the project's primary) for the spinner.
  - `proposal` state: green confirmation color for the "Confirmar" button; the "Reintentar" / "Cancelar" buttons are secondary.
  - `error_429` state: amber (warning, not error — the user can recover).
  - `error_extractor` / `error_generic` state: muted red (informational, not blocking).
- **Motion:** 200ms ease-out for the modal enter / exit. 300ms ease-in-out for the state transition (idle → extracting → proposal). Respect `prefers-reduced-motion` (no motion, just opacity).
- **Spinner:** a fast-spinning circular spinner (1.2s per rotation) so the user perceives the load as fast (per Emil Kowalski's "perceived performance" rule). The previous state's content fades out (100ms) before the new state fades in (100ms).

The visual direction is documented here so the apply phase does not regress to a generic centered modal. The pattern in `PropuestaIAModal` follows the project's emerging soft-structuralism (mirror of `SaldoBadge` in C-13).

### D-13 — Currency, date, and metodo formatting

Reuse the project's existing helpers:
- `formatMonto(value: number | string): string` from `src/shared/utils/currency.ts` (C-13) — ARS via `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })`.
- `parseFecha(iso: string): Date` from `src/shared/utils/date.ts` (C-09) — the proposal sends `YYYY-MM-DD`; the form's date input already accepts this format.
- `MetodoBadge` from `src/features/pagos/components/MetodoBadge.tsx` (C-11) — for displaying the `metodo` chip in the proposal (the modal shows the badge as a visual hint, not an editable input — the user picks the method from the form's `metodo` select on confirm if the proposal included it).

## Reuse from C-04 / C-07 / C-09 / C-11 / C-13

| Component / Hook | Origin | Reused in C-15 as |
|---|---|---|
| `SupplierSearch` (`src/shared/components/SupplierSearch/SupplierSearch.tsx`) | C-07 | Supplier matching inside `PropuestaIAModal` (D-3) |
| `useCreateProveedor` (`src/features/proveedores/api/...`) | C-07 | "Crear nuevo proveedor" path inside the modal (RN-VINC step 3) |
| `useCreateFactura` (`src/features/facturas/api/facturasHooks.ts`) | C-09 | The actual persist call after the modal's confirm (D-4) — unchanged |
| `useCreatePago` (`src/features/pagos/api/pagosHooks.ts`) | C-11 | Same |
| `FacturaFormPage` (`src/features/facturas/FacturaFormPage.tsx`) | C-09 | Extended additively with the IA button + modal mount (D-10) |
| `PagoFormPage` (`src/features/pagos/PagoFormPage.tsx`) | C-11 | Same |
| `apiClient` + 401 interceptor (`src/shared/api/apiClient.ts`) | C-04 | All C-15 Axios calls (the C-14 endpoints) |
| `formatMonto` (`src/shared/utils/currency.ts`) | C-13 | All monetary display in the modal |
| `parseFecha` (`src/shared/utils/date.ts`) | C-09 | Parsing `fecha_emision` / `fecha` from the proposal |
| `MetodoBadge` (`src/features/pagos/components/MetodoBadge.tsx`) | C-11 | Display the `metodo` chip in the pago proposal |
| `Intl.NumberFormat('es-AR', ...)` ARS | C-09 / C-11 / C-13 | All monetary values |
| TanStack Query + query-key convention | C-04 / C-07 / C-09 / C-11 | `IA_VISION_KEYS.all` |
| `api.d.ts` extension pattern | C-09 / C-11 / C-13 | `PropuestaFactura` / `PropuestaPago` additions (D-7) |
| `useNavigate` / `Link` from `react-router-dom` | C-09 / C-11 | Not used (no new routes) |
| Private routes under `RequireAuthWithBootstrap` | C-04 | Not used (no new routes) |
| MSW + Vitest + RTL test stack | C-04 / C-07 / C-09 / C-11 | All C-15 tests |
| `FacturaDeleteInput` / `PagoDeleteInput` from C-13 | C-13 | Not used (no new delete mutations) |
| C-13 cross-feature cache invalidation (cuenta-corriente on create) | C-13 | Inherited via C-09/C-11 hooks; no new wiring in C-15 |

## Layer interaction

```
FacturaFormPage (existing C-09)
  └─ "Cargar con imagen (IA)" button (NEW, C-15, hidden in edit mode)
        │
        ▼
PropuestaIAModal (NEW, C-15)
  ├─ state: idle / extracting / proposal / error_422 / error_429 / error_extractor / error_generic
  ├─ ImagenPicker
  ├─ useExtraerFacturaIA() / useExtraerPagoIA()  (NEW, C-15)
  │    └─ extraerFacturaIA(file) / extraerPagoIA(file)  (NEW, C-15)
  │         └─ apiClient → POST /api/facturas/extraer-ia | /api/pagos/extraer-ia  (C-14)
  ├─ PropuestaFacturaFields / PropuestaPagoFields  (NEW, C-15)
  └─ SupplierSearch (C-07) — query = propuesta.proveedor_nombre, value = null until user picks
        │
        ▼ onConfirm(propuesta, selectedProveedor)
FacturaFormPage.onIAConfirm
  └─ setSelectedProveedor(selectedProveedor)   // existing form state
  └─ setFechaEmision(propuesta.fecha_emision)  // existing form state
  └─ setMontoTotal(propuesta.monto_total)      // existing form state
  └─ setNumero(propuesta.numero)                // existing form state
  └─ close modal
        │
        ▼ (user reviews, edits, clicks form's Confirmar)
useCreateFactura.mutate(formState)   (EXISTING C-09, unchanged)
  ├─ POST /api/facturas   (C-08)
  └─ invalidateQueries(['cuenta-corriente', 'detail', proveedorId])  (C-13 wiring)
```

State ownership: server state in TanStack Query (the C-15 mutations); local UI state in `useState` (modal state machine + form pre-fill). No new Zustand slice.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `PagoCreate` rejects unknown fields with 422 (`extra="forbid"` at `app/schemas/pago.py:54`). If the IA confirm path sends `origen: 'IA'`, the Pagos flow breaks. | Path A (OPEN QUESTION 1): the IA confirm path does NOT send `origen`. The modal's `onConfirm` sets form state only; the existing C-11 mutation sends the same payload as the manual flow. A test asserts the request body of the POST triggered after the modal's confirm has no `origen` key. If the orchestrator picks Path B, the C-15 change is a 1-line addition to the `useCreateFactura` / `useCreatePago` payload — no UI change. |
| `FacturaCreate` silently ignores unknown fields (Pydantic v2 default `extra="ignore"`). The persisted `origen` becomes `MANUAL` regardless. The IA vs MANUAL distinction is lost. | Documented in the proposal (OPEN QUESTION 1, Path A). The UI shows a "Cargado con IA" badge for the duration of the current create session (purely visual). If the orchestrator picks Path B, the backend hotfix is small (1-line schema + 1-line service per resource). |
| The modal is BLOCKING — the user cannot use the manual form while the modal is open. Some users may want a sidebar. | The blocking choice is justified by UX (the user's intent is clear; non-blocking risks confusion). OPEN QUESTION 2 in the proposal. Decision: ship blocking, gather feedback. |
| `ImagenPicker` accepts any file; the client-side validation is for UX only. The C-14 backend is the validation authority (422 on non-image / oversized). | The modal shows the C-14 422 message verbatim if the user picks a non-image file (it gets past the client-side check, the backend rejects). The test asserts the 422 UI reverts to `idle` and shows the backend's error message. |
| A 429 response might be served from a CDN edge before the per-user rate limit. The C-14 spec already says the rate limit is keyed by `usuario_id`, NOT by IP, so this is a non-issue. | Documented in the proposal (DEPENDENCIES SATISFIED). The 429 UI uses the `Retry-After` header from the C-14 response, not the client's wall clock. |
| The form's "Confirmar" button is hidden behind the modal — the user might think the form is broken. | The modal's overlay is a 40% black tint; the form is visually behind. The modal's title and the headline of the `proposal` state make it clear that the IA flow is in progress. A small note at the bottom of the `proposal` state says "Revisá los datos extraídos y confirmá para completar la carga." |
| `useExtraerFacturaIA` and `useExtraerPagoIA` are nearly identical — risk of code duplication. | A small shared helper `extraerIA(file: File, endpoint: string)` in `iaVisionApi.ts` keeps the two hooks thin (just a wrapper around the helper). Tests cover both endpoints. |
| The modal's state machine has 7 states. Risk of missed transitions. | The reducer is a `switch (action.kind)` with an exhaustive `never` check at the end. The test suite covers all 7 states and 10 transitions. |
| The C-14 spec is a few weeks old and could have edge cases not yet exercised. | The MSW tests cover success / 422 / 429 / `error: true` / 500. The C-14 spec's behavior is the contract; if a future C-14 patch changes a behavior, the C-15 tests will need to be updated. This is a normal forward-coupling. |
| The 429 countdown might be inaccurate if the user's clock drifts from the server's clock. | The `Retry-After` header is in seconds (per the C-14 spec). The countdown is a UX hint, not a security boundary. If the user's clock is off, the worst case is the user clicks "Confirmar" 1 second too early and gets another 429. The modal handles this gracefully (re-enters the 429 state). |
| The `PropuestaIAModal` is mounted in two form pages. If a future contributor changes one form and not the other, the behavior diverges. | Both forms use the same `PropuestaIAModal` with the same props interface. A shared integration test (`PropuestaIAModal.forms.test.tsx`) mounts the modal inside both forms and asserts the same behavior. The test fails if either form diverges. |
| The `ImagenPicker` is a NEW component — the project already has `FileUploadField` from C-09. Why not reuse it? | `FileUploadField` is for Cloudinary uploads (signed preset → Cloudinary URL → stored in the form's `archivo_url`). The IA flow sends the image to the C-14 endpoint, not Cloudinary. The two flows are structurally different (no preset, no URL storage, no on-success callback returning a URL). A small `ImagenPicker` is the right abstraction. Reusing `FileUploadField` would couple the modal to Cloudinary. |

## Migration Plan

1. **Pre-flight (Safety Net)**: re-run the existing Vitest suite to capture a green baseline before any change. Confirm the C-09 / C-11 form tests still pass (they will, because the change is additive).
2. **Types** (task 1): extend `api.d.ts` with `PropuestaFactura` / `PropuestaPago`. Add `api.iaVision.test-d.ts` compile-time guard asserting no `origen` / `factura_id` / `id` / `usuario_id` / `created_at` / `updated_at` keys.
3. **Data layer** (task 2): `iaVisionApi.ts` + `iaVisionHooks.ts` + MSW tests for all 5 response shapes.
4. **Atomic components** (tasks 3-5): `ImagenPicker`, `PropuestaFacturaFields`, `PropuestaPagoFields` — each TDD.
5. **Modal** (task 6): `PropuestaIAModal` — TDD with fixtures, covers the 7 states and 10 transitions.
6. **Form integration** (tasks 7-8): extend `FacturaFormPage` and `PagoFormPage` with the IA button + modal mount + `onConfirm` callback. Each TDD.
7. **End-to-end** (task 9): integration test that mounts the form, opens the modal, picks a file, confirms, and asserts the form is pre-filled and the manual `POST` (on the form's submit) carries the correct payload.
8. **Verification** (task 10): `tsc --noEmit` (strict, zero `any`); `vitest` (all green); `openspec validate`.

Rollback: the change is additive and feature-scoped. Removing the IA button from the form pages and unmounting the modal reverts the surface. The `api.d.ts` extensions are additive (new types do not break existing consumers). The two new hook files are self-contained.

## Open Questions

- **OQ-1 (P0):** Should the backend be hotfixed to accept `origen: 'IA'` from the client (Path B), or should C-15 ship with Path A (no `origen`, IA loads are stamped `MANUAL`)? See `proposal.md` OPEN QUESTION 1 for the full analysis. **Recommend Path A for the C-15 proposal; file C-15a for the backend hotfix if the user wants the distinction persisted.**
- **OQ-2 (P1):** Should the modal be blocking (current design) or non-blocking (sidebar)? See `proposal.md` OPEN QUESTION 2. **Recommend blocking.**
- **OQ-3 (P2):** When the user clicks "Reintentar" in the `error_extractor` state, should the modal remember the previously-picked file? **Decision: NO. The user has to pick again. Reason: the previous file is in the modal's `useState`, but going back to `idle` clears it (defensive — the user might want a different photo).**
- **OQ-4 (P2):** When the `error_429` countdown reaches 0, should the modal auto-retry? **Decision: NO. The user clicks "Reintentar" manually. Reason: silent auto-retry is surprising; the user might have moved on to another task.**
- **OQ-5 (P2):** Should the modal's "Cargar manualmente" button (in `error_extractor` state) be the same as the form's manual entry? **Decision: YES. The button closes the modal; the user fills the form by hand. No new path is needed.**
- **OQ-6 (P2):** If the proposal's `metodo` is `null` (the IA couldn't read it), should the modal block the confirm until the user picks one? **Decision: NO. The modal's `onConfirm` only sets `metodo` if the proposal includes a non-null value. The form's own `metodo` select remains the source of truth — the user MUST pick a method (the form's existing validation enforces this, per the C-11 `pagos-frontend` spec's "missing metodo is rejected" scenario).**
