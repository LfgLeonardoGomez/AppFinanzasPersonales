## MODIFIED Requirements

### Requirement: TablaFacturasConEstado shows the FIFO estado and filters on response fields

The frontend SHALL render the `facturas_con_estado` array via a `TablaFacturasConEstado` component that receives the array, a filter state, and a filter-change callback as props. The component SHALL render a table with one row per factura and SHALL display the existing `EstadoBadge` from C-09 (PENDIENTE / PARCIAL / PAGADA) per row. The component SHALL accept filters `{ estado?: 'PENDIENTE' | 'PARCIAL' | 'PAGADA'; fecha_desde?: string; fecha_hasta?: string }` applied on the response payload fields (`f.estado` and `f.fecha_emision`) — the component SHALL NOT re-issue the cuenta-corriente request with new params (the endpoint has no query params; the filters are client-side). When the filtered result is empty, the component SHALL render "No hay facturas con esos filtros" and a "Limpiar filtros" button. The `FiltrosFacturas` sub-component SHALL render three controls: an `estado` select (with the four options `Todos / PENDIENTE / PARCIAL / PAGADA`), a `fecha_desde` date input, and a `fecha_hasta` date input. When a row's `archivo_url` is present, the component SHALL render a "Ver archivo" **button** (not a link) that opens the shared `ArchivoPreviewDialog` (see the `archivo-viewer` capability) with that URL — the file is previewed in-app rather than opened in a new browser tab.

#### Scenario: table renders one row per factura with the response estado

- **WHEN** `TablaFacturasConEstado` receives a `facturas` array of N items and `filters = {}`
- **THEN** the table renders N rows, each with the `estado` shown via `EstadoBadge` matching the row's `estado` field — no row has a different badge than what the response provides

#### Scenario: estado filter narrows the rendered rows on the response field

- **WHEN** the user selects `estado = PENDIENTE` and the response includes a mix of PENDIENTE / PARCIAL / PAGADA rows
- **THEN** only the rows whose `estado === 'PENDIENTE'` are rendered, and the new filter is applied on the response payload (no HTTP request is made)

#### Scenario: fecha range filter narrows the rendered rows

- **WHEN** the user selects `fecha_desde = '2026-06-01'` and `fecha_hasta = '2026-06-30'` and the response includes rows with `fecha_emision` inside and outside that range
- **THEN** only the rows whose `fecha_emision` is inside the range are rendered, and no HTTP request is made

#### Scenario: combined filters compose

- **WHEN** the user selects `estado = PARCIAL` and a fecha range
- **THEN** only the rows that satisfy both filters are rendered

#### Scenario: empty filtered result shows the "no hay facturas" state with a "Limpiar filtros" CTA

- **WHEN** the current filter combination yields zero rows
- **THEN** the component renders "No hay facturas con esos filtros" and a "Limpiar filtros" button that resets the filter state to `{}`

#### Scenario: "Ver archivo" opens the in-app preview instead of a new tab

- **WHEN** a row's `archivo_url` is present and the user clicks "Ver archivo"
- **THEN** the `ArchivoPreviewDialog` opens with that row's `archivo_url` — no `<a target="_blank">` navigation occurs

### Requirement: HistorialCronologico shows the chronological merge with saldo_acumulado per row

The frontend SHALL render the `historial` array via a `HistorialCronologico` component that receives the array as a prop, in the order it is given (the component itself performs no sorting or reordering — it is a dumb renderer). Each row SHALL display: `fecha` (formatted), a `tipo` chip (red "Debe" for `FACTURA`, blue "Haber" for `PAGO`), the absolute `monto` formatted as ARS, and the signed `saldo_acumulado` formatted as ARS with a sign prefix (`+`, `−`, or no prefix for zero). The component SHALL NOT walk the array, SHALL NOT split between debe and haber, and SHALL NOT compute a running sum — all numeric values are read from the entries it is given. The `monto` field in the response is always positive; the sign comes from `tipo`.

