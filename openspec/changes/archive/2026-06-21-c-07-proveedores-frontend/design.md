# Design — C-07 proveedores-frontend

## Context

C-06 backend delivers these endpoints (per `openspec/specs/proveedores-api/spec.md`):

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/proveedores` | Paginated list with on-demand `saldo`. Params: `page`, `order_by` (`nombre`\|`saldo`) |
| POST | `/api/proveedores` | Create supplier |
| GET | `/api/proveedores/{id}` | Read single supplier with `saldo` |
| PATCH | `/api/proveedores/{id}` | Update supplier |
| DELETE | `/api/proveedores/{id}` | Soft delete. Response: `{ tiene_dependencias: boolean }` |
| GET | `/api/proveedores/buscar?nombre=` | Name search for linkage (RN-VINC) |

All endpoints require a valid session cookie. Foreign resources return 404 (never 403).

## Decisions

### D-C07-1: Folder structure — feature-based

```
src/features/proveedores/
├── api/
│   ├── proveedoresApi.ts          # raw Axios calls (pure functions)
│   ├── proveedoresHooks.ts        # TanStack Query hooks
│   └── proveedoresHooks.test.tsx  # MSW tests for all hooks
├── components/
│   ├── ProveedoresList.tsx        # list table/cards + sort/pagination
│   ├── ProveedoresList.test.tsx
│   ├── ProveedorForm.tsx          # create/edit form (modal)
│   ├── ProveedorForm.test.tsx
│   ├── DeleteProveedorDialog.tsx  # confirmation dialog (RN-PROV-04)
│   └── DeleteProveedorDialog.test.tsx
├── ProveedoresPage.tsx            # route entry point
├── ProveedoresPage.test.tsx
└── types.ts                       # Proveedor, ProveedorCreate, ProveedorUpdate, Categoria
```

`SupplierSearch` (autocomplete for linkage) lives in `src/shared/components/SupplierSearch/` because it will be reused by C-09 (invoices) and C-11 (payments).

### D-C07-2: API types — manual extension of api.d.ts

`api.d.ts` is the OpenAPI-generated types file. Since the backend is not running, we extend it manually with `Proveedor`, `ProveedorCreate`, `ProveedorUpdate`, `ProveedorListItem` (with `saldo`), `ProveedorDeleteResponse` (`tiene_dependencias`), and `PaginatedResponse<T>`. When `generate-types` runs against the live backend, these declarations will be replaced.

`saldo` is typed as `number` (decimal from backend arrives as JSON number). It is NEVER computed on the frontend; it is always read from the API response.

### D-C07-3: State management — TanStack Query for server state, no additional Zustand slice

Server state (supplier list, single supplier, search results) belongs in TanStack Query. No Zustand slice for supplier data.

UI state (is the create modal open, which supplier is being edited) is local component state (`useState`). If cross-component modal state becomes complex in future changes, add a Zustand slice then — YAGNI for now.

### D-C07-4: Delete flow — two-step optimistic approach

1. User clicks "Eliminar" on a supplier.
2. Frontend calls `DELETE /api/proveedores/{id}`.
3. Response arrives with `tiene_dependencias: boolean`.
   - `false` → deletion is done (204 / 200). Invalidate the list query. Show success feedback.
   - `true` → show confirmation modal: "Este proveedor tiene facturas o pagos asociados. ¿Confirmar eliminación?" with a "Confirmar" and "Cancelar" button.
4. If user confirms → call `DELETE /api/proveedores/{id}` again (the backend deletes regardless). Invalidate.
5. If user cancels → nothing changes.

**Why not pre-fetch dependencies first?** The backend already checks and reports `tiene_dependencias` in the same delete response. This avoids an extra round-trip and keeps the UI flow minimal.

### D-C07-5: Pagination and sorting

The list page maintains `page` and `order_by` in URL search params (`useSearchParams` from react-router-dom). This makes the list URL shareable and back-navigation friendly.

Defaults: `page=1`, `order_by=nombre`.

### D-C07-6: Supplier name autocomplete (SupplierSearch)

Component interface:
```tsx
interface SupplierSearchProps {
  value: Proveedor | null
  onChange: (proveedor: Proveedor | null) => void
  placeholder?: string
  disabled?: boolean
}
```

Uses a `useQuery` with `enabled: query.length >= 2` to call `GET /api/proveedores/buscar?nombre=<query>`. Debounced 300ms to avoid request storms. Shows a dropdown with the results. Allows clearing. Shows "Crear nuevo" link (opens `ProveedorForm` in create mode).

### D-C07-7: CUIT validation — backend is the authority

The form field for `cuit` shows a helper hint `XX-XXXXXXXX-X`. Client-side format validation is added as UX feedback only (regex `^\d{2}-\d{8}-\d{1}$`). The backend (Pydantic) is the final authority. A backend 422 with cuit validation error is rendered in the form.

### D-C07-8: Route integration

Add `/proveedores` to `src/app/router.tsx` under `RequireAuthWithBootstrap`. The current placeholder `HomePage` stays unchanged for now. The proveedores route is a private route.

### D-C07-9: Form validation strategy — native React controlled state

Consistent with C-04 (D-C04-7). No new form library. `nombre` is required (non-empty string). `cuit`, `telefono`, `notas` are optional. `categoria` is a select with enum values.

## Risk

- `saldo` arrives as a decimal string or number from the backend. Format it with `Intl.NumberFormat` for display. Never compute it from invoice/payment data in the frontend.
- `tiene_dependencias` drives the delete confirmation. If the backend returns 404 (concurrent delete by another session), the frontend handles it gracefully and invalidates the cache.

## Migration Plan

1. Extend `api.d.ts` with Proveedor types.
2. `proveedoresApi.ts` + `proveedoresHooks.ts` — data layer (TDD).
3. `ProveedoresList` component (TDD).
4. `ProveedorForm` component — create/edit (TDD).
5. `DeleteProveedorDialog` — confirmation (TDD).
6. `SupplierSearch` shared component (TDD).
7. `ProveedoresPage` + router integration.
8. Typecheck + lint + full test run.
