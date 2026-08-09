# Cuenta Corriente Backend Specification

## Purpose

New capability: read-only HTTP endpoint that returns, per supplier, the on-demand `{ saldo, facturas_con_estado, historial }` triple composing the cuenta corriente. Builds on top of the `FacturaService._compute_estado_fifo` algorithm (C-08), the `PagoRepository.list_by_proveedor` active pago list (C-10 / C-06), and the `ProveedorRepository.get_saldo_por_proveedor` aggregate (C-06). The capability enforces RN-SALDO (sign convention: positive=deuda, zero=al día, negative=a favor), RN-FIFO (PENDIENTE / PARCIAL / PAGADA, deterministic ordering), and RN-HIST (chronological merge of facturas as debe and pagos as haber, with row-by-row `saldo_acumulado`). All computation is on-demand in the service layer; nothing derived is persisted.

> **Actualizado por C-28 (D-27):** el eje de aislamiento de esta capability pasó de `usuario_id` a `negocio_id`. Las referencias a `usuario_id` que quedan arriba describen migraciones históricas (los índices que existieron hasta la revisión 0005) y se conservan como registro; la migración 0006 los reemplazó por sus equivalentes liderados por `negocio_id`. Ver la capability `negocio-scoping`.
## Requirements
### Requirement: Cuenta-corriente endpoint returns the triple per supplier

The system SHALL expose `GET /api/proveedores/{proveedor_id}/cuenta-corriente` returning a JSON document with three blocks: `saldo` (Decimal, signed: `>0` deuda, `=0` al día, `<0` a favor), `facturas_con_estado` (a list of the supplier's active invoices, each annotated with its FIFO-computed `estado` of `PENDIENTE` / `PARCIAL` / `PAGADA`), and `historial` (a chronologically-merged list of the supplier's active invoices as `FACTURA` rows and active payments as `PAGO` rows, ordered by `(fecha ASC, created_at ASC, id ASC)`, with a `saldo_acumulado` field on every entry reflecting the running balance at that row). The endpoint SHALL require a valid authenticated session and SHALL reject deactivated users with 401. The endpoint SHALL return 404 if the supplier does not exist, is soft-deleted, or belongs to a different **negocio** — never 403. The endpoint SHALL NOT persist any derived value. The endpoint SHALL have no request body and no query parameters.

#### Scenario: supplier with invoices and payments returns the full triple

- **WHEN** an authenticated user requests `GET /api/proveedores/{proveedor_id}/cuenta-corriente` for a supplier of their negocio that has both active invoices and active payments
- **THEN** the response contains `saldo`, `facturas_con_estado` with a FIFO `estado` per invoice, and `historial` with `saldo_acumulado` on every row

#### Scenario: supplier with no movements returns an empty triple

- **WHEN** an authenticated user requests the endpoint for a supplier of their negocio that has no active invoices and no active payments
- **THEN** the response contains `saldo = 0.00` and empty `facturas_con_estado` and `historial` lists

#### Scenario: unauthenticated request rejected

- **WHEN** the endpoint is reached without a valid session cookie
- **THEN** the response is 401 Unauthorized

#### Scenario: deactivated user rejected

- **WHEN** the endpoint is reached with a valid token belonging to a user with `desactivado = true`
- **THEN** the response is 401 Unauthorized

#### Scenario: foreign supplier returns 404

- **WHEN** an authenticated user requests the endpoint for a supplier that belongs to a different negocio
- **THEN** the response is 404 Not Found and no data from the foreign supplier is leaked

#### Scenario: soft-deleted supplier returns 404

- **WHEN** an authenticated user requests the endpoint for a supplier of their negocio that has been soft-deleted
- **THEN** the response is 404 Not Found

#### Scenario: missing supplier returns 404

- **WHEN** an authenticated user requests the endpoint for a non-existent supplier id
- **THEN** the response is 404 Not Found
### Requirement: Saldo computed on-demand via the supplier aggregate (RN-SALDO)

