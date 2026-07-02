# Proposal: c-15-ia-vision-frontend

## Why

C-14 (`ia-vision-backend`, archived 2026-06-27) ships the two `POST /api/facturas/extraer-ia` and `POST /api/pagos/extraer-ia` endpoints (per `openspec/specs/ia-vision-backend/spec.md`). They return a `PropuestaFactura` / `PropuestaPago` envelope with all-nullable fields, never persist anything (RN-IA-04), never assign a supplier (RN-IA-03/06), and are rate-limited to 10 req/hour per `usuario_id` with a 429 + `Retry-After` for the 11th request. **The backend is ready, but no UI exposes it.** The manual carga flow (C-09 for facturas, C-11 for pagos) is the only way users can register documents today. C-15 closes the IA loop by adding a "Cargar con imagen (IA)" shortcut inside the existing `FacturaFormPage` and `PagoFormPage`, presenting the extracted proposal in a preview modal, applying RN-VINC supplier matching, and finally calling the existing manual `POST /api/facturas` / `POST /api/pagos` to persist — reusing the C-09/C-11 mutation hooks (no new mutation, no new endpoint).

## What Changes

- New `ia-vision` feature in `facturas-proveedores-web/`, mirroring the C-09/C-11 folder shape: `src/features/ia-vision/{api/, components/, PropuestaIAModal.tsx, hooks/}`.
- **Two `useExtraerXxxIA` mutations** (TanStack Query): `useExtraerFacturaIA` and `useExtraerPagoIA`, both posting `multipart/form-data` with a single `file` part to the C-14 endpoints. Same pattern as `useCreateFactura` / `useCreatePago` (typed Axios + TanStack Query, with `onSuccess` / `onError` for branching on the `error: true` envelope vs. network errors).
- **`PropuestaIAModal`** — a controlled, blocking modal opened from the existing form, with three internal states: (1) **idle** (image picker, "Cargar imagen" + drag-and-drop), (2) **extracting** (spinner, disables close while in-flight), (3) **proposal** (form pre-filled from the proposal, supplier matching via the shared `SupplierSearch`, "Confirmar" / "Reintentar" / "Cancelar"). The modal **blocks** form submission while open (the form's submit button is hidden behind it) — the user MUST either confirm (which fills the form and closes the modal) or reject (which discards the proposal and closes the modal).
- **`SupplierSearch` integration** — the modal receives the proposal's `proveedor_nombre` as a string (NEVER as a pre-selected supplier, per RN-IA-06). The modal pre-fills the `SupplierSearch` query with the detected name so RN-VINC suggests matches; the user picks one (existing `Proveedor`), searches the full list, or creates a new supplier via the existing `useCreateProveedor` mutation (C-07). The IA never pre-selects.
- **`"Cargar con imagen (IA)"` button** added to the `FacturaFormPage` and `PagoFormPage` (C-09/C-11 components, additive change). Sits next to the existing "Carga manual" entry. Clicking it opens the modal scoped to the current form type. The button is hidden in edit mode (IA only applies to NEW documents — never to existing records).
- **Error and rate-limit UI**:
  - 422 (non-image / oversized) → "Formato no soportado. Solo se aceptan imágenes JPG, PNG o WebP de hasta 10 MB." No retry.
  - 429 (rate limited) → reads `Retry-After` (seconds) from the response headers, shows "Demasiadas solicitudes. Intentá en X minutos." with a countdown. No retry; manual entry is still available.
  - `error: true` envelope (RN-IA-05) → "No se pudo leer la imagen. Cargá los datos manualmente." The modal switches to an empty form so the user can complete the load manually.
  - 401 → handled by the global Axios interceptor (C-04), modal closes.
  - Other errors → "Algo salió mal. Reintentá o cargá manualmente." with a "Reintentar" button.
- **Confirm → manual POST with `origen='IA'`** — D-4 in `design.md`. The confirmed proposal populates the form, the user reviews / edits, and the existing `useCreateFactura` / `useCreatePago` mutations do the persist call. The modal closes; the form is the existing one; the user clicks the form's "Confirmar" to persist. **No new mutation, no new endpoint.**
- **Tests** (Vitest + RTL + MSW): modal idle/extracting/proposal states, supplier matching flow, 422/429/error-envelope UI, confirm fills the form, cancel discards, "Cargar con IA" button hidden in edit mode, no persistence happens until the user clicks the form's Confirmar (the form's mutation never fires from the modal directly).

