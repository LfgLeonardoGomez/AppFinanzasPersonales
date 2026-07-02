## Why

The invoice backend (C-08, archived) exposes the full `/api/facturas` CRUD with on-demand FIFO `estado` and a signed Cloudinary preset for invoice files, but users have no interface to use it. Invoice loading is the primary daily action of the app (F-FAC-01) and the input that feeds the supplier balance and FIFO state. Without this frontend, the manual flow that makes the product usable in production (target: C-13) cannot be completed.

## What Changes

- Add a new `facturas` feature in the web app following the exact structure shipped by C-07 (`features/<x>/api` for raw Axios calls + TanStack Query hooks, `features/<x>/components`, a route-level page, and a `types.ts`).
- **Filterable invoice list** (`FacturasPage`): filter by supplier (reuses the C-07 `SupplierSearch` shared autocomplete), by `estado` (PENDIENTE / PARCIAL / PAGADA), and by date range. The `estado` filter operates on the **computed field from the API response** — the frontend never recomputes FIFO and never asks the backend to filter `estado` via SQL (RN-FAC-09).
- **Estado badge** with color semantics: PENDIENTE (orange), PARCIAL (yellow), PAGADA (green).
- **Create/edit form** (`FacturaFormPage`): `proveedor` (required, via `SupplierSearch`), `fecha_emision` (not future, UTC-3), `monto_total` (> 0), `numero` (optional), `fecha_vencimiento` (optional), and **dynamic line items** (add/remove rows: `descripcion`, `cantidad`, `precio_unitario`).
- **Non-blocking warning** when the sum of `items` ≠ `monto_total`; the form still allows saving (RN-FAC-04). The backend is the authority and returns `items_sum_mismatch`.
- **File upload** (single PDF/jpg/png, RN-FAC-07): fetch a signed preset from the backend (`GET /api/cloudinary/preset-firmado?tipo=factura`), upload directly to Cloudinary, persist only the resulting `archivo_url`. Validate type and size (~10 MB max) client-side for UX; the backend re-validates.
- **TanStack Query data layer**: `useFacturas(filters)`, `useFactura(id)`, `useCreateFactura`, `useUpdateFactura`, `useDeleteFactura`, plus a hook for the signed preset.
- **Home quick access**: a "Cargar factura" action on the home screen (F-HOME-01).
- Frontend tests (Vitest + RTL + MSW): list renders estado badges, items-sum warning is shown but non-blocking, full upload flow, and filters apply on the response.

## Capabilities

### New Capabilities
- `facturas-frontend`: The web interface for invoice management — filterable list with computed-estado badges, create/edit form with dynamic items and Cloudinary file upload, supplier linkage via the shared `SupplierSearch` autocomplete, the TanStack Query data layer over `/api/facturas`, and the home quick-access entry point.

### Modified Capabilities
<!-- None. This change introduces a new frontend capability and consumes the existing facturas-api and proveedores-frontend capabilities without changing their requirements. -->

## Impact

- **Repo**: `facturas-proveedores-web` (frontend). No backend change — consumes the C-08 `/api/facturas` endpoints and the existing `GET /api/cloudinary/preset-firmado?tipo=factura`.
- **New code**: `src/features/facturas/` (api hooks, components, page, types). Router wiring in `src/app/router.tsx` (private route under the existing auth guard). A "Cargar factura" entry on the home screen.
- **Reused code**: `src/shared/components/SupplierSearch/` (shipped by C-07) — reused in both the form and the list filter; NOT duplicated. The manually-extended `api.d.ts` types file gains `Factura`-related declarations until `generate-types` runs against the live backend.
- **Dependencies**: C-07 (proveedores-frontend, archived) for `SupplierSearch` and the api/hooks pattern; C-08 (facturas-backend, archived) for the endpoint contract. No new npm dependencies expected (TanStack Query, Axios, Tailwind already present).
- **Governance**: MEDIUM — business UI over an established API; no auth/billing/security surface changed.
