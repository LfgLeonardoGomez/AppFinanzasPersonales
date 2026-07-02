# Design — C-11 pagos-frontend

## Context

C-10 (`pagos-backend`, archived 2026-06-27) delivers these endpoints (per `openspec/specs/pagos-backend/spec.md` and the live `facturas-proveedores-api/app/routers/pagos.py`):

| Method | Path | Description |
|---|---|---|
| GET | `/api/pagos?proveedor_id&page&page_size` | Paginated list (default 50/page), ordered by `fecha DESC, created_at DESC, id DESC`. `proveedor_id` optional (foreign → 404). |
| POST | `/api/pagos` | Create. Body: `proveedor_id`, `monto` (>0), `fecha` (≤ today UTC-3), `metodo`, `comprobante_url?`. `origen=MANUAL` auto. `extra="forbid"` rejects `factura_id` (RN-PAG-01). Returns 201. |
| GET | `/api/pagos/{id}` | Read one. Foreign/soft-deleted → 404. |
| PATCH | `/api/pagos/{id}` | Update editable: `monto`, `fecha`, `metodo`, `comprobante_url`. **`proveedor_id` is NOT declared** (D7, would corrupt FIFO pool history). All fields optional. |
| DELETE | `/api/pagos/{id}` | Soft delete → 204. |
| GET | `/api/cloudinary/preset-firmado?tipo=comprobante` | Signed Cloudinary preset (PDF/JPG/PNG, ≤10 MB). |

Response shapes (from `app/schemas/pago.py`): `PagoResponse` carries `id`, `usuario_id`, `proveedor_id`, `monto`, `fecha`, `metodo` (enum), `comprobante_url?`, `origen`, `created_at`, `updated_at` — **no `factura_id`**. `PagoListItem` is lean: drops `comprobante_url` and `updated_at`. `PagoListResponse` wraps `{items, total, page, page_size}`. `MetodoPago` enum: `EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO`. `PagoCreate`/`PagoUpdate` use `extra="forbid"`; payload with `factura_id` returns 422.

C-09 (`facturas-frontend`, archived) established the conventions this change MUST follow (per `openspec/changes/archive/2026-06-25-c-09-facturas-frontend/design.md`):

