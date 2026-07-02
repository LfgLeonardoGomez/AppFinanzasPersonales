# Proposal — C-07 proveedores-frontend

## What & Why

C-06 (`proveedores-backend`, archived) delivered a complete REST API for supplier management. This change builds the frontend feature (`src/features/proveedores/`) that consumes it.

Suppliers are the root of the business domain: every invoice and payment hangs off a `proveedor_id`. Without a UI to manage them, the app cannot be used.

## Scope

Frontend-only. No backend changes. Target repo: `facturas-proveedores-web`.

### In scope

- **Supplier list page** (`/proveedores`): paginated, sortable by `nombre` or `saldo`, shows computed balance per supplier. Balance comes from the backend; never computed on the frontend.
- **Create/edit supplier form** (modal or page): `nombre` (required), `cuit` (optional, format XX-XXXXXXXX-X enforced by backend), `telefono`, `categoria` (enum: SERVICIO/OTRO), `notas`.
- **Delete with confirmation modal**: if `tiene_dependencias=true` in the delete response, show explicit confirmation before the actual delete request. Soft delete is invisible to the user (row disappears).
- **Supplier name search autocomplete** (`GET /api/proveedores/buscar?nombre=`): shared component for supplier linkage (RN-VINC), to be reused in invoice and payment forms.
- **TanStack Query hooks** for all five endpoints (`list`, `getOne`, `create`, `update`, `delete`, `buscar`).
- **Zustand slice** (if needed for UI-only state like selected supplier, open modal) — session state stays in `authStore`.
- **MSW mocks** for all six endpoints. All tests are offline (no real backend).
- **Strict TDD**: Vitest + React Testing Library + MSW. RED before GREEN.

### Out of scope

- Invoice or payment CRUD (C-08+).
- Supplier detail/account statement page (C-12/C-13 cuenta corriente).
- AI-assisted load (C-14/C-15).
- Backend changes (C-06 already done).

## Dependencies satisfied

- C-04 auth-frontend (archived): `authStore`, Axios client with `withCredentials`, `RequireAuth`, `navigateToLogin`. **Reuse all — do not reinvent.**
- C-06 proveedores-backend (archived): API contract in `openspec/specs/proveedores-api/spec.md`.

## Hard rules inherited

- NEVER store tokens in `localStorage`. Auth via `HttpOnly` cookie only.
- TS strict, no `any`, PascalCase components.
- Saldo comes from backend — never compute totals on the frontend.
- Delete with `tiene_dependencias=true` → confirmation modal (RN-PROV-04).
- Autocomplete search is normalized by the backend (RN-VINC). Frontend sends the raw input; backend filters.
- All mock/test code: MSW for HTTP, never hit a real backend.
