# Design: c-13-cuenta-corriente-frontend

## Context

C-12 (`cuenta-corriente-backend`, archived 2026-06-27) ships the read-only endpoint (per `openspec/specs/cuenta-corriente-backend/spec.md` and the live `facturas-proveedores-api/app/routers/proveedores.py`):

| Method | Path | Description |
|---|---|---|
| GET | `/api/proveedores/{proveedor_id}/cuenta-corriente` | Returns `CuentaCorrienteResponse` for the supplier. 200 on own supplier (with movimientos or empty), 404 on foreign / missing / soft-deleted, 401 on unauthenticated. No request body, no query parameters. |

The Pydantic response shape (mirrored in `facturas-proveedores-api/app/schemas/cuenta_corriente.py`):

```json
{
  "proveedor_id": "uuid",
  "saldo": "1234.56",                                  // signed: >0 deuda, =0 al día, <0 a favor
  "facturas_con_estado": [
    {
      "id": "uuid", "proveedor_id": "uuid", "numero": "001-1234" | null,
      "fecha_emision": "2026-06-15", "fecha_vencimiento": null,
      "monto_total": "1500.00", "archivo_url": null, "origen": "MANUAL",
      "estado": "PENDIENTE",                            // PENDIENTE | PARCIAL | PAGADA — computed, not stored
      "created_at": "...", "updated_at": "..."
    }
  ],
  "historial": [
    { "id": "uuid", "tipo": "FACTURA", "fecha": "2026-06-15", "monto": "1500.00", "saldo_acumulado": "1500.00" }
  ]
}
```

**Decimals are serialized as JSON strings** by Pydantic v2 (Pydantic v2 default for `Decimal`). The `api.d.ts` types declare them as `number` and the client-side parsing is `Number(value)`. `monto` of `EntradaHistorial` is always positive; the sign is implicit in `tipo` (`FACTURA` adds, `PAGO` subtracts). `saldo_acumulado` is signed; the **last** row's `saldo_acumulado` equals the response's `saldo` (invariant asserted in C-12 design D10).

C-09 (`facturas-frontend`, archived 2026-06-25) and C-11 (`pagos-frontend`, archived 2026-06-27) shipped the half-features whose data composes the triple: `FacturaListItem` + `EstadoBadge` + `FacturasFilters` (C-09) and `PagoListItem` + `MetodoBadge` + `PagoCard` + `PagosFilters` (C-11). Both features have TanStack Query hooks with the established invalidation pattern (`invalidateQueries({ queryKey: KEY.all })`).

C-07 (`proveedores-frontend`, archived 2026-06-21) shipped the supplier list, `ProveedorListItem`, and `SupplierSearch`. The list rows have "Editar" / "Eliminar" actions; **no detail link yet**.

**The gap (this change closes it):**
- No frontend consumes the C-12 endpoint.
- `ProveedoresList` has no "Ver cuenta corriente" link.
- Creating a `Factura` or `Pago` for a supplier does NOT refresh any cuenta-corriente view (because none exists yet), but the cross-feature invalidation is also not wired in the existing mutation hooks. **It must be wired here** so the new view reacts.

## Goals / Non-Goals

**Goals:**
- A complete, typed (TS strict, no `any`) cuenta-corriente view per supplier that consumes the C-12 endpoint verbatim and NEVER recomputes `saldo` / `estado` / `saldo_acumulado`.
- Saldo with sign-based color: `> 0` deuda red, `= 0` al día green, `< 0` a favor blue.
- Tabla de facturas con estado (FIFO from the response) + filter chips for estado and fecha range, applied on the response payload (no re-issue).
- Historial cronológico showing `saldo_acumulado` per row, with visual distinction between `FACTURA` (debe) and `PAGO` (haber) rows.
- `ProveedorDetailPage` integrating the triple with two action buttons (Cargar factura / Cargar pago) scoped to the current supplier.
- **Cross-feature cache invalidation**: every `useCreateFactura` / `useUpdateFactura` / `useDeleteFactura` / `useCreatePago` / `useUpdatePago` / `useDeletePago` mutation also invalidates `['cuenta-corriente', 'detail', proveedorId]`.
- Routing: `/proveedores/:id` (private). A "Ver cuenta corriente" link on each `ProveedoresList` row. A "Ver cuenta corriente" entry on the home screen.
- TDD-ready code (Strict TDD: every behavior tested by RED → GREEN → TRIANGULATE).
- All currency formatted as ARS via `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`.

