# Tasks: c-13-cuenta-corriente-frontend

> **Repo**: `facturas-proveedores-web/`. Stack: React 18 + TS (strict, no `any`) + Vite PWA, TanStack Query v5, Zustand, Axios, Tailwind v4. Tests: Vitest + RTL + MSW.
> **TDD mandatory (Strict TDD)**: 0. Safety Net (only for modified files) → 1. Understand → 2. RED → 3. GREEN → 4. TRIANGULATE (≥2 cases per behavior) → 5. REFACTOR → 6. Mark complete. New files don't need Safety Net.
> **Test layers** for this change:
> - **Unit**: `SaldoBadge` (color per sign), `FiltrosFacturas` (chip rendering), `shared/utils/currency.ts` (round-trip)
> - **Component**: `TablaFacturasConEstado`, `HistorialCronologico`, `CuentaCorrientePage` — rendered from fixtures, no fetching
> - **Hook**: `useCuentaCorriente` with MSW (loading / success / empty / 404 cross-tenant)
> - **Integration**: `ProveedorDetailPage` end-to-end; cache-invalidation regression suite
> **Backend is NOT touched.** Cloudinary is not used (the view is read-only). The only "upload-adjacent" work is reusing the existing `FacturaFormPage` / `PagoFormPage` create flows, which already mock Cloudinary via MSW (C-09 / C-11).
> **No new npm dependencies.** Reuse everything from C-04, C-07, C-09, C-11.
> **No backend edits.** All file paths are inside `facturas-proveedores-web/`.

## 0. Pre-flight

- [x] 0.1 Read the shipped C-09, C-11, C-07 code (`src/features/facturas/`, `src/features/pagos/`, `src/features/proveedores/`, `src/shared/components/SupplierSearch/`) to confirm prop interfaces, hooks patterns, and the `api.d.ts` extension convention.
- [x] 0.2 Read `facturas-proveedores-api/app/schemas/cuenta_corriente.py` and the C-12 spec to lock the response shape.
- [x] 0.3 Run the existing Vitest suite (`npm test -- --run`) to capture a green baseline before any change.

## 1. Types (api.d.ts extension + compile-time guards)

- [x] 1.1 RED: write `src/shared/api/api.cuentaCorriente.test-d.ts` asserting at compile time that:
  - `CuentaCorrienteResponse` has the four required fields (`proveedor_id`, `saldo`, `facturas_con_estado`, `historial`).
  - `FacturaConEstado['estado']` is assignable to `EstadoFactura` (the C-09 closed union).
  - `EntradaHistorial['tipo']` is the literal `'FACTURA' | 'PAGO'`.
  - `CuentaCorrienteResponse`, `FacturaConEstado`, `EntradaHistorial` have NO `factura_id` key (defense in depth for RN-PAG-01 on the cuenta-corriente surface).
- [x] 1.2 GREEN: extend `src/shared/api/api.d.ts` with:
  - `FacturaConEstado` (mirror of the C-12 Pydantic shape; decimals as `number`).
  - `EntradaHistorial` and `EntradaHistorialTipo = 'FACTURA' | 'PAGO'`.
  - `CuentaCorrienteResponse` (`proveedor_id`, `saldo`, `facturas_con_estado`, `historial`).
  - `FiltrosFacturas` (`estado?`, `fecha_desde?`, `fecha_hasta?`).
  - `FacturaDeleteInput` and `PagoDeleteInput` (`{ id: string; proveedor_id: string }`).
  Run `tsc --noEmit`; all assertions compile cleanly. **No `any`, all fields closed.**
- [x] 1.3 Triangulate: extend `src/shared/api/api.pagos.test.ts` to assert that `PagoDeleteInput` has no key whose name contains `factura` (defense in depth on the delete signature). Run `npm test -- --run src/shared/api/`; all pass.
- [x] 1.4 Safety Net: re-run the full Vitest suite — no regression. The new types are additive; existing tests must still pass.

## 2. Shared currency helper (extracted from PagoCard / FacturasList)