`saldo` SHALL be computed as `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)` for the requested supplier, in a single aggregate query — never one query per factura or per pago (no N+1). The `saldo` SHALL NOT be read from or written to any persisted column on `proveedor` (or anywhere else). The sign convention SHALL be: positive = deuda (you owe the supplier), zero = al día (settled), negative = saldo a favor (the supplier owes you). The implementation SHALL reuse the existing `ProveedorRepository.get_saldo_por_proveedor` aggregate.

#### Scenario: saldo positive when facturas exceed pagos

- **WHEN** the supplier's active invoices sum to more than the supplier's active payments
- **THEN** the returned `saldo` is positive (deuda)

#### Scenario: saldo zero when facturas equal pagos

- **WHEN** the supplier's active invoices sum equals the supplier's active payments
- **THEN** the returned `saldo` is `0.00` (al día)

#### Scenario: saldo negative when pagos exceed facturas

- **WHEN** the supplier's active payments sum to more than the supplier's active invoices
- **THEN** the returned `saldo` is negative (saldo a favor)

#### Scenario: saldo computed in one aggregate query

- **WHEN** the endpoint is called for a supplier with N active invoices and M active payments
- **THEN** the `saldo` is produced by a single `SUM` aggregate query, not by iterating over each row

#### Scenario: saldo is never persisted

- **WHEN** the endpoint is called repeatedly for the same supplier
- **THEN** no `saldo` value is written to the `proveedor` table (or anywhere else) — the value is recomputed each call

### Requirement: FIFO estado assigned per factura (RN-FIFO)

Every active invoice in `facturas_con_estado` SHALL carry an `estado` field of `PENDIENTE`, `PARCIAL`, or `PAGADA` computed by the FIFO algorithm (RN-FIFO). The FIFO pool SHALL be the sum of the supplier's **active** payments (soft-deleted pagos excluded). The algoritmo SHALL be the same `_compute_estado_fifo` function used by `FacturaService` (C-08), and SHALL be reused — not duplicated. The `estado` SHALL NOT be read from or written to any persisted column on `factura`. The order of application SHALL be `(fecha_emision ASC, created_at ASC, id ASC)`, and the order SHALL be deterministic across calls.

#### Scenario: zero pool maps every factura to PENDIENTE

- **WHEN** the supplier has active invoices and zero active payments
- **THEN** every entry in `facturas_con_estado` has `estado = PENDIENTE`

#### Scenario: pool covers all facturas → all PAGADA

- **WHEN** the active pago pool is greater than or equal to the sum of the supplier's active invoice totals
- **THEN** every entry in `facturas_con_estado` has `estado = PAGADA`

#### Scenario: pool exactly equal to one factura → PAGADA, not PARCIAL

- **WHEN** the active pago pool equals exactly the `monto_total` of a single factura
- **THEN** that factura is `PAGADA` (the boundary is inclusive)

#### Scenario: partial pool produces a waterfall PAGADA → PARCIAL → PENDIENTE

- **WHEN** the active pago pool is between the total of the first factura and the sum of all facturas
- **THEN** the oldest facturas are `PAGADA`, the first factura whose total is partially covered is `PARCIAL`, and any later factura is `PENDIENTE` — in that order

#### Scenario: estado is never persisted on the factura row

- **WHEN** the endpoint is called and a factura is shown as `PARCIAL`
- **THEN** the underlying `factura` table has no `estado` column and no `estado` value is written

#### Scenario: FIFO ordering is deterministic under identical fecha_emision

- **WHEN** two or more facturas share the same `fecha_emision`
- **THEN** they are ordered by `created_at` ASC, and ties are broken by `id` ASC — the same order is produced on every call

### Requirement: Historial merges facturas and pagos chronologically (RN-HIST)

`historial` SHALL be a list whose elements are either `{ tipo: "FACTURA", id, fecha, monto, saldo_acumulado, archivo_url }` or `{ tipo: "PAGO", id, fecha, monto, saldo_acumulado, archivo_url }`. Facturas appear as `FACTURA` rows with `monto = factura.monto_total` and `archivo_url = factura.archivo_url`; pagos appear as `PAGO` rows with `monto = pago.monto` and `archivo_url = pago.comprobante_url`. `archivo_url` SHALL be `None` when the underlying row has no file attached — no new upload capability is introduced by this field, it only threads through an already-persisted value. The list SHALL be ordered by `(fecha ASC, created_at ASC, id ASC)`. The `saldo_acumulado` field SHALL be the running sum at each row, where facturas add (debe) and pagos subtract (haber). The sign convention SHALL match `saldo` (positive = deuda). The `saldo_acumulado` of the **last** row SHALL equal the `saldo` of the response.