**Non-Goals:**
- Any backend change (C-12 already ships the endpoint).
- IA-assisted loading (C-14/C-15) — out of scope.
- Per-factura actions (e.g. "Pagar factura X") — explicitly forbidden (RN-PAG-01: pagos no se vinculan a facturas).
- Pagination of the cuenta-corriente payload (C-12 returns the full triple; if a supplier has >500 movements the next change adds it).
- Server-side filtering of the cuenta-corriente (the endpoint has no query params; filters are client-side on the response).
- A "marcar como pagada" or any per-invoice mutation from the cuenta-corriente view.
- Any new shared component (everything is reused from C-07/C-09/C-11).

## Decisions

### D1 — Feature folder structure mirrors C-11 exactly

```
src/features/cuenta-corriente/
├── api/
│   ├── cuentaCorrienteApi.ts            # raw Axios: getCuentaCorriente(proveedorId)
│   ├── cuentaCorrienteHooks.ts          # useCuentaCorriente, CUENTA_CORRIENTE_KEYS
│   └── cuentaCorrienteHooks.test.tsx    # MSW tests (loading/success/404/empty)
├── components/
│   ├── SaldoBadge.tsx                   # presentational, sign-based color
│   ├── SaldoBadge.test.tsx
│   ├── TablaFacturasConEstado.tsx       # table + filters on response
│   ├── TablaFacturasConEstado.test.tsx
│   ├── FiltrosFacturas.tsx              # estado + fecha range, applied on response
│   ├── FiltrosFacturas.test.tsx
│   ├── HistorialCronologico.tsx         # chronological merge, saldo_acumulado per row
│   └── HistorialCronologico.test.tsx
├── CuentaCorrientePage.tsx              # composition (header + saldo + tablas)
├── CuentaCorrientePage.test.tsx
└── types.ts                             # re-exports from @shared/api/api
```

`ProveedorDetailPage` lives in `src/features/proveedores/ProveedorDetailPage.tsx` (it is the integration of `CuentaCorrientePage` into the `proveedores-frontend` capability).

### D2 — `SaldoBadge` is presentational, sign-based, NEVER recomputes

```tsx
interface SaldoBadgeProps { saldo: number }

const DEUDA_CLASS    = '… bg-red-100 text-red-800 …'
const AL_DIA_CLASS   = '… bg-green-100 text-green-800 …'
const A_FAVOR_CLASS  = '… bg-blue-100 text-blue-800 …'

function classFor(saldo: number): string {
  if (saldo > 0)  return DEUDA_CLASS
  if (saldo < 0)  return A_FAVOR_CLASS
  return AL_DIA_CLASS                  // saldo === 0
}
```

The component receives `saldo` as a prop and dispatches on sign. It does NOT call the API, does NOT compute `saldo` from `facturas` / `pagos`, and does NOT touch Zustand. The three branches (`> 0`, `< 0`, `=== 0`) plus a defensive `NaN` fallback are tested in `SaldoBadge.test.tsx`. **No `any`, no `parseFloat`, no string manipulation of the `saldo` value** — the value arrives as a `number` from the API and stays a number.

Visual: the badge displays the absolute value formatted as ARS (`Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })`); the sign is encoded ONLY by the color (the `SaldoBadge` text is the absolute amount). For the `a_favor` case, a small "a favor" suffix is appended (`$1.234,56 a favor`) to make the negative balance explicit in the readout — a UI copy decision, not a math decision.

### D3 — `TablaFacturasConEstado` reads `estado` from response, filters on response

Component signature:

```tsx
interface TablaFacturasConEstadoProps {
  facturas: FacturaConEstado[]            // from the cuenta-corriente response
  filters: { estado?: EstadoFactura; fecha_desde?: string; fecha_hasta?: string }
  onChangeFilters: (next: FiltrosFacturas) => void
}
```

The component receives the full `facturas_con_estado` array (already small for MVP) and the filter state. The table does NOT call `useFacturas`; it works on the supplied data. Filters are applied in a `useMemo` that filters on the response fields (`f.estado === filters.estado` for the estado filter; `f.fecha_emision >= filters.fecha_desde && f.fecha_emision <= filters.fecha_hasta` for the date range). The memoized output is what the table renders. The "no results" state shows "No hay facturas con esos filtros" with a "Limpiar filtros" button.

The estado badge in each row is the existing `EstadoBadge` from C-09 (reused, not duplicated). Decimals formatted with ARS. The `archivo_url` is rendered as an external link when present.

### D4 — `HistorialCronologico` reads `saldo_acumulado` from response, never recomputes

Component signature:

```tsx
interface HistorialCronologicoProps { historial: EntradaHistorial[] }
```

