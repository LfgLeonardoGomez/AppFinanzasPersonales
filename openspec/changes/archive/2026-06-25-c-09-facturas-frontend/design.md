# Design — C-09 facturas-frontend

## Context

C-08 (facturas-backend, archived) delivers these endpoints (per `openspec/changes/archive/2026-06-21-c-08-facturas-backend/specs/facturas-api/spec.md`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/facturas` | Paginated list. Query: `proveedor_id` (UUID), `estado` (PENDIENTE\|PARCIAL\|PAGADA), `fecha_desde`, `fecha_hasta`. `estado` is computed in-memory via FIFO and filtered in Python after FIFO (RN-FAC-09) — never a SQL WHERE on estado. |
| POST | `/api/facturas` | Create. `origen=MANUAL` auto. Returns 201 with computed `estado` and `items_sum_mismatch`. |
| GET | `/api/facturas/{id}` | Read one with `estado` + full `items`. Foreign/deleted → 404. |
| PATCH | `/api/facturas/{id}` | Update editable fields: `fecha_emision`, `monto_total`, `numero`, `fecha_vencimiento`, `archivo_url`, `items`. `proveedor_id` NOT changeable. Items replaced atomically. |
| DELETE | `/api/facturas/{id}` | Soft delete → 204. Does not affect payments. |
| GET | `/api/cloudinary/preset-firmado?tipo=factura` | Signed Cloudinary preset for the invoice file. |

Response shapes (from C-08): `FacturaResponse` carries `estado: EstadoFactura`, `items: FacturaItemResponse[]`, and `items_sum_mismatch: boolean`. `FacturaListItem` carries `estado`. `FacturaItem*` fields: `descripcion` (non-empty), `cantidad` (> 0), `precio_unitario` (>= 0). `usuario_id` never appears in request bodies — it is taken from the session cookie. Foreign resources return 404 (never 403). All endpoints require a valid session cookie.

C-07 (proveedores-frontend, archived) established the frontend conventions this change MUST follow (per `openspec/changes/archive/2026-06-21-c-07-proveedores-frontend/design.md`):
- Feature-based folders: `src/features/<x>/api/{xApi.ts, xHooks.ts, xHooks.test.tsx}`, `src/features/<x>/components/`, `<X>Page.tsx`, `types.ts`.
- The supplier autocomplete shipped as **`SupplierSearch`** at `src/shared/components/SupplierSearch/` (NOT `ProveedorAutocomplete` — the CHANGES.md name; the shipped name is `SupplierSearch`). Its prop interface is `{ value: Proveedor | null; onChange: (p: Proveedor | null) => void; placeholder?: string; disabled?: boolean }`, debounced 300ms, `enabled: query.length >= 2`.
- Types live in a manually-extended `api.d.ts` until `generate-types` runs against the live backend. Decimals arrive as JSON numbers and are typed `number`, formatted with `Intl.NumberFormat`, never recomputed on the client.
- Server state in TanStack Query; UI state in local `useState`; no new Zustand slice unless cross-component complexity demands it (YAGNI).
- Native React controlled-state forms (no form library). Private routes under the existing auth guard.

Discrepancy noted: the physical sibling repos (`facturas-proveedores-web`, and the `app/` of `facturas-proveedores-api`) are not present/populated on this machine — only the openspec archives remain. The archived specs are the authoritative contract for this proposal; the apply phase must operate against the actual `facturas-proveedores-web` working tree and re-confirm the real `SupplierSearch` interface and `api.d.ts` shape before writing.

## Goals / Non-Goals

**Goals:**
- A complete, typed (TS strict, no `any`) invoice UI: filterable list with computed-estado badges, create/edit form with dynamic items and single-file Cloudinary upload, supplier linkage via the shared `SupplierSearch`, and the TanStack Query data layer over `/api/facturas`.
- Consistency with the C-07 feature structure, hooks pattern, and typed-Axios pattern so the two features read identically.
- Honor the hard invariants: estado is read from the response (never recomputed), the items-sum warning is non-blocking, supplier linkage reuses `SupplierSearch`.

**Non-Goals:**
- Any backend change (C-08 already ships the API and the `tipo=factura` preset).
- IA-assisted loading (C-15) — manual flow only.
- The cuenta-corriente view, FIFO history, or supplier balance display (C-13).
- Pagination redesign or a shared list abstraction — match C-07's existing pagination approach.

## Decisions

### D-C09-1: Folder structure — mirror C-07

```
src/features/facturas/
├── api/
│   ├── facturasApi.ts            # raw Axios calls (pure functions)
│   ├── facturasHooks.ts          # TanStack Query hooks
│   └── facturasHooks.test.tsx    # MSW tests for all hooks
├── components/
│   ├── FacturasList.tsx          # list rows/cards + estado badges + delete
│   ├── FacturasList.test.tsx
│   ├── FacturasFilters.tsx       # SupplierSearch + estado + date range
│   ├── FacturasFilters.test.tsx
│   ├── FacturaForm.tsx           # create/edit, dynamic items, file upload
│   ├── FacturaForm.test.tsx
│   ├── EstadoBadge.tsx           # PENDIENTE/PARCIAL/PAGADA color badge
│   ├── ItemsEditor.tsx           # dynamic add/remove rows + sum warning
│   └── FileUploadField.tsx       # signed-preset → Cloudinary → archivo_url
├── FacturasPage.tsx              # list route entry
├── FacturasPage.test.tsx
├── FacturaFormPage.tsx           # create/edit route entry
└── types.ts                      # Factura, FacturaItem, estado, filters, create/update
```

`FacturaCard` from the brief maps to a row component within `FacturasList`, matching C-07 where the list owns row rendering. The exact split (table vs cards) follows whatever C-07's `ProveedoresList` chose; apply must match it.

**Why:** identical structure to C-07 means zero cognitive switching cost between features and a predictable test layout.

### D-C09-2: API types — extend `api.d.ts` manually

Add `Factura`, `FacturaListItem` (with `estado`), `FacturaResponse` (with `estado`, `items`, `items_sum_mismatch`), `FacturaItem`, `FacturaItemCreate`, `FacturaCreate`, `FacturaUpdate`, `EstadoFactura` ('PENDIENTE'|'PARCIAL'|'PAGADA'), and a `FacturasFilters` type, alongside the existing C-07 additions. `monto_total`, `cantidad`, `precio_unitario` typed as `number`. When `generate-types` runs against the live backend, these are replaced. **No `any` anywhere.**

### D-C09-3: estado is read-only from the response

`EstadoBadge` takes the `estado` string from the response and maps it to a color: PENDIENTE → orange, PARCIAL → yellow, PAGADA → green (Tailwind classes). The frontend NEVER computes FIFO. The estado filter is passed to the API as the `estado` query parameter (the backend resolves it in Python post-FIFO); the client does not re-derive or post-filter estado itself. This directly enforces RN-FAC-09 and hard rule #1/#5.

### D-C09-4: Filters state in URL search params

`FacturasPage` keeps `proveedor_id`, `estado`, `fecha_desde`, `fecha_hasta` (and `page`) in URL search params via `useSearchParams`, consistent with C-07's D-C07-5. `useFacturas(filters)` derives its query key from these so navigation/back and shareable URLs work, and TanStack caches per filter combination.

### D-C09-5: Reuse `SupplierSearch` (do NOT duplicate)

Both `FacturasFilters` and `FacturaForm` import the existing `src/shared/components/SupplierSearch/`. In the form, supplier is required; on submit we send `proveedor_id = selectedProveedor.id`. In the filter, selecting a supplier sets `proveedor_id` in search params; clearing it removes the param. In edit mode the supplier is read-only because the backend rejects changing `proveedor_id` on PATCH (C-08 spec).

**Alternative considered:** a new lighter autocomplete for filters. Rejected — it would duplicate RN-VINC logic and violate the reuse rule. The existing `SupplierSearch` already supports `disabled` for the read-only edit case.

### D-C09-6: Dynamic items + non-blocking sum warning

`ItemsEditor` manages an array of `{ descripcion, cantidad, precio_unitario }` rows in local state with add/remove. It computes `sum(cantidad * precio_unitario)` and, when it differs from `monto_total`, shows a warning banner. The submit button stays enabled (RN-FAC-04). The authoritative signal remains the backend's `items_sum_mismatch` in the response, which we surface consistently after save. Items are optional — an empty array is a valid payload (omit or send `[]`).

### D-C09-7: File upload flow

`FileUploadField`:
1. On file selection, validate type (PDF/JPG/PNG by extension + MIME) and size (~10 MB) client-side.
2. On submit (or on selection, TBD by UX — see Open Questions), call a `useCloudinaryPreset('factura')` hook → `GET /api/cloudinary/preset-firmado?tipo=factura`.
3. POST the file directly to Cloudinary using the signed preset.
4. Put the returned secure URL into the invoice payload as `archivo_url`.

Single file only (RN-FAC-07) — selecting a new file replaces the prior one. Upload failure shows an inline error, preserves form state, and still allows saving without a file. Cloudinary is mocked in tests (MSW), never hit for real (hard rule #9).

### D-C09-8: Data layer mirrors C-07 hooks

`facturasApi.ts` = pure typed Axios functions (`withCredentials: true` via the shared client). `facturasHooks.ts` = `useFacturas`, `useFactura`, `useCreateFactura`, `useUpdateFactura`, `useDeleteFactura`, `useCloudinaryPreset`. Mutations invalidate query keys: create/delete → list; update → that id + list. Server state lives only in TanStack Query.

### D-C09-9: Routing and home entry

Add `/facturas` (list) and `/facturas/nueva` + `/facturas/:id/editar` (form) under the existing `RequireAuth` guard in `src/app/router.tsx`. Add a "Cargar factura" action on the home screen pointing to `/facturas/nueva` (F-HOME-01) — extend the existing home placeholder without disturbing other quick actions.

### D-C09-10: Form validation strategy — native controlled state

Consistent with C-07 D-C07-9 and C-04 D-C04-7: no form library. Client validations (supplier required, `fecha_emision` not future UTC-3, `monto_total > 0`, item `cantidad > 0`, `precio_unitario >= 0`) are UX aids; the backend (Pydantic) is the authority, and a 422 is rendered inline on the offending field without losing input (hard rule: never trust frontend validation alone).

## Risks / Trade-offs

- **`SupplierSearch` real interface drift** → The shipped prop interface may differ slightly from the archived design. Mitigation: apply phase reads the actual `src/shared/components/SupplierSearch/` before wiring it and adapts.
- **estado filtering temptation** → A developer might filter estado client-side for "snappiness". Mitigation: spec + EstadoBadge contract keep estado read-only; the only estado filtering is the supported API query param resolved server-side post-FIFO.
- **Decimal precision** → `monto_total` and item math as JS `number` can drift on the sum comparison. Mitigation: the sum warning is advisory only (non-blocking) and the backend `items_sum_mismatch` is authoritative; compare with a small epsilon for the client banner.
- **Cloudinary upload coupling** → If preset fetch or upload fails, the invoice save must not be blocked. Mitigation: D-C09-7 decouples upload from save; failure is recoverable.
- **`fecha_emision` "not future" timezone** → Client must evaluate "today" in UTC-3 (America/Argentina/Buenos_Aires), not the browser locale, to match the backend. Mitigation: compute the UTC-3 wall-clock date for the client-side check; the backend re-validates regardless.

## Migration Plan

1. Extend `api.d.ts` with the Factura types (D-C09-2).
2. `facturasApi.ts` + `facturasHooks.ts` — data layer with MSW tests (TDD).
3. `EstadoBadge` (TDD).
4. `ItemsEditor` with non-blocking sum warning (TDD).
5. `FileUploadField` with mocked preset + Cloudinary (TDD).
6. `FacturaForm` wiring SupplierSearch + items + upload (TDD).
7. `FacturasFilters` + `FacturasList` (TDD).
8. `FacturasPage` + `FacturaFormPage` + router integration + home "Cargar factura".
9. Typecheck (strict, no `any`) + lint + full test run.

Rollback: the feature is additive and route-gated; removing the routes and the home action reverts the surface with no backend impact.

## Open Questions

- **Upload timing**: upload to Cloudinary on file-selection (URL ready before submit) vs. on submit (no orphan uploads if the user cancels). Leaning on-submit to avoid orphan assets; confirm with the C-07/C-05 avatar-upload pattern during apply.
- **List presentation**: cards vs. table — match whatever `ProveedoresList` shipped in C-07 for visual consistency; confirm during apply.
- **Pagination**: reuse C-07's pagination component/params as-is; confirm the shared component exists before building.