The parent `CuentaCorrientePage` SHALL own a display-order toggle (`asc` | `desc`, default `desc` — newest first) rendered as a control near the "Historial cronológico" heading. Selecting a direction SHALL produce the array passed to `HistorialCronologico` by reversing a **copy** of the response's `historial` array when `desc` is selected (the response itself is `asc` — see `cuenta-corriente-backend`'s RN-HIST ordering, which is unchanged and MUST NOT be re-derived or re-sorted by value). The reversal SHALL NOT recompute, re-sort by `fecha`/`monto`, or otherwise alter any `saldo_acumulado` value — the per-row values are read from the response verbatim regardless of display order. The `saldo_acumulado` of the row that is chronologically last (i.e., the response's last entry, wherever it lands in the displayed order) SHALL still equal the response's top-level `saldo`.

#### Scenario: historial renders rows in the order it receives, with tipo chips

- **WHEN** `HistorialCronologico` receives a non-empty `historial` array
- **THEN** one row is rendered per entry, in the exact order of the array it received, with the `tipo` chip ("Debe" for FACTURA, "Haber" for PAGO) and the absolute `monto` formatted as ARS

#### Scenario: saldo_acumulado is rendered with a sign prefix and ARS format

- **WHEN** a row has `saldo_acumulado = 1500.00`
- **THEN** the rendered text is `+` followed by the ARS-formatted absolute value; for `saldo_acumulado = -300.00` the rendered text is `−` followed by the ARS-formatted absolute value; for `saldo_acumulado = 0` no sign prefix is rendered

#### Scenario: default display order is newest-first

- **WHEN** `CuentaCorrientePage` renders the Historial tab for the first time
- **THEN** the row corresponding to the response's last (`historial[historial.length - 1]`) entry is rendered first, and its `saldo_acumulado` matches the `SaldoBadge` value rendered in the page header

#### Scenario: toggling to oldest-first restores the response order

- **WHEN** the user switches the toggle from `desc` to `asc`
- **THEN** `HistorialCronologico` receives the array in the exact order the response provided (no re-sorting), and the last rendered row's `saldo_acumulado` matches the `SaldoBadge` value

#### Scenario: reversal for display does not alter any saldo_acumulado value

- **WHEN** the toggle is `desc` and the response has three entries with distinct `saldo_acumulado` values
- **THEN** every rendered row shows the exact `saldo_acumulado` value its corresponding response entry carries — none of the three values differ from what `asc` mode renders for the same entry, only the row order differs

#### Scenario: empty historial shows the "sin movimientos" empty state

- **WHEN** the response has `historial = []`
- **THEN** the component renders "Sin movimientos registrados" and no table rows, regardless of the toggle state

## ADDED Requirements

### Requirement: PagosRegistrados shows an in-app Archivo preview

The "Pagos" tab (`PagosRegistrados`) SHALL render an "Archivo" column derived from the same `historial` entries it already receives (filtered to `tipo === 'PAGO'` by the parent, unchanged). When an entry's `archivo_url` is present, the cell SHALL render a "Ver archivo" button that opens the shared `ArchivoPreviewDialog` (see the `archivo-viewer` capability) with that URL. When absent, the cell SHALL render the table's existing "—" placeholder convention. This closes the gap where a payment's uploaded comprobante (`Pago.comprobante_url`, always persisted at upload time) was invisible in the cuenta-corriente view.

#### Scenario: a pago row with a comprobante shows a working preview trigger

- **WHEN** `PagosRegistrados` renders a row whose `archivo_url` is a non-null URL
- **THEN** the Archivo cell shows a "Ver archivo" button; clicking it opens `ArchivoPreviewDialog` with that URL

#### Scenario: a pago row without a comprobante shows the placeholder, not a broken control

- **WHEN** `PagosRegistrados` renders a row whose `archivo_url` is `null`
- **THEN** the Archivo cell shows "—" and no button is rendered