## Capabilities

### New Capabilities

- `ia-vision-frontend`: The web interface for IA-assisted invoice and payment loading. Exposes the two C-14 `extraer-ia` endpoints via a "Cargar con imagen (IA)" button inside the existing `FacturaFormPage` and `PagoFormPage`; presents the proposal in a blocking `PropuestaIAModal` with RN-VINC supplier matching via the shared `SupplierSearch`; handles 422 / 429 / `error: true` / generic-error UI; on confirm, fills the existing form and lets the user review and persist via the existing C-09 / C-11 mutation hooks. Enforces RN-IA-04 (no persistence from the modal itself, only via the existing manual POST on the form's confirm), RN-IA-05 (graceful UI on extractor failure), RN-IA-06 (the modal never pre-selects a supplier; it only passes the detected name as a string to `SupplierSearch`).

### Modified Capabilities

- `facturas-frontend`: the existing `FacturaFormPage` (C-09) gains an additive "Cargar con imagen (IA)" button next to the manual entry, hidden in edit mode, that opens `PropuestaIAModal` scoped to the invoice flow. The form's `proveedor` field becomes pre-fillable by the modal's confirm action (an additive, optional prop). **No existing `facturas-frontend` REQUIREMENT changes; a single ADDED requirement documents the IA shortcut.** Delta spec at `specs/facturas-frontend/spec.md`.
- `pagos-frontend`: same — `PagoFormPage` (C-11) gains the same additive "Cargar con imagen (IA)" button. The form's `proveedor` field becomes pre-fillable by the modal's confirm action. **No existing `pagos-frontend` REQUIREMENT changes; a single ADDED requirement documents the IA shortcut.** Delta spec at `specs/pagos-frontend/spec.md`.

## Impact

- **Repo**: `facturas-proveedores-web/` (frontend). No `facturas-proveedores-api/` edit. No schema, no endpoint, no dependency change.
- **New code** (paths under `src/features/ia-vision/`):
  - `api/iaVisionApi.ts` — typed Axios: `extraerFacturaIA(file: File): Promise<PropuestaFactura>` and `extraerPagoIA(file: File): Promise<PropuestaPago>` (multipart upload).
  - `api/iaVisionHooks.ts` — `useExtraerFacturaIA`, `useExtraerPagoIA` mutations, `IA_VISION_KEYS`.
  - `api/iaVisionHooks.test.tsx` — MSW tests (success / 422 / 429 / `error: true` envelope / generic 500).
  - `components/PropuestaIAModal.tsx` (+ test) — the blocking modal, three states (idle / extracting / proposal), supplier matching, error/rate-limit UI.
  - `components/PropuestaFacturaFields.tsx` (+ test) — presentational field group for the factura proposal (`numero`, `fecha_emision`, `monto_total`).
  - `components/PropuestaPagoFields.tsx` (+ test) — presentational field group for the pago proposal (`monto`, `fecha`, `metodo`).
  - `components/ImagenPicker.tsx` (+ test) — image-only input with drag-and-drop, client-side type/size validation for UX, accessible label.
  - `types.ts` — re-exports from `@shared/api/api`.
- **Modified code** (additive, low-risk):
  - `src/shared/api/api.d.ts` — add `PropuestaFactura` and `PropuestaPago` TS types mirroring the C-14 Pydantic shapes (decimals as `number`, all fields optional). NO new fields beyond what the backend returns. NO `origen` field (see OPEN QUESTION 1).
  - `src/features/facturas/FacturaFormPage.tsx` — render the "Cargar con imagen (IA)" button next to the manual entry; add a `prefillFromProposal?: PropuestaFactura` prop (or a controlled state) so the modal can pre-fill the form on confirm. Hidden in edit mode.
  - `src/features/pagos/PagoFormPage.tsx` — same pattern.
  - `src/app/router.tsx` — no route change (the modal is mounted by the form, not the router).
- **Reused code** (full list in `design.md`): `SupplierSearch` (C-07), `useCreateProveedor` (C-07), `useCreateFactura` / `useCreatePago` (C-09/C-11), `apiClient` + 401 interceptor (C-04), `Intl.NumberFormat('es-AR', ...)` ARS formatting (C-09/C-11), `getTodayUTC3()` (C-09), TanStack Query + query-key convention (C-07/C-09/C-11), MSW + Vitest + RTL test stack (C-04/C-09/C-11), the `api.d.ts` extension pattern (C-09/C-11).
- **Dependencies**: C-04 (auth-frontend) for the Axios client + 401 interceptor; C-07 (proveedores-frontend) for `SupplierSearch` and `useCreateProveedor`; C-08 (facturas-backend) for the `POST /api/facturas` endpoint that the modal's confirm path uses; C-09 (facturas-frontend) for `FacturaFormPage` + `useCreateFactura`; C-10 (pagos-backend) for `POST /api/pagos`; C-11 (pagos-frontend) for `PagoFormPage` + `useCreatePago`; C-14 (ia-vision-backend) for the two `extraer-ia` endpoints. **No new npm dependencies.**
- **Governance**: MEDIO. The hard rules are RN-IA-04 (no persistence from the modal — only from the existing manual POST on the form's confirm) and RN-IA-06 (never pre-select a supplier). The apply phase must verify by integration test that the modal's confirm action never fires `useCreateFactura` / `useCreatePago` directly — it only sets form state.

## OPEN QUESTION 1 (P0 — must resolve before apply)

The C-14 spec (`openspec/specs/ia-vision-backend/spec.md:5`, full sentence) states:

> The `origen=IA` flag is NOT set here — it is set by the existing manual `POST /api/facturas` / `POST /api/pagos` endpoints when the user confirms the proposal in C-15.

**This contract is NOT implemented in the current backend.** Verified in code:
- `facturas-proveedores-api/app/services/factura_service.py:273` hardcodes `origen=OrigenDocumento.MANUAL` inside `FacturaService.crear()`. The `FacturaCreate` Pydantic schema (`app/schemas/factura.py:58-76`) does NOT declare an `origen` field.
- `facturas-proveedores-api/app/services/pago_service.py:169` does the same for `PagoService.crear()`. `PagoCreate` (`app/schemas/pago.py:35-60`) does NOT declare `origen` and has `model_config = ConfigDict(extra="forbid")` at line 54.

**Consequences for the C-15 frontend:**
- If the IA confirm path sends `origen: 'IA'` on `PagoCreate`, the backend returns 422 (`extra="forbid"` rejects unknown fields). The C-15 flow would break for pagos.
- If the IA confirm path sends `origen: 'IA'` on `FacturaCreate`, Pydantic v2's default is `extra="ignore"` (the schema does not declare `extra="forbid"`), so the field is silently dropped. The persisted `origen` becomes `MANUAL` regardless. The IA vs MANUAL distinction is lost in the DB.

**Resolution paths (orchestrator / user to decide before apply):**

- **Path A — SAFE DEFAULT (recommended for this C-15 proposal):** The IA confirm path uses the existing C-09/C-11 manual mutation hooks WITHOUT sending `origen`. The persisted record is `origen=MANUAL` for IA-loaded documents too. The IA confirmation banner in the UI is purely a UX signal. **Cost:** the `origen=IA` distinction is lost; analytics / future filters that group by `origen` will mix IA and manual loads. **No defect, no broken flow.**
- **Path B — BACKEND HOTFIX BEFORE APPLY:** A 1-line change in each of `FacturaCreate` / `PagoCreate` (add `origen: Optional[OrigenDocumento] = None`), `PagoCreate.model_config` from `extra="forbid"` to `extra="ignore"`, and the two services to use `datos.origen or OrigenDocumento.MANUAL`. Then C-15 sends `origen: 'IA'` correctly. **Cost:** requires a separate small backend change (forbidden in the C-15 spec per "No backend code, no schema changes, no new endpoints."). Recommend filing as `c-15a-origen-ia-backend` and applying it before c-15.
- **Path C — DEFERRING:** Ship C-15 with Path A. File the gap as a known issue; decide later whether to backfill `origen=IA` retroactively via a one-off migration.

**✅ OQ-1 RESOLVED — Path B is in effect (c-15a archived 2026-06-28).** `c-15a-origen-ia-backend` added `origen: Optional[OrigenDocumento] = None` to `FacturaCreate` (line 77) and `PagoCreate` (line 61), and updated the services to use `datos.origen or OrigenDocumento.MANUAL` (`factura_service.py:273`, `pago_service.py:169`). `PagoCreate.model_config = ConfigDict(extra="forbid")` is preserved (RN-PAG-01 enforcement unchanged) — `origen` is now a known optional field. **The C-15 frontend sends `origen: 'IA'` from the client on the post-confirm `POST /api/facturas` / `POST /api/pagos` call.** The IA vs manual distinction IS persisted. All artifacts below reflect Path B; the OQ-1 discussion is preserved above as historical context.

## OPEN QUESTION 2 (P1 — UX decision)

The modal is **blocking** (the form's submit button is behind it). Some users may prefer a **non-blocking** approach (a sidebar that doesn't prevent manual entry). This proposal picks blocking because:
- The user's intent is clear (they just clicked "Cargar con IA"), so blocking matches the flow.
- Non-blocking risks confusion: the user uploads an image, sees the proposal in a sidebar, then forgets and clicks "Confirmar" on the form with empty fields.

Recommend: ship blocking, gather feedback, revisit if it bothers users.

## Out of scope

- Any backend change (C-14 already ships the two endpoints).
- Editing or extracting from an EXISTING invoice / payment. The "Cargar con IA" button is **hidden in edit mode** (RN-IA-01 applies to new documents only).
- Items extraction for invoices (RN-IA-02: only header is extracted; items remain manual).
- Multi-image / batch upload.
- Editing the extracted proposal BEYOND supplier matching + field override (the modal exposes all detected fields as editable inputs, but no advanced transforms).
- `origen=IA` field on the persisted record (governed by OPEN QUESTION 1, Path A is the default).
- The cuenta-corriente view (C-13 already ships it; the modal's confirm reuses the C-09/C-11 mutation hooks, which already invalidate the cuenta-corriente cache per C-13).
- New shared components, new npm dependencies, new routes, new router entries, new home-screen entries.
- The `SupplierSearch` normalization logic (already shipped by C-07; the modal only passes the detected name as the initial query).
- Any change to `facturas-proveedores-api/`.

## Dependencies satisfied

- C-04 (auth-frontend, archived 2026-06-21) — `apiClient` + 401 interceptor reused.
- C-07 (proveedores-frontend, archived 2026-06-21) — `SupplierSearch` and `useCreateProveedor` reused for RN-VINC.
- C-08 (facturas-backend, archived 2026-06-21) — `POST /api/facturas` endpoint consumed by the modal's confirm path (via the existing `useCreateFactura`).
- C-09 (facturas-frontend, archived 2026-06-25) — `FacturaFormPage` and `useCreateFactura` reused; the form is extended additively.
- C-10 (pagos-backend, archived 2026-06-27) — `POST /api/pagos` endpoint consumed by the modal's confirm path.
- C-11 (pagos-frontend, archived 2026-06-27) — `PagoFormPage` and `useCreatePago` reused; the form is extended additively.
- C-13 (cuenta-corriente-frontend, archived 2026-06-27) — the `useCreateFactura` / `useCreatePago` hooks already invalidate the cuenta-corriente cache, so a successful IA confirm naturally refreshes the cuenta-corriente view (no extra wiring in C-15).
- C-14 (ia-vision-backend, archived 2026-06-27) — the two `extraer-ia` endpoints consumed by the modal.

## Patterns mirrored (archive references)

- `openspec/changes/archive/2026-06-27-c-14-ia-vision-backend/` — `PropuestaFactura` / `PropuestaPago` shapes, error envelope, rate-limit contract.
- `openspec/changes/archive/2026-06-27-c-13-cuenta-corriente-frontend/` — feature folder structure, `api.d.ts` extension pattern, cache-invalidation pattern (already inherited by the C-09/C-11 hooks; C-15 does not need new invalidations).
- `openspec/changes/archive/2026-06-27-c-11-pagos-frontend/` — `PagoFormPage` + form pre-fill pattern, `Intl.NumberFormat` ARS, `MetodoBadge` reuse.
- `openspec/changes/archive/2026-06-25-c-09-facturas-frontend/` — `FacturaFormPage` + form pre-fill pattern, `EstadoBadge` (not used here), `FileUploadField` (not used here — image picker is custom for IA).
- `openspec/changes/archive/2026-06-21-c-07-proveedores-frontend/` — `SupplierSearch` + `useCreateProveedor` reused for RN-VINC.

## Hard rules (non-negotiable)

1. **NEVER** persist from the modal itself. The modal's confirm action only sets form state; the actual `POST /api/facturas` / `POST /api/pagos` is fired by the existing C-09/C-11 mutation hook when the user clicks the form's own "Confirmar" (RN-IA-04). A regression test asserts that triggering the modal's "Confirmar" does NOT call `useCreateFactura.mutate` or `useCreatePago.mutate` directly.
2. **NEVER** pre-select a `Proveedor` from the proposal (RN-IA-06). The modal only passes the detected `proveedor_nombre` as a string to the `SupplierSearch` query. A regression test asserts that the modal renders an empty `SupplierSearch` (no chip, no selected value) even when the proposal includes a non-null `proveedor_nombre`.
3. **NEVER** invent a field value the proposal did not return (RN-IA-03). The modal's pre-filled form inputs are empty for every null field in the proposal. A test asserts the inputs are empty when the corresponding proposal field is null.
4. **NEVER** accept a non-image file (RN-IA-01, mirrored from C-14). The `ImagenPicker` validates type and size client-side for UX; the backend re-validates and returns 422 on rejection. The modal's "Cargar imagen" button is disabled while the in-flight extraction runs.
5. **NEVER** retry on 429 (C-14 rate-limit contract). The modal shows the `Retry-After` countdown and stays open; the user can cancel and use the manual form, or wait and retry. No silent retry.
6. **NEVER** retry on `error: true` (RN-IA-05). The modal switches to an empty form so the user can complete the load manually. A "Reintentar" button is offered only for generic errors (5xx / network), not for 422 or `error: true`.
7. **NEVER** send `origen` from the client (OPEN QUESTION 1, Path A). The IA confirm path uses the same payload shape as the C-09/C-11 manual flow. A test asserts the request body of the manual `POST` triggered after the modal's confirm has no `origen` key.
8. **TS strict, no `any`** — types come from `@shared/api/api` (extended in apply). Decimals arrive as `number`, formatted with `Intl.NumberFormat('es-AR', ...)`. Mirrors C-09/C-11.
9. **Cloudinary NOT used in this change.** The image is sent to the C-14 endpoints as a multipart file; the C-14 backend uploads it to the vision provider's API. The frontend never sees Cloudinary. The existing `FileUploadField` (C-09) is NOT reused — IA uploads are a different flow (no signed preset, no Cloudinary round-trip).
10. **Multi-tenant isolation**: the `usuario_id` is implicit in the auth cookie; the C-14 endpoints are filtered by the session user on the backend. Cross-tenant access is impossible by construction.