- [x] 2.1 RED: write `src/shared/utils/currency.test.ts` asserting:
  - `formatMonto(1500.5)` returns `$ 1.500,50` (es-AR ARS format).
  - `formatMonto(0)` returns `$ 0,00`.
  - `formatMonto(-300.0)` returns `-$ 300,00` or `$ -300,00` (the exact sign convention is locked by the test; consistency with the existing C-09 / C-11 code is required).
  - `formatMonto('1234.56')` returns the same value as `formatMonto(1234.56)` (string input is accepted for the Pydantic-decimal-string boundary).
- [x] 2.2 GREEN: create `src/shared/utils/currency.ts` with the `formatMonto` helper (the same `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 2 })` instance used in `PagoCard` / `FacturasList`).
- [x] 2.3 Triangulate: migrate the existing call sites in `PagoCard`, `PagoList`, `FacturasList` to use the shared helper. **Pure refactor** — no behavior change; existing tests must still pass.
- [x] 2.4 Safety Net: re-run the full Vitest suite — no regression from the refactor.

## 3. Data layer — `useCuentaCorriente` (TDD, MSW)

- [x] 3.1 RED: write `src/features/cuenta-corriente/api/cuentaCorrienteHooks.test.tsx` with MSW:
  - `useCuentaCorriente` issues `GET /api/proveedores/{id}/cuenta-corriente` with no query params.
  - Hook is disabled when `proveedorId === ''` (no request fires).
  - 200 with full triple → `data` has `saldo`, `facturas_con_estado`, `historial` populated from the response.
  - 200 with `saldo = 0`, empty `facturas_con_estado`, empty `historial` → `data` is the empty triple.
  - 404 → `isError` is true (no retry, 404 is a real answer).
  - **Decimal parsing at the API boundary**: the response sends `saldo: "1234.56"`, the hook's `data.saldo` is the number `1234.56` (asserted). Same for `monto_total` and `saldo_acumulado`.
  Run vitest; the test file fails (the module does not exist).
- [x] 3.2 GREEN: create `src/features/cuenta-corriente/api/cuentaCorrienteApi.ts` with the typed Axios call:
  - `getCuentaCorriente(proveedorId: string): Promise<CuentaCorrienteResponse>`.
  - A private `parseCuentaCorriente(raw)` helper that converts each `Decimal` string (`saldo`, `facturas_con_estado[].monto_total`, `historial[].monto`, `historial[].saldo_acumulado`) via `Number()` and asserts the result is finite.
  - A private `RawCuentaCorrienteResponse` interface mirroring the wire (strings for decimals).
- [x] 3.3 GREEN: create `src/features/cuenta-corriente/api/cuentaCorrienteHooks.ts` with:
  - `CUENTA_CORRIENTE_KEYS = { all: ['cuenta-corriente'], detail: (id) => ['cuenta-corriente', 'detail', id] }`.
  - `useCuentaCorriente(proveedorId: string)` with `queryKey: CUENTA_CORRIENTE_KEYS.detail(proveedorId)`, `enabled: Boolean(proveedorId)`, `retry: false`, `staleTime: 0`.
  Run vitest; all the tests in 3.1 pass.
- [x] 3.4 Triangulate (MANDATORY): add tests for the boundary values of `parseCuentaCorriente` — `0`, `0.01`, `-0.01`, `99999999.99`, `-99999999.99`, and a malformed string (asserts the helper throws a typed `Error`). Run vitest; all pass.
- [x] 3.5 Safety Net: re-run the full Vitest suite — no regression.

## 4. SaldoBadge (TDD, unit)