The component receives the full `historial` array (already in chronological order from the backend per RN-HIST). The table renders each row with: `fecha`, the row type (`FACTURA` or `PAGO`) shown as a colored chip, the absolute `monto` formatted as ARS, and the signed `saldo_acumulado` formatted as ARS with a sign prefix (`+ $1.500,00` for positive, `− $300,00` for negative, `$0,00` for zero). The component does NOT walk the array, does NOT compute a running sum, and does NOT split between debe and haber — all values are read from the response.

Visual distinction: FACTURA rows have a subtle left-border in red and a "Debe" chip; PAGO rows have a blue left-border and a "Haber" chip. This is a visual signal that the user can scan, not a math operation.

### D5 — `useCuentaCorriente(proveedorId)` hook

```ts
export const CUENTA_CORRIENTE_KEYS = {
  all: ['cuenta-corriente'] as const,
  detail: (proveedorId: string) => ['cuenta-corriente', 'detail', proveedorId] as const,
}

export function useCuentaCorriente(proveedorId: string) {
  return useQuery({
    queryKey: CUENTA_CORRIENTE_KEYS.detail(proveedorId),
    queryFn: () => getCuentaCorriente(proveedorId),
    enabled: Boolean(proveedorId),
    retry: false,                        // 404 is a real answer, not a transient error
    staleTime: 0,                        // always fresh on revisit
  })
}
```

`retry: false` mirrors `useFactura` / `usePago` behavior (C-09/C-11) so a 404 is surfaced as `isError` and the page can show the empty state, not a retry spinner. `staleTime: 0` makes the next visit re-fetch; the invalidation pattern in D6 keeps the active view in sync without manual refetch.

### D6 — Cross-feature cache invalidation (the contract)

Every mutation that touches a `Factura` or `Pago` of a given supplier must invalidate the `cuenta-corriente.detail(proveedorId)` key. Implementation:

| Hook | `proveedorId` source | Invalidation call |
|---|---|---|
| `useCreateFactura` | `data.proveedor_id` (the mutation payload) | `queryClient.invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.detail(data.proveedor_id) })` |
| `useUpdateFactura` | `updated.proveedor_id` (the PATCH response) | `queryClient.invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.detail(updated.proveedor_id) })` |
| `useDeleteFactura` | Pre-fetch via `queryClient.getQueryData(FACTURA_KEYS.detail(id))` → `proveedor_id`; fallback: PATCH-like read by id. The simplest approach: change the delete to call `GET /api/facturas/{id}` first (lightweight), then DELETE, then invalidate. Alternative: store `proveedor_id` on the delete call site and pass it in. **Decision: change the delete to a `useDeleteFactura` signature that takes `{ id, proveedor_id }`; the call site (e.g. `FacturasList`) already has the row's `proveedor_id` because it iterates `FacturaListItem[]`.** | invalidate by `proveedor_id` |
| `useCreatePago` | `data.proveedor_id` | same |
| `useUpdatePago` | `updated.proveedor_id` | same |
| `useDeletePago` | Same `useDeleteFactura` reasoning: signature becomes `{ id, proveedor_id }`; the call site passes it from the row. | same |

The call site change is minimal because every list already has the row's `proveedor_id`:

```tsx
// FacturasList.tsx (modified C-09)
deleteMutation.mutate({ id: factura.id, proveedor_id: factura.proveedor_id }, { onSuccess: ... })
```

```tsx
// PagosList.tsx (modified C-11)
deleteMutation.mutate({ id: pago.id, proveedor_id: pago.proveedor_id }, { onSuccess: ... })
```

**Type contract:** a new TS type `PagoDeleteInput = { id: string; proveedor_id: string }` and `FacturaDeleteInput = { id: string; proveedor_id: string }` are added to `api.d.ts`. The runtime `pagosApi.deletePago(id)` becomes `deletePago(input: PagoDeleteInput)` and the body of the API helper extracts `input.id` for the URL. This is a **breaking change to the `pagosHooks` / `facturasHooks` API surface**, accepted because the hooks are internal to the app (no other consumer); the list call sites are updated in the same change. Tests are updated to match.

A regression test in `cuentaCorrienteHooks.test.tsx` (or a new `cacheInvalidation.test.tsx` next to it) exercises each mutation and asserts that `queryClient.invalidateQueries` was called with the `cuenta-corriente.detail(proveedorId)` key. The test uses MSW for the API and a spy on the QueryClient.

### D7 — `ProveedorDetailPage` integration