#### Scenario: empty historial for a supplier with no movimientos

- **WHEN** the supplier has no active invoices and no active payments
- **THEN** `historial = []` and `saldo = 0.00`

#### Scenario: historial with one factura

- **WHEN** the supplier has exactly one active invoice of 1500.00 and no payments
- **THEN** `historial` has one entry: `{ tipo: "FACTURA", monto: 1500.00, saldo_acumulado: 1500.00 }` and `saldo = 1500.00`

#### Scenario: historial with one pago (saldo a favor)

- **WHEN** the supplier has no active invoices and one active payment of 500.00
- **THEN** `historial` has one entry: `{ tipo: "PAGO", monto: 500.00, saldo_acumulado: -500.00 }` and `saldo = -500.00` (negative: saldo a favor)

#### Scenario: mixed facturas and pagos in chronological order

- **WHEN** the supplier has facturas on dates 2026-06-10 (1000) and 2026-06-20 (500) and a pago on 2026-06-15 (300)
- **THEN** `historial` is `[FACTURA 1000 (saldo 1000), PAGO 300 (saldo 700), FACTURA 500 (saldo 1200)]` and `saldo = 1200.00`

#### Scenario: end-of-historial saldo_acumulado equals saldo

- **WHEN** the endpoint returns a non-empty `historial`
- **THEN** `historial[-1].saldo_acumulado == saldo` (the running balance at the last row equals the aggregate balance)

#### Scenario: facturas and pagos on the same date are merged by created_at

- **WHEN** a factura and a pago share the same `fecha` and `fecha_emision`
- **THEN** the row with the earlier `created_at` (and then the earlier `id`) appears first in `historial`

#### Scenario: the id field on a historial entry points to the underlying row

- **WHEN** a `historial` entry has `tipo = FACTURA`
- **THEN** its `id` equals the corresponding `factura.id`; analogously for `PAGO` entries (id == `pago.id`)

#### Scenario: a FACTURA row carries the factura's archivo_url

- **WHEN** a `historial` entry has `tipo = FACTURA` and the underlying factura has `archivo_url = "https://res.cloudinary.com/demo/facturas/x.pdf"`
- **THEN** the entry's `archivo_url` equals that value

#### Scenario: a PAGO row carries the pago's comprobante_url as archivo_url

- **WHEN** a `historial` entry has `tipo = PAGO` and the underlying pago has `comprobante_url = "https://res.cloudinary.com/demo/comprobantes/y.jpg"`
- **THEN** the entry's `archivo_url` equals that value

#### Scenario: a row with no attached file has archivo_url = None

- **WHEN** the underlying factura or pago has no file attached (`archivo_url` / `comprobante_url` is `None`)
- **THEN** the corresponding `historial` entry has `archivo_url = None`

### Requirement: Service-layer authorization — 404 on foreign supplier

All authorization checks SHALL live exclusively in the service layer (`ProveedorService`). The router SHALL NOT contain ownership logic. When the requested supplier does not belong to the authenticated caller's **negocio**, the service SHALL raise HTTP 404 (not 403) — foreign resources are indistinguishable from non-existent ones to prevent enumeration. The same 404 SHALL be returned for missing suppliers and for the negocio's own suppliers that have been soft-deleted. A supplier belonging to the caller's negocio SHALL be accessible regardless of which user of that negocio created it.

#### Scenario: cross-negocio isolation on the cuenta-corriente endpoint

- **WHEN** a user of negocio B requests the cuenta-corriente of a supplier belonging to negocio A
- **THEN** the response is 404 Not Found and no data from negocio A is leaked

#### Scenario: soft-deleted supplier of the caller's own negocio returns 404

- **WHEN** a user requests the cuenta-corriente of a supplier of their negocio that has been soft-deleted
- **THEN** the response is 404 Not Found