- Feature folders: `src/features/<x>/api/{xApi.ts, xHooks.ts, xHooks.test.tsx}`, `src/features/<x>/components/`, `<X>Page.tsx`, `types.ts`.
- Supplier autocomplete is `SupplierSearch` at `src/shared/components/SupplierSearch/SupplierSearch.tsx` (NOT `ProveedorAutocomplete` — the project file is `SupplierSearch`; the brief's `ProveedorAutocomplete` name does not exist in the current tree, apply must use the actual file). Prop interface: `{ value: Proveedor | null; onChange: (p: Proveedor | null) => void; placeholder?: string; disabled?: boolean }`, debounced 300ms, `enabled: query.length >= 2`.
- `FileUploadField` at `src/features/facturas/components/FileUploadField.tsx` is `tipo`-generic: receives `tipo: string` and calls `useCloudinaryPreset(tipo)`. Reused for comprobantes with `tipo='comprobante'`.
- Types live in `src/shared/api/api.d.ts` and are re-exported from a feature-local `types.ts` for ergonomics. **Current gap (apply must close):** `api.d.ts` does NOT yet have `Pago*` types and `TipoUpload` is still `'avatar'` only — apply extends both.
- Server state in TanStack Query; UI state in local `useState`; no form library. Decimals arrive as JSON numbers typed `number`, formatted with `Intl.NumberFormat` (ARS). Home quick-access actions live inside `HomePage` (currently inlined in `src/app/router.tsx` at lines 23–53; the brief's reference to `src/app/HomePage.tsx` does not match the shipped tree — apply must add the "Cargar pago" action wherever the actual `HomePage` lives, which is the inline one in `router.tsx`).

## Goals / Non-Goals

**Goals:**
- A complete, typed (TS strict, no `any`) payment UI: supplier-scoped list with método badges, create/edit form that structurally cannot accept a `factura_id`, Cloudinary comprobante upload, shared `SupplierSearch` linkage, and a TanStack Query data layer over `/api/pagos`.
- A consistent mirror of C-09's feature structure, hooks pattern and typed-Axios pattern so the two features read identically.
- A persistent, visible reinforcement of RN-PAG-01 in the UI: a note in the form, a `PagoCard` label, and a test that asserts the form payload contains no `factura` key.

**Non-Goals:**
- Any backend change (C-10 already ships the API and the `tipo=comprobante` preset).
- IA-assisted loading (C-14/C-15).
- The cuenta-corriente view, FIFO history, supplier balance display (C-12/C-13).
- Pagination redesign or a shared list abstraction.
- Any new shared component (everything this change needs already exists from C-07/C-09).

## Decisions

### D-C11-1 — Folder structure mirrors C-09 exactly

```
src/features/pagos/
├── api/
│   ├── pagosApi.ts            # raw Axios calls (pure functions)
│   ├── pagosHooks.ts          # TanStack Query hooks
│   └── pagosHooks.test.tsx    # MSW tests for all hooks
├── components/
│   ├── PagosList.tsx          # list rows/cards + metodo badge + delete
│   ├── PagosList.test.tsx
│   ├── PagosFilters.tsx       # SupplierSearch + clear
│   ├── PagosFilters.test.tsx
│   ├── PagoForm.tsx           # create/edit, no factura field, Cloudinary upload, metodo select
│   ├── PagoForm.test.tsx
│   ├── PagoCard.tsx           # single payment card with metodo badge + comprobante link
│   ├── PagoCard.test.tsx
│   └── MetodoBadge.tsx        # metodo chip (icon + color per RN-IA look)
├── PagosPage.tsx              # list route entry
├── PagosPage.test.tsx
├── PagoFormPage.tsx           # create/edit route entry
└── types.ts                   # Pago, PagoListItem, PagoResponse, MetodoPago, PagosFilters, PagoCreate, PagoUpdate
```

Why identical to C-09: zero cognitive switching cost, predictable test layout.

### D-C11-2 — Reuse `SupplierSearch` (do NOT duplicate)

Both `PagosFilters` and `PagoForm` import the existing `src/shared/components/SupplierSearch/SupplierSearch`. The supplier is required in the form, read-only in edit mode (C-10 PATCH cannot change `proveedor_id`). In the filter, selecting a supplier sets `proveedor_id` in search params; clearing it removes the param.

### D-C11-3 — Reuse `FileUploadField` with `tipo='comprobante'`

The C-09 `FileUploadField` already takes a `tipo` prop and calls `useCloudinaryPreset(tipo)`. The C-10 backend already exposes `GET /api/cloudinary/preset-firmado?tipo=comprobante`. **No new upload component.** Only thing to add: `'comprobante'` to the `TipoUpload` literal in `api.d.ts` so the type narrows correctly.

### D-C11-4 — `PagoCard` is a presentational component, no data fetching

Mirrors C-09's row component split: `PagoCard` is the visual card (metodo badge, monto, fecha, comprobante link, edit/delete actions); `PagosList` composes the list. Delete is a confirmation flow owned by `PagosList` (tested there).

### D-C11-5 — RN-PAG-01 enforced at three levels (defense in depth)

1. **Schema layer (backend, already done in C-10)**: `PagoCreate`/`PagoUpdate` use `extra="forbid"`. Wire-level rejection.
2. **TypeScript types (apply)**: `PagoCreate` interface in `api.d.ts` declares only `proveedor_id`, `monto`, `fecha`, `metodo`, `comprobante_url?` — no `factura_id` key. A test asserts this at the type level via a `expectTypeOf`/`satisfies` check.
3. **UI layer (this change)**: the form does NOT render any factura input/select. A persistent info note reads "El pago se asocia al proveedor, no a una factura específica" inside the form, near the supplier field. `PagoCard` shows a small label "Pago al proveedor" so the list view also reinforces it. A test asserts: (a) the form's `onSubmit` payload contains no key with `factura` in its name; (b) the form JSX has no `<input name=...factura>`, `<select ...factura>`, or similar; (c) the note string is present in the rendered DOM.

### D-C11-6 — Form: native controlled state, no library

Same as C-09. Client validations (supplier required, `monto > 0`, `fecha ≤ today UTC-3`, `metodo` required) are UX only. The backend (Pydantic + service layer) is the authority; a 422 is rendered inline on the offending field without losing input.

### D-C11-7 — List filter: only supplier (no estado, no date range in MVP)

A `Pago` has no `estado` (RN-PAG-01 by design — no per-invoice link, so no per-invoice estado to filter on). Date range is not in the C-11 brief and is not needed for the cuenta-corriente use case (the list is supplier-scoped there). A single supplier filter keeps the UI focused and matches the CHANGES.md scope verbatim. Pagos are not paginated in the UI by default — `usePagos(proveedor_id?)` fetches page 1 with the default 50/page size; the supplier filter scopes the request to one supplier whose payment count is small in MVP.

### D-C11-8 — Data layer: hook names per the brief

```
usePagos(proveedor_id?) → useQuery(['pagos','list', {proveedor_id}])
usePago(id)            → useQuery(['pagos','detail', id], enabled: Boolean(id))
useCreatePago          → useMutation → invalidate pagos.all
useUpdatePago          → useMutation → invalidate pagos.all + set detail
useDeletePago          → useMutation → invalidate pagos.all
useCloudinaryPreset('comprobante')  → already shipped in C-09, reused
```

`PagoCreate` mutation only sends `proveedor_id`, `monto`, `fecha`, `metodo`, `comprobante_url` — verified by test.

### D-C11-9 — Routing and home entry

Add to `src/app/router.tsx`:
- `/pagos` → `PagosPage` (list)
- `/pagos/nuevo` → `PagoFormPage` (create)
- `/pagos/:id/editar` → `PagoFormPage` (edit)

All three under the existing `RequireAuthWithBootstrap` guard. The inline `HomePage` in `router.tsx` (lines 23–53) gets a new `<li>` with a link to `/pagos/nuevo` ("Cargar pago") above the existing "Cargar factura" entry. A test asserts the link is present and routes correctly.

### D-C11-10 — `api.d.ts` extension (apply-phase, but designed here)

Add to `src/shared/api/api.d.ts`:
- `MetodoPago = 'EFECTIVO' | 'TRANSFERENCIA' | 'TARJETA' | 'MERCADOPAGO' | 'OTRO'`
- `OrigenDocumento = 'MANUAL' | 'IA'`
- `Pago`, `PagoListItem`, `PagoResponse`, `PagoListResponse`, `PagoCreate`, `PagoUpdate`, `PagosFilters`
- Extend `TipoUpload` to `'avatar' | 'factura' | 'comprobante'` (closes a C-09 gap: `'factura'` was never added)

Decimals typed as `number`. `comprobante_url?: string | null`. No `factura_id` key anywhere.

## Reuse from C-07/C-09

| Component / Hook | Origin | Reused in C-11 as |
|---|---|---|
| `SupplierSearch` (`src/shared/components/SupplierSearch/SupplierSearch.tsx`) | C-07 | Supplier selector in `PagoForm` and `PagosFilters` (read-only in edit) |
| `FileUploadField` (`src/features/facturas/components/FileUploadField.tsx`) | C-09 | Comprobante upload with `tipo='comprobante'` |
| `useCloudinaryPreset` hook | C-09 | `useCloudinaryPreset('comprobante')` |
| `FacturaForm` controlled-state pattern | C-09 | Mirror in `PagoForm` (no items, no sum warning) |
| `apiClient` + 401 interceptor | C-04 | All Axios calls |
| TanStack Query + query-key convention | C-07/C-09 | `PAGO_KEYS` mirrors `FACTURA_KEYS` |
| `api.d.ts` extension pattern | C-09 | Extend with `Pago*` types + `MetodoPago` + `OrigenDocumento` |
| Native controlled-state forms (no library) | C-09 | `PagoForm` |
| URL search params for filter state | C-09 | `PagosPage` |
| `HomePage` quick-access pattern | C-09 | Add "Cargar pago" entry |
| Private routes under `RequireAuthWithBootstrap` | C-04 | All `/pagos/*` routes |
| MSW + Vitest + RTL test stack | C-04/C-07/C-09 | `*.test.tsx` next to every component |

## Layer interaction

```
PagosPage / PagoFormPage
  → PagoForm / PagosList / PagosFilters
      → pagosHooks (TanStack Query)
          → pagosApi (Axios → /api/pagos)
          → useCloudinaryPreset → apiClient → /api/cloudinary/preset-firmado?tipo=comprobante
              → FileUploadField → direct POST to Cloudinary (mocked in MSW)
```

State ownership: server state in TanStack Query; local UI state in `useState` (form fields, modal open, delete confirmation). No new Zustand slice. Mutations invalidate `PAGO_KEYS.all`.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `api.d.ts` does not yet have `Pago*` types or `'comprobante'`/`'factura'` in `TipoUpload` | Apply phase extends the file in the same commit as the data layer (D-C11-10). Documented as a pre-existing C-09 gap, closed here. |
| `HomePage` is inlined in `router.tsx` (not at `src/app/HomePage.tsx` as the brief assumes) | Apply adds the "Cargar pago" link inside the inline `HomePage`; no refactor in this change. Future refactor can extract `HomePage.tsx` if needed. |
| `SupplierSearch` prop name in the brief (`ProveedorAutocomplete`) does not match the shipped file (`SupplierSearch`) | Apply imports the actual file. Documented in this design (D-C11-2). No rename in this change. |
| A future contributor adds a factura selector to `PagoForm` by accident | Test in `PagoForm.test.tsx` asserts (a) no input/select name contains `factura`, (b) the form payload contains no `factura` key, (c) the RN-PAG-01 note is in the rendered DOM. |
| `monto` as JS `number` precision drift | Same as C-09: ARS formatting via `Intl.NumberFormat`; backend re-validates with Pydantic `Decimal`. |
| Upload timing (on-select vs on-submit) | C-09 chose on-select; we mirror it. Failed upload preserves form state and allows save without a file. |
| Pagination absent from the UI (default 50/page, no page controls) | Supplier-scoped lists are small in MVP. C-13 may add a paginated variant. Out of scope here. |

## Migration Plan

1. Extend `api.d.ts` with `Pago*` types + `MetodoPago` + `OrigenDocumento` + `TipoUpload` extension (D-C11-10).
2. `pagosApi.ts` + `pagosHooks.ts` + `pagosHooks.test.tsx` (data layer, MSW).
3. `MetodoBadge` (TDD).
4. `PagoCard` (TDD, no data fetching).
5. `PagoForm` (TDD — RN-PAG-01 absence of factura is asserted by tests).
6. `PagosFilters` + `PagosList` (TDD).
7. `PagosPage` + `PagoFormPage` + router wiring + "Cargar pago" home entry.
8. Typecheck (TS strict, zero `any`) + full Vitest suite green.

Rollback: the feature is additive and route-gated; removing the routes and the home action reverts the surface. No backend impact.

## Open Questions

- **Q-PAG-FE-01 (🟢):** Should the list show a small "Proveedor" line per row, or rely on the supplier filter context? Decision: show the supplier name (read from a tiny map; if absent, fetch). Deferred — C-11 ships with the supplier filter always set, so a row without supplier name never renders. If the user clears the filter, rows already include `proveedor_id` and the page shows "Todos los proveedores" as a header. Out of scope to enrich.
- **Q-PAG-FE-02 (🟢):** Should the `metodo` select use plain text or icons? Decision: text + a small color chip (MetodoBadge pattern). No icon library added; pure Tailwind + unicode/emojis are out of scope. Pure text + color is enough for MVP.
- **Q-PAG-FE-03 (🟢):** Confirm `HomePage` location with the user during apply. Decision pending: inlined in `router.tsx` per current tree; brief's `src/app/HomePage.tsx` reference is stale. Apply handles whichever is current.