```tsx
// ProveedorDetailPage.tsx (new)
export function ProveedorDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { data: proveedor, isLoading, isError } = useProveedor(id!)
  const cuentaCorriente = useCuentaCorriente(id!)

  if (isLoading) return <LoadingState />
  if (isError || !proveedor) return <NotFoundState />

  return (
    <main>
      <header>
        <h1>{proveedor.nombre}</h1>
        <SaldoBadge saldo={cuentaCorriente.data?.saldo ?? 0} />
      </header>

      <div className="actions">
        <Link to={`/facturas/nueva?proveedor_id=${id}`}>Cargar factura</Link>
        <Link to={`/pagos/nuevo?proveedor_id=${id}`}>Cargar pago</Link>
        <Link to={`/proveedores/${id}/editar`}>Editar proveedor</Link>
      </div>

      {cuentaCorriente.isLoading ? <LoadingState /> :
       cuentaCorriente.isError  ? <ErrorState /> :
       cuentaCorriente.data     ? <CuentaCorrientePage cuentaCorriente={cuentaCorriente.data} /> :
                                 <EmptyState />}
    </main>
  )
}
```

Notes:
- The page header reads `proveedor.nombre` from the existing `useProveedor` (C-07 hook, reused). The saldo comes from `useCuentaCorriente` (this change). Two requests, parallel — the page shows the header immediately and the saldo populates as the cuenta-corriente query resolves.
- The action buttons link to the existing create forms with `?proveedor_id=` as a query string. The `FacturaFormPage` / `PagoFormPage` (C-09/C-11) are extended to pre-fill the `proveedor_id` from the query string if present (this is a small change in each form page; covered by tests).
- The `CuentaCorrientePage` component is exported from `src/features/cuenta-corriente/` as a pure presentational component that takes the full response as a prop. The integration lives in `ProveedorDetailPage`, so `CuentaCorrientePage` is testable in isolation with a fixture and `ProveedorDetailPage` is testable end-to-end with MSW.
- The "Editar proveedor" link is a convenience that takes the user to the existing C-07 form. It is a small UX nicety; if the project prefers to keep detail page minimal, the link can be dropped (decision: keep it; C-07 already ships the form).

### D8 — Routing & navigation

Add to `src/app/router.tsx`:

```tsx
{
  path: '/proveedores/:id',
  element: (
    <RequireAuthWithBootstrap>
      <ProveedorDetailPage />
    </RequireAuthWithBootstrap>
  ),
},
```

Also:
- `ProveedoresList` row gets a "Ver" link to `/proveedores/{id}`. A regression test asserts the link is present and routes correctly.
- The inlined `HomePage` in `router.tsx` gets a "Ver cuenta corriente" quick-access entry. Without a supplier in context, this link routes to `/proveedores` (the list). A test asserts the link is present and navigates correctly. (Q-CC-FE-01 in the open questions discusses whether a supplier picker would be nicer; for MVP the link to `/proveedores` is the simplest and matches the F-HOME-01 pattern.)
- The `FacturaFormPage` and `PagoFormPage` pre-fill the supplier from `?proveedor_id=` if present in the URL. The existing C-09 / C-11 forms keep their full create flow otherwise; the pre-fill is purely additive (covered by tests).

### D9 — `api.d.ts` extension

```ts
// ── C-12 / C-13: cuenta-corriente types (output-only) ──────────────────────────

export interface FacturaConEstado {
  id: string
  usuario_id: string
  proveedor_id: string
  numero: string | null
  fecha_emision: string
  fecha_vencimiento: string | null
  monto_total: number                  // parsed from JSON Decimal string
  archivo_url: string | null
  origen: OrigenDocumento
  estado: EstadoFactura
  created_at: string
  updated_at: string
}

export type EntradaHistorialTipo = 'FACTURA' | 'PAGO'

export interface EntradaHistorial {
  id: string
  tipo: EntradaHistorialTipo
  fecha: string
  monto: number
  saldo_acumulado: number
}

export interface CuentaCorrienteResponse {
  proveedor_id: string
  saldo: number
  facturas_con_estado: FacturaConEstado[]
  historial: EntradaHistorial[]
}

// ── C-13: delete mutations now carry the supplier id (D6) ──────────────────────

export interface FacturaDeleteInput { id: string; proveedor_id: string }
export interface PagoDeleteInput   { id: string; proveedor_id: string }

// ── C-13: pre-fill from URL ────────────────────────────────────────────────────

export interface FiltrosFacturas {
  estado?: EstadoFactura
  fecha_desde?: string
  fecha_hasta?: string
}
```

The `FiltrosFacturas` type is the in-component filter state; it is NOT a server-side query param. The hook has no query params.