#### Scenario: a teammate's supplier is accessible

- **WHEN** a user requests the cuenta-corriente of a supplier created by another user of the same negocio
- **THEN** the response is 200 and contains the supplier's `saldo`, `facturas_con_estado` and `historial`

### Requirement: No derived data is persisted

The `proveedor` table SHALL NOT have a `saldo` column. The `factura` table SHALL NOT have an `estado` column. The endpoint SHALL NOT write any value to the database as a side effect of computing the triple — the implementation SHALL NOT issue any INSERT, UPDATE, or DELETE in the service or router. Every value in the response is recomputed from the active `Factura` and `Pago` rows on every call.

#### Scenario: proveedor table has no saldo column

- **WHEN** the `proveedor` table is introspected after the change
- **THEN** it has no `saldo` column (the value is computed on demand)

#### Scenario: factura table has no estado column

- **WHEN** the `factura` table is introspected after the change
- **THEN** it has no `estado` column (the value is computed on demand)

#### Scenario: endpoint issues no mutations

- **WHEN** the endpoint is called
- **THEN** no `INSERT` / `UPDATE` / `DELETE` is issued against any table (verified by a logging assertion in the test)

### Requirement: Pydantic response schema shape

The response SHALL conform to the `CuentaCorrienteResponse` shape with `proveedor_id` (UUID), `saldo` (Decimal, signed), `facturas_con_estado` (list of `FacturaConEstado`), and `historial` (list of `EntradaHistorial`). `FacturaConEstado` SHALL mirror `FacturaResponse` from C-08 with `items` and `items_sum_mismatch` omitted, plus an `estado: EstadoFactura` field (PENDIENTE / PARCIAL / PAGADA). `EntradaHistorial` SHALL have `id` (UUID), `tipo` (`Literal["FACTURA", "PAGO"]`), `fecha` (date), `monto` (Decimal, always positive), `saldo_acumulado` (Decimal, signed), and `archivo_url` (`Optional[str]`, default `None`). The schemas are output-only; the endpoint has no request body, so no input schema is required. No Alembic migration is required for `archivo_url` — it is sourced from the already-persisted `Factura.archivo_url` and `Pago.comprobante_url` columns.

#### Scenario: CuentaCorrienteResponse has the four required fields

- **WHEN** the response is parsed
- **THEN** it contains `proveedor_id` (UUID), `saldo` (Decimal string), `facturas_con_estado` (list), and `historial` (list)

#### Scenario: FacturaConEstado has estado and no items

- **WHEN** a `FacturaConEstado` is parsed
- **THEN** it has `id`, `proveedor_id`, `fecha_emision`, `monto_total`, `origen`, `estado` (one of PENDIENTE / PARCIAL / PAGADA), and the standard timestamps; it does NOT have an `items` field and does NOT have an `items_sum_mismatch` field

#### Scenario: EntradaHistorial has tipo, saldo_acumulado, and an optional archivo_url

- **WHEN** an `EntradaHistorial` is parsed
- **THEN** it has `id` (UUID), `tipo` (string, exactly "FACTURA" or "PAGO"), `fecha` (date), `monto` (Decimal, positive), `saldo_acumulado` (Decimal, signed), and `archivo_url` (string or `None`, defaulting to `None` when omitted)

### Requirement: Endpoint requires authentication and uses a thin router

The endpoint SHALL be wired with `Depends(get_current_user)` and `Depends(get_db)`. The router SHALL be a thin wrapper: it SHALL resolve the dependency, call `ProveedorService.get_cuenta_corriente(current_user.id, proveedor_id)`, and map the result to `CuentaCorrienteResponse`. The router SHALL NOT perform any ownership check, validation, ordering, or computation. The router SHALL NOT call `session.commit()` (the endpoint is read-only).

#### Scenario: unauthenticated request returns 401

- **WHEN** the request has no `access_token` cookie
- **THEN** the response is 401 Unauthorized before the service is invoked

#### Scenario: the router does not commit

- **WHEN** the endpoint is called
- **THEN** no `session.commit()` is invoked (read-only operation)

</content>