- [x] 4.1 RED: write `src/features/cuenta-corriente/components/SaldoBadge.test.tsx` asserting:
  - `saldo = 1500.5` → text is the ARS-formatted absolute value, color class contains `red` (or the project's red token).
  - `saldo = 0` → color class contains `green` (al día).
  - `saldo = -500` → text contains the ARS-formatted absolute value AND the literal " a favor", color class contains `blue`.
  - `saldo = NaN` (defensive default) → the badge renders a non-empty element with a fallback class, no throw.
  Run vitest; the test fails (component does not exist).
- [x] 4.2 GREEN: create `src/features/cuenta-corriente/components/SaldoBadge.tsx` with the sign-dispatch class map and the `formatMonto` integration. The component takes `saldo: number` as the only prop.
- [x] 4.3 Triangulate: add a test that the rendered text for `saldo = 0` does NOT contain " a favor" (zero is "al día", not "a favor"). Add a test for the 4-color palette consistency (each branch uses a distinct color class). Run vitest; all pass.
- [x] 4.4 Safety Net: not needed (new file).

## 5. FiltrosFacturas (TDD, unit)

- [x] 5.1 RED: write `src/features/cuenta-corriente/components/FiltrosFacturas.test.tsx` asserting:
  - Renders three controls: an `estado` select with options `Todos / PENDIENTE / PARCIAL / PAGADA`, a `fecha_desde` date input, a `fecha_hasta` date input.
  - Selecting `estado = PENDIENTE` calls `onChange({ estado: 'PENDIENTE' })`.
  - Selecting `fecha_desde = '2026-06-01'` calls `onChange({ fecha_desde: '2026-06-01' })`.
  - Selecting both calls `onChange` with both fields.
  - A "Limpiar filtros" button is rendered when at least one filter is set, and clicking it calls `onChange({})`.
  Run vitest; the test fails (component does not exist).
- [x] 5.2 GREEN: create `src/features/cuenta-corriente/components/FiltrosFacturas.tsx` — controlled-state component that renders the three controls and the "Limpiar filtros" CTA.
- [x] 5.3 Triangulate: add a test for the `estado = 'Todos'` option (sends `onChange({})`, NOT `onChange({ estado: undefined })`). Add a test for the case where the parent has `filters = {}` (no "Limpiar filtros" CTA shown). Run vitest; all pass.
- [x] 5.4 Safety Net: not needed.

## 6. TablaFacturasConEstado (TDD, component, fixtures)

- [x] 6.1 RED: write `src/features/cuenta-corriente/components/TablaFacturasConEstado.test.tsx` with a fixture `facturas: FacturaConEstado[]` (3 rows, mixed estados). Asserts:
  - Renders one `<tr>` per factura in the array.
  - Each row's badge is the `EstadoBadge` matching the row's `estado` (assert by inspecting the rendered text per row).
  - The `archivo_url` field, when present, is rendered as an external link.
  - The `monto_total` is rendered as ARS via the shared `formatMonto`.
  Run vitest; the test fails (component does not exist).
- [x] 6.2 GREEN: create `src/features/cuenta-corriente/components/TablaFacturasConEstado.tsx` as a presentational component:
  - Props: `{ facturas: FacturaConEstado[]; filters: FiltrosFacturas; onChangeFilters: (next: FiltrosFacturas) => void }`.
  - Renders the table with one row per `facturas[i]`.
  - The `monto_total` cell uses `formatMonto`.
  - The `estado` cell uses `EstadoBadge` (C-09, reused).
  - Renders `FiltrosFacturas` above the table.
- [x] 6.3 Triangulate (RED + GREEN): add tests for the filter-on-response behavior:
  - `filters = { estado: 'PENDIENTE' }` → only PENDIENTE rows render. No HTTP request is made (the component does not call any hook).
  - `filters = { fecha_desde: '2026-06-15' }` → only rows with `fecha_emision >= '2026-06-15'` render.
  - `filters = { estado: 'PARCIAL', fecha_desde: '...', fecha_hasta: '...' }` → only rows satisfying both filters render.
  - Empty filtered result → "No hay facturas con esos filtros" + "Limpiar filtros" button is rendered (the button calls `onChangeFilters({})`).
  Run vitest; all pass.
- [x] 6.4 Safety Net: not needed.

## 7. HistorialCronologico (TDD, component, fixtures)

- [x] 7.1 RED: write `src/features/cuenta-corriente/components/HistorialCronologico.test.tsx` with a fixture `historial: EntradaHistorial[]` (3 rows: FACTURA, PAGO, FACTURA). Asserts:
  - Renders one `<tr>` per `historial[i]` in the order received.
  - Each row's `tipo` chip shows "Debe" for `FACTURA` and "Haber" for `PAGO`.
  - Each row's `monto` is rendered as ARS absolute value via `formatMonto`.
  - Each row's `saldo_acumulado` is rendered as ARS with a sign prefix (`+` for positive, `−` for negative, no prefix for zero).
  Run vitest; the test fails (component does not exist).
- [x] 7.2 GREEN: create `src/features/cuenta-corriente/components/HistorialCronologico.tsx` as a presentational component:
  - Props: `{ historial: EntradaHistorial[] }`.
  - Renders the table with one row per `historial[i]`.
  - The `monto` cell uses `formatMonto(Math.abs(monto))` — `monto` is always positive in the response, so `Math.abs` is a defensive no-op (tested).
  - The `saldo_acumulado` cell uses `formatMonto(saldo_acumulado)` (Pydantic already serializes the sign in the string) — the rendered output has the sign baked in by `Intl.NumberFormat`.
  - The `tipo` chip uses the color tokens (red Debe, blue Haber).
- [x] 7.3 Triangulate (RED + GREEN): add tests for:
  - Empty `historial` → "Sin movimientos registrados" empty state.
  - The rendered last row's `saldo_acumulado` matches the page's `SaldoBadge` value (when both are rendered together in a parent, asserted via a small composition test in `CuentaCorrientePage`).
  - The chip color is distinct for FACTURA vs PAGO (assert by class name).
  Run vitest; all pass.
- [x] 7.4 Safety Net: not needed.

## 8. CuentaCorrientePage (TDD, component, fixtures, no fetching)

- [x] 8.1 RED: write `src/features/cuenta-corriente/CuentaCorrientePage.test.tsx` with a fixture `cuentaCorriente: CuentaCorrienteResponse`. Asserts:
  - Renders the `SaldoBadge` with `saldo`.
  - Renders the `TablaFacturasConEstado` with the full `facturas_con_estado` array (no filter).
  - Renders the `HistorialCronologico` with the full `historial` array.
  - The empty triple (`saldo = 0`, empty arrays) shows the empty state.
  - The component does NOT call any hook (verified by mocking the test wrapper and asserting no `useQuery` was called — for a presentational component this is implicit; the test asserts the component renders correctly when given a fixture and does not require MSW).
  Run vitest; the test fails (component does not exist).
- [x] 8.2 GREEN: create `src/features/cuenta-corriente/CuentaCorrientePage.tsx` as a presentational component:
  - Props: `{ cuentaCorriente: CuentaCorrienteResponse }`.
  - Renders the three blocks. Empty state when `saldo === 0 && facturas_con_estado.length === 0 && historial.length === 0`.
  - Local filter state via `useState<FiltrosFacturas>`.
- [x] 8.3 Triangulate: add a test that the filter state in `FiltrosFacturas` propagates to `TablaFacturasConEstado` (asserts: changing the filter in the rendered DOM narrows the table). Add a test for the cross-block invariant: the last row of `HistorialCronologico.saldo_acumulado` matches the `SaldoBadge.saldo`. Run vitest; all pass.
- [x] 8.4 Safety Net: not needed.

## 9. Cross-feature cache invalidation (the contract)

- [x] 9.1 RED: write `src/features/cuenta-corriente/api/cacheInvalidation.test.tsx` with MSW for the six mutations. For each mutation, the test:
  - Sets up a `useCuentaCorriente(X)` query (cached).
  - Calls the mutation.
  - Asserts `queryClient.invalidateQueries` was called with `{ queryKey: ['cuenta-corriente', 'detail', X] }`.
  The six mutations:
  1. `useCreateFactura` with `data.proveedor_id = X` → invalidates `detail(X)`.
  2. `useUpdateFactura` with a PATCH response whose `proveedor_id = X` → invalidates `detail(X)`.
  3. `useDeleteFactura` with `{ id, proveedor_id: X }` → invalidates `detail(X)`.
  4. `useCreatePago` with `data.proveedor_id = X` → invalidates `detail(X)`.
  5. `useUpdatePago` with a PATCH response whose `proveedor_id = X` → invalidates `detail(X)`.
  6. `useDeletePago` with `{ id, proveedor_id: X }` → invalidates `detail(X)`.
  Run vitest; the tests fail (the invalidations are not wired yet).
- [x] 9.2 GREEN: extend `src/features/facturas/api/facturasHooks.ts`:
  - Import `CUENTA_CORRIENTE_KEYS` from `cuentaCorrienteHooks`.
  - In `useCreateFactura.onSuccess(data)`, additionally `invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.detail(data.proveedor_id) })`.
  - In `useUpdateFactura.onSuccess(updated)`, additionally `invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.detail(updated.proveedor_id) })`.
  - In `useDeleteFactura`, change the signature to take `{ id, proveedor_id }` and additionally `invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.detail(proveedor_id) })`.
  - Update `facturasApi.deleteFactura` to take the new `FacturaDeleteInput` shape (extract `input.id` for the URL).
- [x] 9.3 GREEN: extend `src/features/pagos/api/pagosHooks.ts` symmetrically:
  - `useCreatePago`, `useUpdatePago`, `useDeletePago` each invalidate `CUENTA_CORRIENTE_KEYS.detail(proveedorId)`.
  - `useDeletePago` signature changes to `{ id, proveedor_id }`.
  - Update `pagosApi.deletePago` accordingly.
- [x] 9.4 Update the call sites in `FacturasList` and `PagosList` to pass `{ id, proveedor_id }` to the delete mutation.
- [x] 9.5 Run the new `cacheInvalidation.test.tsx` — all six assertions pass. Re-run the existing `facturasHooks.test.tsx` and `pagosHooks.test.tsx` — all still pass (the existing tests do not exercise the delete-mutation signature change with the new input shape; update them in the same change to use the new signature).
- [x] 9.6 Triangulate: add a test in `cacheInvalidation.test.tsx` that asserts a mutation on supplier X does NOT invalidate `cuenta-corriente.detail(Y)` (no cross-contamination). Run vitest; all pass.
- [x] 9.7 Safety Net: re-run the full Vitest suite — no regression from the signature change.

## 10. ProveedorDetailPage (TDD, integration, MSW)

- [x] 10.1 RED: write `src/features/proveedores/ProveedorDetailPage.test.tsx` with MSW for both `GET /api/proveedores/{id}` and `GET /api/proveedores/{id}/cuenta-corriente`. Asserts:
  - Renders the supplier name in the header.
  - Renders the `SaldoBadge` with the cuenta-corriente's `saldo`.
  - Renders the "Cargar factura" and "Cargar pago" links with the correct `?proveedor_id=` query string.
  - Renders the `TablaFacturasConEstado` and `HistorialCronologico` below the action row.
  - The empty triple renders the "Sin movimientos registrados" empty state.
  - 404 on `useProveedor` or `useCuentaCorriente` renders the "Proveedor no encontrado" empty state.
  Run vitest; the test fails (page does not exist).
- [x] 10.2 GREEN: create `src/features/proveedores/ProveedorDetailPage.tsx`:
  - `const { id } = useParams<{ id: string }>()`.
  - `const proveedor = useProveedor(id!)`; `const cc = useCuentaCorriente(id!)`.
  - Header: supplier name + `SaldoBadge(saldo={cc.data?.saldo ?? 0})`.
  - Actions row: `<Link to="/facturas/nueva?proveedor_id={id}">Cargar factura</Link>`, `<Link to="/pagos/nuevo?proveedor_id={id}">Cargar pago</Link>`.
  - Body: `cc.isLoading` → header skeleton; `cc.isError` (other than 404) → refetch CTA; `cc.data` → `<CuentaCorrientePage cuentaCorriente={cc.data} />`; empty triple → empty state with CTAs.
- [x] 10.3 Triangulate (MANDATORY): add tests for:
  - The `?proveedor_id=` pre-fill works when the user navigates from the detail page to the create-factura / create-pago form (asserts the form's supplier chip is set to the supplier from the query string).
  - The header skeleton shows when the queries are loading (no `SaldoBadge` text yet).
  - The "Reintentar" button calls `refetch` (asserted via the `useCuentaCorriente` return shape; refetch is a TanStack Query API).
  Run vitest; all pass.
- [x] 10.4 Safety Net: not needed.

## 11. Router wiring, navigation, pre-fill

- [x] 11.1 RED: update `src/app/router.tsx`:
  - Add the new private route `/proveedores/:id` → `ProveedorDetailPage` under `RequireAuthWithBootstrap`.
  - Add a "Ver cuenta corriente" entry in the inlined `HomePage` linking to `/proveedores`.
  - Import `ProveedorDetailPage` at the top of the file.
  Add a test in `src/app/router.test.tsx` (or an inline route test) asserting:
  - Navigating to `/proveedores/{id}` mounts `ProveedorDetailPage`.
  - Unauthenticated access redirects to `/login`.
  - The home page renders a "Ver cuenta corriente" link.
  Run vitest; the new tests pass, the existing router tests still pass.
- [x] 11.2 GREEN: extend `src/features/facturas/FacturaFormPage.tsx`:
  - On mount, read `?proveedor_id=` from `useSearchParams`.
  - If present, pre-fill `selectedProveedor` (a `ProveedorListItem` is required — the page fetches it via `useProveedor(proveedor_id)` on mount, then sets the chip).
  - The form still works without the query string (no regression in the standalone create flow).
  Add a test in `FacturaFormPage.test.tsx` (or an inline test) asserting:
  - Navigating to `/facturas/nueva?proveedor_id=X` pre-fills the supplier chip with the supplier `X` (mocked via MSW).
  - Without the query string, the supplier is empty (no chip, the user picks via `SupplierSearch`).
  Run vitest; all pass.
- [x] 11.3 GREEN: extend `src/features/pagos/PagoFormPage.tsx` symmetrically (same pattern, same tests).
- [x] 11.4 RED: extend `src/features/proveedores/components/ProveedoresList.test.tsx` (or add a focused test) asserting:
  - Each row contains a "Ver cuenta corriente" link whose `href` is `/proveedores/{id}`.
  - The link does not affect the "Editar" / "Eliminar" controls.
  Run vitest; the new tests fail (the link is not yet present).
- [x] 11.5 GREEN: add the "Ver cuenta corriente" link in `ProveedoresList.tsx` per row. Use the same visual treatment as the existing "Editar" / "Eliminar" links (text only, small). The link's `href` is `/proveedores/{id}`. Run vitest; the new tests pass.
- [x] 11.6 Safety Net: re-run the full Vitest suite — no regression in the router, the home page, the form pages, or the supplier list.

## 12. End-to-end integration (the "fresh triple after mutation" guarantee)

- [x] 12.1 RED: write `src/features/proveedores/ProveedorDetailPage.integration.test.tsx` with MSW for the full flow:
  - Mount `ProveedorDetailPage` at `/proveedores/X`.
  - The page renders the initial `saldo` from the cuenta-corriente endpoint.
  - The test mutates the MSW handler for `GET /api/proveedores/{X}/cuenta-corriente` to return a NEW `saldo` value (the test "adds a pago" on the server side).
  - The test triggers a `useCreatePago` mutation via the page's "Cargar pago" action (calls the button onClick that opens `/pagos/nuevo?proveedor_id=X`, then dispatches a `useCreatePago.mutate({...})` directly to simulate the cache invalidation chain).
  - Asserts the page re-fetches and the new `saldo` is rendered (the `SaldoBadge` text updates).
  Run vitest; the test fails (no integration test exists).
- [x] 12.2 GREEN: the integration passes as soon as tasks 9 (cache invalidation) and 10 (detail page) are in place. No new code; the test is a regression guard.
- [x] 12.3 Triangulate: repeat for `useCreateFactura` (the page re-fetches when a new factura is created). Run vitest; all pass.
- [x] 12.4 Safety Net: not needed (this is the integration test; if any prior task regressed, this catches it).

## 13. Final verification

- [x] 13.1 Run `tsc --noEmit` (TS strict, zero `any`, zero errors). The `api.d.ts` extension is consistent with the C-12 Pydantic shape.
- [x] 13.2 Run `npm test -- --run` (the full Vitest suite). All green. The new tests added in tasks 1–12 are part of the suite. The pre-existing C-04 / C-05 / C-07 / C-09 / C-11 tests must still pass.
- [x] 13.3 Run `npm run lint` (if configured). Zero new warnings.
- [x] 13.4 Manual smoke (optional, via Playwright if available): start the dev server, log in, open a supplier, verify the cuenta-corriente renders, create a pago, verify the saldo updates reactively.
- [x] 13.5 Run `openspec validate c-13-cuenta-corriente-frontend` — confirms the change artifacts are well-formed (all four artifacts present, the proposal references the right upstream archived changes, the spec compiles to the expected delta, no dangling references).

## Definition of done (apply phase)

- [x] All tasks 1–13 are checked off; all tests pass.
- [x] The frontend introduces NO new npm package.
- [x] The frontend introduces NO client-side recomputation of `saldo` / `estado` / `saldo_acumulado` (asserted by the unit + component tests reading the response verbatim).
- [x] The cross-feature cache invalidation is wired and covered by the regression test in task 9.
- [x] The `api.d.ts` extension matches the C-12 Pydantic shape; the compile-time guards in `api.cuentaCorriente.test-d.ts` lock the contract.
- [x] The router registers `/proveedores/:id` under `RequireAuthWithBootstrap`; the home page links to it; the supplier list rows link to it.
- [x] `openspec validate c-13-cuenta-corriente-frontend` reports no errors.

## Review Workload Forecast

- **Estimated changed lines**: ~1100–1500 across ~14 new files (feature-local, additive) + modifications to `facturasHooks`, `pagosHooks`, `facturasApi`, `pagosApi`, `FacturasList`, `PagosList`, `FacturaFormPage`, `PagoFormPage`, `ProveedoresList`, `router.tsx`, `api.d.ts`, and a small migration of monetary formatting to the shared `formatMonto` helper.
- **400-line budget risk**: **High** — likely exceeds 400 changed lines if shipped as a single PR.
- **Chained PRs recommended**: **Yes**.
  - **PR-A (foundation, ≤ ~250 lines)**: tasks 1 (types) + 2 (shared currency helper) + 3 (data layer) + 4 (SaldoBadge) + 5 (FiltrosFacturas). Tests ship with the code. No wiring to other features yet.
  - **PR-B (tables, ≤ ~350 lines)**: tasks 6 (TablaFacturasConEstado) + 7 (HistorialCronologico) + 8 (CuentaCorrientePage). Tests ship with the code. Still isolated to the new feature.
  - **PR-C (cross-feature wiring, ≤ ~250 lines)**: task 9 (cache invalidation in the existing mutation hooks + `FacturasList` / `PagosList` call sites). Touches the C-09 / C-11 features; the change is additive but it touches existing files.
  - **PR-D (integration + nav, ≤ ~250 lines)**: tasks 10 (ProveedorDetailPage) + 11 (router + nav + pre-fill) + 12 (end-to-end test) + 13 (verification). Wires the new feature into the app shell.
- **Delivery strategy**: `ask-on-risk`. Decision needed before apply: **Yes** (chained PRs or `size:exception`).
- **Default if no decision**: chained PRs (A → B → C → D), stacked to main. The change is additive and route-gated; rollback is trivial at every chained-PR boundary.

## Work-unit commits (per chained PR)

- **PR-A**: one commit per task (1, 2, 3, 4, 5). Each commit is independently reviewable and the test suite stays green at each step.
- **PR-B**: one commit per task (6, 7, 8). Each commit is independently reviewable.
- **PR-C**: one commit for the cache invalidation wiring in `facturasHooks` + `FacturasList` (task 9.1–9.5), one commit for `pagosHooks` + `PagosList` (task 9.1–9.5), one commit for the cross-contamination test (task 9.6). Three commits, easy to bisect.
- **PR-D**: one commit for `ProveedorDetailPage` (task 10), one commit for the router + home + list link (task 11.1, 11.4, 11.5), one commit for the form-page pre-fill (task 11.2, 11.3), one commit for the integration test (task 12), one commit for the verification (task 13).