The runtime-guard test `api.pagos.test.ts` is extended to assert: `PagoDeleteInput` has no `factura` key (defense in depth for RN-PAG-01 even at the delete signature level). A new `api.cuentaCorriente.test-d.ts` asserts compile-time that `CuentaCorrienteResponse.facturas_con_estado[number].estado` is one of `PENDIENTE|PARCIAL|PAGADA` (i.e., the type union is closed).

### D10 — TDD layering (Strict TDD)

| Layer | Files | Test file pattern |
|---|---|---|
| Unit | `SaldoBadge`, `FiltrosFacturas` | `*.test.tsx` next to the component, plain props, no MSW |
| Component | `TablaFacturasConEstado`, `HistorialCronologico`, `CuentaCorrientePage` | `*.test.tsx` next to the component, fixtures, no MSW |
| Hook | `useCuentaCorriente` (+ cache-invalidation tests) | `cuentaCorrienteHooks.test.tsx` with MSW, plus a focused `cacheInvalidation.test.tsx` |
| Integration | `ProveedorDetailPage` | `ProveedorDetailPage.test.tsx` with MSW, end-to-end with `MemoryRouter` + `Routes` |

Every task that creates a behavior follows: 0. Safety Net (only for modified files: `FacturasList`, `PagosList`, `FacturaFormPage`, `PagoFormPage`, `facturasHooks`, `pagosHooks`, `api.d.ts`, `ProveedoresList`, `router.tsx`), 1. Understand, 2. RED, 3. GREEN, 4. TRIANGULATE (≥2 cases per behavior), 5. REFACTOR, 6. Mark complete. New files don't need Safety Net.

### D11 — Visual direction (Awwwards-tier, consistent with the project's emerging style)

The cuenta-corriente is the product's hero screen. The visual direction follows the project's emerging high-end language:

- **Vibe**: Soft Structuralism (silver-grey / white background, generous whitespace, soft diffused shadows, double-bezel cards for the three blocks — saldo / facturas / historial).
- **Layout**: The Asymmetrical Bento. The saldo block is a tall hero card (col-span-4 row-span-2 on `md+`, single column on mobile). The facturas table and the historial table stack to the right (col-span-8). On mobile, all three stack vertically with generous vertical gaps (`gap-6`).
- **Typography**: Inter is BANNED per the project's high-end rule. Use the project's body font (the C-05 profile already shipped something; the task verifies it). For numerics (the `saldo` figure), use a tabular numeric font so the digit columns align in the historial.
- **Color tokens**:
  - Deuda (saldo > 0): red family (e.g. `bg-red-50`, `text-red-700`, `ring-red-200`).
  - Al día (saldo === 0): green family.
  - A favor (saldo < 0): blue family.
  - The supplier name is the page's only large headline; the saldo is its visual companion in a single double-bezel card.
- **Motion**: stagger the three blocks in on mount (40ms delay between each, opacity + `translateY(8px)` → 0 over 200ms with `cubic-bezier(0.23, 1, 0.32, 1)`). The filter chips animate in with a 100ms ease-out. Respect `prefers-reduced-motion` (no motion, just opacity).
- **Loading**: a skeleton with the three block outlines, no spinner. The previous data (if any) stays visible while the new fetch resolves (`staleTime: 0` + `placeholderData: keepPreviousData` from TanStack Query v5).

The visual direction is documented here so the apply phase does not regress to a generic table-grid. The pattern in `PagoCard` (single-bezel, generous padding, semantic colors) is the reference; `SaldoBadge` is the visual keystone.

### D12 — Error and empty states

| Condition | UI |
|---|---|
| Hook loading (no cached data) | Skeleton with three block outlines + `aria-busy="true"`. |
| Hook loading (cached data exists) | Show cached data with a subtle top progress bar (1px, primary color) — `keepPreviousData`. |
| Hook success with `saldo === 0`, empty `facturas_con_estado`, empty `historial` | "Sin movimientos registrados" empty state with a "Cargar factura" and "Cargar pago" CTA. |
| Hook success with data | Render the three blocks. |
| Hook 404 (foreign / soft-deleted / missing supplier) | "Proveedor no encontrado" empty state with a link to `/proveedores`. |
| Hook 401 | The Axios interceptor handles 401 globally; the page does nothing special. |
| Other errors | "No se pudo cargar la cuenta corriente. Reintentar" button that calls `refetch()`. |

### D13 — Currency and number formatting

