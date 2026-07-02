# Tasks — C-07 proveedores-frontend

> **Governance: MEDIUM.** Business logic UI. TDD estricto activo: Vitest + RTL + MSW.
> Repo: `facturas-proveedores-web`. No se toca el backend.
> Baseline: 33/33 tests passing (C-04 auth-frontend).

## 1. Extend api.d.ts with Proveedor types

- [x] 1.1 Add `Categoria`, `Proveedor`, `ProveedorCreate`, `ProveedorUpdate`, `ProveedorListItem`, `ProveedorDeleteResponse`, `PaginatedProveedores` to `src/shared/api/api.d.ts`

## 2. Data layer — proveedoresApi.ts + proveedoresHooks.ts (TDD)

- [x] 2.1 RED: test — `useProveedores` returns paginated list with `saldo` per item; `useCreateProveedor` mutation fires POST; `useUpdateProveedor` fires PATCH; `useDeleteProveedor` fires DELETE and returns `tiene_dependencias`; `useBuscarProveedores` fires GET buscar with nombre param
- [x] 2.2 GREEN: create `src/features/proveedores/api/proveedoresApi.ts` (raw Axios calls) and `proveedoresHooks.ts` (TanStack Query hooks)
- [x] 2.3 TRIANGULATE: test — list with `order_by=saldo`; pagination `page=2`; buscar with empty query is disabled; delete on non-existent → 404 handled as error (not silently)

## 3. ProveedoresList component (TDD)

- [x] 3.1 RED: test — renders supplier names and formatted `saldo`; "Nuevo proveedor" button present; sort controls present; clicking "Eliminar" on a supplier with no dependencies removes it; clicking "Eliminar" on a supplier with dependencies shows confirmation dialog
- [x] 3.2 GREEN: create `src/features/proveedores/components/ProveedoresList.tsx` — table/list showing `nombre`, `saldo` (formatted ARS), `categoria`, sort/pagination controls, edit and delete actions per row
- [x] 3.3 TRIANGULATE: test — empty state renders a "No hay proveedores" message; pagination controls render when there are multiple pages

## 4. ProveedorForm component — create/edit modal (TDD)

- [x] 4.1 RED: test — submit with empty `nombre` shows validation error and does not call API; valid create payload calls POST; valid edit payload calls PATCH; CUIT with wrong format shows client hint; backend 422 renders the error
- [x] 4.2 GREEN: create `src/features/proveedores/components/ProveedorForm.tsx` — controlled form with `nombre` (required), `cuit` (optional, format hint), `telefono`, `categoria` (select), `notas`; shows backend errors; PascalCase, no `any`
- [x] 4.3 TRIANGULATE: test — edit mode pre-fills existing values; categoria select renders all enum options; form resets after successful submit

## 5. DeleteProveedorDialog — confirmation (TDD)

- [x] 5.1 RED: test — renders nothing when `open=false`; shows supplier name and dependency warning when `open=true` and `hasDependencies=true`; calls `onConfirm` when user clicks "Confirmar"; calls `onCancel` when user clicks "Cancelar"
- [x] 5.2 GREEN: create `src/features/proveedores/components/DeleteProveedorDialog.tsx` — modal dialog with conditional dependency warning (RN-PROV-04)
- [x] 5.3 TRIANGULATE: test — when `hasDependencies=false`, renders without dependency warning; confirm click fires onConfirm

## 6. SupplierSearch shared component (TDD)

- [x] 6.1 RED: test — typing ≥2 chars triggers buscar query; shows matching supplier names in dropdown; selecting a supplier calls `onChange`; clearing calls `onChange(null)`; typing <2 chars shows no dropdown
- [x] 6.2 GREEN: create `src/shared/components/SupplierSearch/SupplierSearch.tsx` — autocomplete calling GET /api/proveedores/buscar; dropdown of results; clear button; disabled prop support
- [x] 6.3 TRIANGULATE: test — empty results show "Sin coincidencias"; disabled prop disables the input; clear button calls onChange(null)

## 7. ProveedoresPage + router integration (TDD)

- [x] 7.1 RED: test — page renders the list when loaded; "Nuevo proveedor" button opens the form modal; closes on cancel
- [x] 7.2 GREEN: create `src/features/proveedores/ProveedoresPage.tsx`; add `/proveedores` route to `src/app/router.tsx` under `RequireAuthWithBootstrap`
- [x] 7.3 TRIANGULATE: test — route accessible under /proveedores via Routes; modal state management tested

## 8. Cierre

- [x] 8.1 `npm run typecheck` — 0 errors (tsconfig estricto, sin `any`)
  > `tsc --noEmit` → 0 errors.
- [x] 8.2 `npm run test` — 74/74 tests passing (12 test files: 33 baseline C-04 + 41 new C-07)
- [x] 8.3 No tokens in `localStorage`/`sessionStorage` — no new code touches storage. Auth pattern from C-04 preserved.