Single source of truth: a `formatMonto(value: number | string): string` helper in `src/shared/utils/currency.ts` (extracted from `PagoCard` and `FacturasList` to avoid duplication; the existing call sites in C-09/C-11 are migrated in this change). All cuenta-corriente amounts go through this helper. The helper does NOT recompute anything; it formats the value it is given.

Decimals arrive as JSON strings (Pydantic v2 default for `Decimal`). The `api.d.ts` types declare them as `number`, so the conversion happens once at the `getCuentaCorriente` boundary:

```ts
// cuentaCorrienteApi.ts
function parseCuentaCorriente(raw: CuentaCorrienteResponseRaw): CuentaCorrienteResponse {
  return {
    proveedor_id: raw.proveedor_id,
    saldo: Number(raw.saldo),
    facturas_con_estado: raw.facturas_con_estado.map((f) => ({
      ...f,
      monto_total: Number(f.monto_total),
    })),
    historial: raw.historial.map((h) => ({
      ...h,
      monto: Number(h.monto),
      saldo_acumulado: Number(h.saldo_acumulado),
    })),
  }
}
```

The `Raw` interface mirrors the wire (string decimals) and is internal to the API helper. The public `CuentaCorrienteResponse` has `number` decimals everywhere. This is the same pattern C-09 / C-11 implicitly use (their Pydantic also serializes Decimal as string, but the existing types declare `number` and assume the conversion is a no-op; for the cuenta-corriente it is NOT a no-op, so the explicit parser is necessary).

## Reuse from C-07/C-09/C-11

| Component / Hook | Origin | Reused in C-13 as |
|---|---|---|
| `EstadoBadge` (`src/features/facturas/components/EstadoBadge.tsx`) | C-09 | Per-row badge in `TablaFacturasConEstado` |
| `SupplierSearch` (`src/shared/components/SupplierSearch/SupplierSearch.tsx`) | C-07 | (Not used in this change — the cuenta-corriente view is read-only.) |
| `MetodoBadge` (`src/features/pagos/components/MetodoBadge.tsx`) | C-11 | Reference for the "Debe" / "Haber" chip pattern in `HistorialCronologico` (NOT used directly — different semantics — but the chip pattern is mirrored) |
| `PagoCard` (`src/features/pagos/components/PagoCard.tsx`) | C-11 | Reference for the action-button pattern in `ProveedorDetailPage` (the "Cargar factura" / "Cargar pago" CTAs follow the same shape) |
| `Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' })` | C-09 / C-11 | All ARS amounts (extracted into `shared/utils/currency.ts`) |
| `getTodayUTC3()` (`src/shared/utils/date.ts`) | C-09 | (Not used in this read-only view, but kept consistent for any future date-range filter) |
| `apiClient` + 401 interceptor | C-04 | All Axios calls |
| TanStack Query + query-key convention (`FACTURA_KEYS.all`, `PAGO_KEYS.all`) | C-07 / C-09 / C-11 | `CUENTA_CORRIENTE_KEYS` mirrors the same shape |
| `useCreateFactura` / `useUpdateFactura` / `useDeleteFactura` invalidation pattern | C-09 | Extended in D6 with cuenta-corriente invalidation |
| `useCreatePago` / `useUpdatePago` / `useDeletePago` invalidation pattern | C-11 | Extended in D6 with cuenta-corriente invalidation |
| `useProveedor(id)` | C-07 | Header supplier name in `ProveedorDetailPage` |
| `api.d.ts` extension pattern | C-09 / C-11 | New `CuentaCorriente*` types + `FacturaDeleteInput` / `PagoDeleteInput` |
| `HomePage` quick-access pattern | C-09 / C-11 | New "Ver cuenta corriente" entry |
| Private routes under `RequireAuthWithBootstrap` | C-04 | `/proveedores/:id` |
| MSW + Vitest + RTL test stack | C-04 / C-07 / C-09 / C-11 | `*.test.tsx` next to every component |
| `useNavigate` / `Link` from `react-router-dom` | C-09 / C-11 | Navigation between detail page and create forms |

## Layer interaction

```
ProveedorDetailPage (route: /proveedores/:id)
  ├─ useProveedor(id)                  # C-07 — header name
  ├─ useCuentaCorriente(id)            # C-13 — {saldo, facturas_con_estado, historial}
  │    └─ getCuentaCorriente(id)       # apiClient → GET /api/proveedores/{id}/cuenta-corriente
  ├─ <Link to="/facturas/nueva?proveedor_id=…">   # C-09
  └─ <Link to="/pagos/nuevo?proveedor_id=…">      # C-11
       │
       ▼ (cross-feature cache invalidation, D6)
useCreateFactura   ─┐
useUpdateFactura   ─┤
useDeleteFactura   ─┤  invalidateQueries(['cuenta-corriente', 'detail', proveedorId])
useCreatePago      ─┤
useUpdatePago      ─┤
useDeletePago      ─┘
       │
       ▼
CuentaCorrientePage (presentational)
  ├─ SaldoBadge(saldo)
  ├─ TablaFacturasConEstado(facturas, filters, onChangeFilters)
  │    └─ EstadoBadge(estado)   # C-09
  └─ HistorialCronologico(historial)
```

State ownership: server state in TanStack Query; local UI state (`useState`) for the filter chips; no new Zustand slice. Mutations invalidate `CUENTA_CORRIENTE_KEYS.detail(proveedorId)` in addition to the existing key invalidation.

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| `pagosApi.deletePago(id)` signature change ripples to `PagosList` and any other call site | The signature becomes `deletePago({ id, proveedor_id })`; the only call site is `PagosList` (one consumer). Tests update in the same change. Type contract locked at compile time. |
| `facturasApi.deleteFactura(id)` signature change ripples to `FacturasList` | Same — one consumer, one update. |
| The `parseCuentaCorriente` parser is a new piece of glue code | The helper is small, co-located with the API module, fully unit-tested (parses each Decimal string and asserts `Number(x)` round-trip), and the type system enforces that the public response uses `number`. |
| Filter-on-response risks hiding data the user wants to see | Filters are explicit chips with a "Limpiar filtros" CTA. The empty state explains that filters are applied locally. The endpoint does not have query params to send, so this is the only way to filter the cuenta-corriente view. |
| A `factura_con_estado` row has a missing `fecha_vencimiento` (most common) and the date-range filter excludes it | The filter uses `fecha_emision`, not `fecha_vencimiento` — both are present on every row. Tests assert the filter targets the right field. |
| The supplier name in the header may lag the cuenta-corriente query on a cold load | Two parallel queries; the header skeleton shows a name placeholder until `useProveedor` resolves, the saldo skeleton shows a value placeholder until `useCuentaCorriente` resolves. The page does not block one on the other. |
| `useCuentaCorriente` re-fetches on every navigation back to the detail page | `staleTime: 0` is intentional: the cuenta-corriente reflects the latest state. A `placeholderData: keepPreviousData` shows the previous data instantly while revalidating. |
| `parseCuentaCorriente` parses the `Decimal` string at the boundary; if the backend ever sends `null` (it cannot, but defensively) the parser crashes | The parser asserts each field is a string before `Number()`; an MSW test asserts the parser throws a typed `Error` if the shape is wrong, and the hook surfaces it as `isError`. |
| `FacturaDeleteInput` / `PagoDeleteInput` are new types — a future contributor could forget to pass `proveedor_id` and silently lose the cache invalidation | A test in `cacheInvalidation.test.tsx` iterates over the six mutation hooks and asserts each one passes a `proveedor_id` to `invalidateQueries` for the cuenta-corriente key. The list call sites pass it explicitly. |
| The cuenta-corriente view shows `origen=IA` rows once C-14/C-15 land | The C-12 endpoint does not filter by `origen`; the view renders whatever the endpoint returns. When C-14/C-15 add IA rows, the view will include them automatically. No change needed in C-13. |
| The visual direction (Awwwards-tier) risks over-engineering for an MVP | The key tokens (color families, double-bezel card, asymmetric bento, motion) are documented in D11; the apply phase keeps the rest of the project (buttons, inputs) consistent. The hero is the saldo block; the tables follow the existing `FacturasList` rhythm. |
| `getTodayUTC3()` is not needed in this read-only view, but the design references it for future filters | The helper is imported in `FiltrosFacturas` only if a "fecha hasta" upper bound defaults to today; the default is empty (no upper bound) to keep the UX simple. The helper is referenced in the test for the default value. |
| `api.d.ts` extensions could conflict with the live `openapi-typescript` regenerate later | The header comment in `api.d.ts` documents the manual generation (same as C-04, C-09, C-11). When `npm run generate-types` is run against the live C-12 backend, the regenerated types should match the manual declarations; the `api.types.test-d.ts` guard file locks the contract. |

## Migration Plan

1. **Pre-flight (Safety Net)**: re-run the existing Vitest suite to capture a green baseline before any change.
2. **Types** (task 1): extend `api.d.ts` with `CuentaCorriente*` types + `FacturaDeleteInput` / `PagoDeleteInput` / `FiltrosFacturas`. Add `api.cuentaCorriente.test-d.ts` compile-time guard. Update `api.pagos.test.ts` to assert `PagoDeleteInput` has no `factura` key. **Pydantic → TS contract locked.**
3. **Data layer** (task 2): `cuentaCorrienteApi.ts` (raw Axios with the `parseCuentaCorriente` boundary) + `cuentaCorrienteHooks.ts` (`useCuentaCorriente`, `CUENTA_CORRIENTE_KEYS`) + `cuentaCorrienteHooks.test.tsx` (MSW: success / empty / 404 / loading).
4. **Atomic components** (tasks 3–5): `SaldoBadge`, `FiltrosFacturas`, `TablaFacturasConEstado`, `HistorialCronologico` — each TDD.
5. **Composition** (task 6): `CuentaCorrientePage` — composes the four components; TDD with fixtures.
6. **Integration** (task 7): `ProveedorDetailPage` — uses `useProveedor` + `useCuentaCorriente` + `CuentaCorrientePage` + action buttons; TDD with MSW.
7. **Cross-feature cache invalidation** (task 8): modify `facturasHooks.ts` and `pagosHooks.ts` to add `invalidateQueries({ queryKey: CUENTA_CORRIENTE_KEYS.detail(proveedorId) })` in every mutation. Change the `deleteFactura` / `deletePago` signatures to take `{ id, proveedor_id }`. Update `FacturasList` / `PagosList` call sites. Add `cacheInvalidation.test.tsx` regression test.
8. **Routing & nav** (task 9): add `/proveedores/:id` to `router.tsx`; add "Ver" link to `ProveedoresList`; add "Ver cuenta corriente" entry to the inlined `HomePage`; pre-fill `?proveedor_id=` in `FacturaFormPage` and `PagoFormPage`.
9. **Verification** (task 10): `tsc --noEmit` (strict, zero `any`); `vitest` (all green); `openspec validate`; manual smoke (optional Playwright: open proveedor → load cuenta-corriente → create factura → see saldo update).

Rollback: the change is additive and route-gated. Removing `/proveedores/:id` from `router.tsx` and the "Ver" link from `ProveedoresList` reverts the surface. The cache-invalidation additions are forward-compatible (extra invalidations are harmless). The `api.d.ts` extensions are additive (new types do not break existing consumers).

## Open Questions

- **Q-CC-FE-01 (🟢):** The "Ver cuenta corriente" home quick-access entry — should it route to `/proveedores` (the list, then user picks a supplier) or to a small "choose a supplier" picker? **Decision: route to `/proveedores` for MVP. The list already has a "Ver" link per row. A picker can be a follow-up if users complain.**
- **Q-CC-FE-02 (🟢):** The `?proveedor_id=` pre-fill on the create forms — should the form render the supplier as a chip (read-only) or as a fully interactive `SupplierSearch`? **Decision: chip + clear button. The supplier is pre-selected by the parent page; the user can clear it and pick a different one, but the default is the one they came from. Mirrors the C-11 `PagoForm` edit-mode behavior (supplier is read-only in edit, can be cleared to pick another).**
- **Q-CC-FE-03 (🟢):** Should the historial show the running `saldo_acumulado` next to each row, or only at the end? **Decision: every row, in its own column. This is the C-12 response shape (per-row `saldo_acumulado`); the table renders it as is. The user can see the evolution at a glance.**
- **Q-CC-FE-04 (🟡):** Visual direction is "Awwwards-tier" with the asymmetric bento. If the project wants a more conservative look (single column, plain tables, neutral palette), the design is straightforward to fall back to. **Recommend: ship the bento for the saldo block; the two tables can be plain tables. Decision: keep the bento for the saldo; tables follow the existing `FacturasList` rhythm (which is plain). Open question for the user at apply time.**
- **Q-CC-FE-05 (🟢):** When `useCuentaCorriente` returns 404 (foreign / soft-deleted / missing), should the page show "Proveedor no encontrado" or "No tenés permiso para ver este proveedor"? **Decision: "Proveedor no encontrado" — the C-12 contract is 404 (never 403), so the UI mirrors that ("the resource doesn't exist for you" is the same message either way). Defense against enumeration.**
- **Q-CC-FE-06 (🟢):** Decimal precision in the `parseCuentaCorriente` boundary — does `Number("1234.56")` round-trip exactly? **Decision: yes, for amounts up to ~10^15 with 2 decimal places (well within `Number.MAX_SAFE_INTEGER` and the project's `numeric(12,2)`). A test asserts round-trip for boundary values (0, 0.01, -0.01, 99999999.99, -99999999.99).**
