# cuenta-corriente-clientes-backend Specification

## Purpose

Tell the shop what each customer owes (shipped by C-35) — the read side of the fiado that C-33 made recordable. It closes the loop: a sale on account creates a debt, a `CobroCliente` cancels it, and the balance in between is derived, never stored.

The structural decision: this ledger is the **mirror** of the supplier one, not a second implementation of it. `Proveedor : Factura : Pago` and `Cliente : Venta fiada : CobroCliente` are the same shape with the sign flipped, so the FIFO allocation and the chronological merge were extracted into `cuenta_corriente_engine` and both sides call it (D-57). What silently drifts between two copies is exactly what gives no symptom — the tie-break, the boundary at `applied == monto`, a rounding — and the day two screens disagree nobody can say which one is right.

Owns `CobroCliente` and its `MetodoCobro`, which has no credit method because debt is not cancelled with debt; the payment-never-exceeds-balance rule, enforced in the service layer because it spans two tables (RN-CCC-04); the on-demand read `GET /api/clientes/{cliente_id}/cuenta-corriente` returning balance, fiados with derived state and running-balance history; the customer balance in the listing via one aggregate query; and migration `0011`.

Two consequences worth carrying forward: the balance is **signed and can go negative** — deleting a fiado or moving a sale out of `CUENTA_CORRIENTE` (D-54) removes a charge from a customer already credited, and reporting the real figure beats hiding money the shop cannot account for (D-58); and a payment attaches to the **customer**, never to a sale — which fiado it settles is derived at read time and never persisted (RN-CCC-03).

NOT here: the UI for any of it (C-36), aggregations by period (C-37), and reminders, interest or credit limits — the ledger records what happened, it does not chase it.

## Requirements

### Requirement: A customer payment attaches to the customer, never to a sale

The system SHALL define a `CobroCliente` model (table `cobro_cliente`) with `negocio_id` (FK, required), `cliente_id` (FK → `cliente`, **required**), `monto` (numeric(12,2)), `fecha` (date), `metodo` (enum `MetodoCobro`), `comprobante_url` (nullable), `creado_por_usuario_id` (FK → `usuario`, nullable) and `deleted_at` (soft delete), plus the base mixin.

`MetodoCobro` SHALL be `EFECTIVO`, `TRANSFERENCIA`, `TARJETA` or `OTRO`. It SHALL NOT include a credit method: debt is not cancelled with debt.

The model SHALL NOT have a `venta_id` column (RN-CCC-03). Which sales a payment settles is derived at read time by FIFO and is never stored — the same rule that governs `Pago` on the supplier side (RN-PAG-01).

The model SHALL NOT have a `saldo` or an `estado` column (D-01).

#### Scenario: a payment is recorded against the customer

- **WHEN** a payment is recorded for a customer of the negocio with a positive amount and a non-future date
- **THEN** it is persisted with that `cliente_id` and the session's authorship, and no sale is referenced

#### Scenario: the schema has no link between payment and sale

- **WHEN** the `cobro_cliente` table is inspected
- **THEN** there is no `venta_id` column and no foreign key to `venta`

#### Scenario: no derived value is stored

- **WHEN** the `cobro_cliente` table is inspected
- **THEN** there is no `saldo` and no `estado` column

#### Scenario: a payment cannot be made on account

- **WHEN** the `MetodoCobro` enum is inspected
- **THEN** it contains exactly `EFECTIVO`, `TRANSFERENCIA`, `TARJETA` and `OTRO`

### Requirement: A payment must never exceed the outstanding balance

The system SHALL reject a payment whose amount would drive the customer's balance below zero (RN-CCC-04). The check SHALL live in the **service layer** — it spans two tables and many rows, so it is not expressible as a row constraint.

Available balance SHALL be computed as `SUM(fiados activos) − SUM(cobros activos)`, **excluding the payment being edited** when the operation is an update. Without that exclusion, raising an existing payment by any amount would be compared against a balance that already contains its old value and would be rejected as if the whole new amount were additional.

The rule SHALL apply on creation **and** on update. Enforcing it only on creation would leave a payment of any size reachable through a subsequent edit.

Rejection SHALL be reported with an unprocessable-entity status and a message stating the remaining balance, so the amount can be corrected rather than guessed.

#### Scenario: payment above the balance is rejected

- **WHEN** a customer owes $1.000 and a payment of $1.500 is recorded
- **THEN** the operation is rejected, nothing is persisted, and the message states the outstanding balance

#### Scenario: payment exactly equal to the balance is accepted

- **WHEN** a customer owes $1.000 and a payment of $1.000 is recorded
- **THEN** it is accepted and the customer's balance becomes zero

#### Scenario: raising an existing payment is judged on the difference

- **WHEN** a customer owes $1.000 in charges, has one payment of $400 recorded, and that payment is edited to $600
- **THEN** the edit is accepted, because the balance available to it excludes its own previous $400

#### Scenario: raising an existing payment beyond the charges is rejected

- **WHEN** a customer owes $1.000 in charges, has one payment of $400, and that payment is edited to $1.200
- **THEN** the edit is rejected and the stored payment keeps its previous amount

#### Scenario: a payment for a customer with no charges is rejected

- **WHEN** a payment is recorded for a customer who has no live fiados
- **THEN** the operation is rejected

### Requirement: The customer balance is computed on demand and never stored

The system SHALL compute a customer's balance as `SUM(ventas fiadas activas.monto) − SUM(cobros activos.monto)` (RN-CCC-01), where "active" means `deleted_at IS NULL` on both sides and a fiado is a `Venta` with `forma_pago = CUENTA_CORRIENTE` and that `cliente_id`.

The balance SHALL be computed at read time on every request and SHALL NOT be persisted anywhere (D-01).

The balance SHALL be a **signed** value. A positive balance means the customer owes money. Although RN-CCC-04 prevents a payment from creating a negative balance, deleting a fiado or moving a sale out of `CUENTA_CORRIENTE` (D-54) removes a charge from a customer who was already credited, so a negative balance remains reachable. The system SHALL report the real figure rather than clamping it at zero: a balance that hides money the shop cannot account for is worse than one that surprises.

#### Scenario: balance over mixed data

- **WHEN** a customer has three live fiados, one deleted fiado, two live payments and one deleted payment
- **THEN** the balance counts only the live rows on both sides

#### Scenario: cash sales do not enter the balance

- **WHEN** the same customer's negocio also has sales with `forma_pago = EFECTIVO`
- **THEN** those sales do not affect any customer's balance, since only fiados are charges

#### Scenario: a customer with no movements

- **WHEN** the current account of a customer with no fiados and no payments is read
- **THEN** the balance is `0.00` and both lists are empty

#### Scenario: deleting a fiado after it was paid leaves a negative balance visible

- **WHEN** a customer's only $1.000 fiado is paid in full and that fiado is then soft-deleted
- **THEN** the reported balance is `-1000.00` rather than `0.00`

### Requirement: The state of each fiado is derived by deterministic FIFO

The system SHALL derive the state of each live fiado (`PENDIENTE` / `PARCIAL` / `COBRADA`) by allocating the pool of the customer's live payments over their fiados, oldest first (RN-CCC-02):

```
fiados = live CUENTA_CORRIENTE sales of the customer, ordered by (fecha ASC, created_at ASC, id ASC)
pool   = SUM(monto of the customer's live payments)   # all of them, regardless of date
for each fiado:
    applied = min(pool, fiado.monto)
    pool   -= applied
    applied == 0              → PENDIENTE
    0 < applied < monto       → PARCIAL
    applied >= monto          → COBRADA
```

The tie-break `(created_at, id)` SHALL make the order deterministic when two fiados share a date (RN-FIFO-01). Payments SHALL be allocated by total pool amount, not by their individual dates; a payment's date is informative (RN-FIFO-02).

The state SHALL NEVER be persisted. It is expected that recording, editing or deleting one fiado or one payment changes the state of **several** fiados at once, because the pool is reallocated (RN-FIFO-03).

The enum SHALL be `EstadoVentaFiada` with values `PENDIENTE`, `PARCIAL`, `COBRADA` — a customer's sale reported as `PAGADA` would read as though the shop had paid it.

#### Scenario: partial payment leaves the fiado PARCIAL

- **WHEN** a customer has one $1.000 fiado and one $400 payment
- **THEN** that fiado is reported `PARCIAL`

#### Scenario: the pool settles the oldest first

- **WHEN** a customer has fiados of $500, $500 and $500 in chronological order, and $700 in payments
- **THEN** the first is `COBRADA`, the second is `PARCIAL` and the third is `PENDIENTE`

#### Scenario: same-date fiados resolve in a stable order

- **WHEN** two fiados share the same `fecha` and the payment pool covers only one of them
- **THEN** the one with the earlier `created_at` (and, on a tie, the lower `id`) is the one settled, on every read

#### Scenario: a later payment still settles the oldest charge

- **WHEN** a customer's oldest fiado is from January and the only payment was recorded in March
- **THEN** the January fiado is the one the payment is applied to, because allocation is by amount and not by date

#### Scenario: a new payment changes several states at once

- **WHEN** a customer with three `PENDIENTE` fiados receives one payment covering the first two
- **THEN** both become settled in the same read, without any stored state having been updated

### Requirement: The current account is exposed as one on-demand read

The system SHALL expose `GET /api/clientes/{cliente_id}/cuenta-corriente`, returning `cliente_id`, `saldo`, `ventas_con_estado` and `historial`, all composed at request time with no persistence and no write.

The route SHALL mirror the supplier equivalent `GET /api/proveedores/{proveedor_id}/cuenta-corriente`, so the two ledgers are one concept in the generated client rather than two unrelated shapes.

A customer belonging to another negocio, soft-deleted, or non-existent SHALL yield **404** and never 403, so the response cannot be used to discover that the customer exists (D-06).

#### Scenario: the triple is returned together

- **WHEN** the current account of a customer with fiados and payments is requested
- **THEN** the response carries the balance, every live fiado with its state, and the chronological history

#### Scenario: a customer of another negocio is indistinguishable from a missing one

- **WHEN** the current account is requested for a customer id belonging to a different negocio
- **THEN** the response is 404 with no detail revealing that the customer exists

#### Scenario: the read persists nothing

- **WHEN** the same current account is requested twice with no intervening writes
- **THEN** both responses are identical and no row was created or updated

#### Scenario: unauthenticated access is refused

- **WHEN** the current account is requested with no session
- **THEN** the response is 401

### Requirement: The history is chronological with a running balance per row

The system SHALL return `historial` as a merge of the customer's live fiados (debit) and live payments (credit), ordered `(fecha ASC, created_at ASC, id ASC)`, where each row carries `id`, `tipo`, `fecha`, `monto`, `saldo_acumulado` and `archivo_url` (RN-CCC-05, RN-HIST).

`tipo` SHALL be `VENTA` for a charge or `COBRO` for a credit. `monto` SHALL always be positive — the sign is implicit in `tipo`. `saldo_acumulado` SHALL be signed and SHALL equal the sum of the charges minus the sum of the credits up to and including that row.

`archivo_url` SHALL be one flat field regardless of `tipo`, so the response is self-sufficient and a consumer does not branch on `tipo` to find the attachment. For a `COBRO` row it is the payment's `comprobante_url`; a `VENTA` row has no attachment today and SHALL report `null`.

The history is a different view from the FIFO state, not a restatement of it: it shows how the debt evolved over time, while the FIFO state shows what is outstanding now. Both SHALL be computed at read time.

#### Scenario: running balance accumulates across both kinds of rows

- **WHEN** a customer has a $1.000 fiado, then a $400 payment, then a $500 fiado
- **THEN** the rows report `saldo_acumulado` of `1000.00`, `600.00` and `1100.00` in that order

#### Scenario: same-date rows are ordered deterministically

- **WHEN** a fiado and a payment share the same `fecha`
- **THEN** the tie is broken by `created_at` and then `id`, and the order is the same on every read

#### Scenario: deleted rows do not appear

- **WHEN** a customer has one soft-deleted fiado and one soft-deleted payment
- **THEN** neither appears in the history and neither affects any `saldo_acumulado`

#### Scenario: a payment's receipt is reachable from its row

- **WHEN** a payment was recorded with a `comprobante_url`
- **THEN** its history row exposes that URL in `archivo_url`

### Requirement: Payment CRUD is isolated by negocio

The system SHALL expose CRUD for payments at `/api/cobros`, scoped by the `negocio_id` of the authenticated user, with an optional `cliente_id` filter on the listing.

Every read and write SHALL be authorized in the **service layer** by `negocio_id`. A payment, or a `cliente_id` filter, belonging to another negocio SHALL yield **404**, never 403 (D-06). The system SHALL NOT use `usuario_id` as a scoping filter anywhere; `creado_por_usuario_id` records authorship and SHALL NEVER be used to authorize.

`negocio_id` and `creado_por_usuario_id` SHALL come from the session and SHALL NOT be accepted from the request payload.

Deletion SHALL be a soft delete. A deleted payment SHALL immediately stop counting toward the balance, the FIFO pool and the history.

`cliente_id` SHALL NOT be modifiable through a partial update. Moving a payment between customers rewrites two balances in one request — one of which the caller never named, and which the move can drive negative. The correction is to delete and re-record.

`monto` SHALL be greater than zero and `fecha` SHALL NOT be in the future in `America/Argentina/Buenos_Aires`, validated by Pydantic **and** re-validated in the service layer.

#### Scenario: a payment of another negocio is invisible

- **WHEN** a payment id belonging to another negocio is read, updated or deleted
- **THEN** the response is 404 in all three cases

#### Scenario: a foreign customer filter does not confirm the customer exists

- **WHEN** the payment listing is filtered by a `cliente_id` from another negocio
- **THEN** the response is 404 rather than an empty list

#### Scenario: the payload cannot choose the negocio

- **WHEN** a create request includes a `negocio_id` or a `creado_por_usuario_id`
- **THEN** the request is rejected and no row is created with a caller-supplied owner

#### Scenario: two members of the same negocio share the data

- **WHEN** one member records a payment and another member of the same negocio lists payments
- **THEN** the second member sees it

#### Scenario: deleting a payment restores the debt

- **WHEN** a fiado is fully settled by one payment and that payment is soft-deleted
- **THEN** the fiado returns to `PENDIENTE` and the balance returns to the charged amount

#### Scenario: a payment cannot be moved to another customer

- **WHEN** a partial update attempts to change `cliente_id`
- **THEN** the request is rejected and the payment keeps its customer

#### Scenario: amount and date are validated server-side

- **WHEN** a payment is recorded with an amount less than or equal to zero, or with a date after today in `America/Argentina/Buenos_Aires`
- **THEN** the request is rejected and nothing is persisted

### Requirement: One implementation computes both ledgers

The system SHALL hold the FIFO allocation and the chronological merge in a single shared module consumed by both the supplier ledger and the customer ledger. The system SHALL NOT contain two implementations of either.

The shared allocation SHALL return the **amount allocated** to each charge rather than a domain state, so each ledger maps the result to its own vocabulary (`PAGADA` for invoices, `COBRADA` for fiados) and shared code depends on neither enum.

The supplier ledger's observable behavior SHALL NOT change: the balance, the invoice states and the history it returns SHALL be identical before and after, verified by its existing tests running unmodified.

#### Scenario: the algorithm exists once

- **WHEN** the service layer is inspected for the FIFO allocation loop and the chronological merge
- **THEN** each appears in exactly one module, and both ledgers call it

#### Scenario: the supplier ledger is unchanged

- **WHEN** the supplier current-account and FIFO tests are run without editing them
- **THEN** they pass, reporting the same balances, states and history as before

#### Scenario: the shared allocation is state-agnostic

- **WHEN** the shared allocation is called
- **THEN** it returns allocated amounts and does not reference `EstadoFactura` or `EstadoVentaFiada`

### Requirement: The customer listing carries each customer's balance

The system SHALL return each customer's on-demand balance in the customer listing, computed for all customers of the negocio in a **single aggregate query** — the same shape already used for suppliers — so that ordering customers by debt never requires one request per customer.

The value SHALL be computed at read time and SHALL NOT be persisted.

#### Scenario: the listing reports balances

- **WHEN** the customer listing is requested for a negocio whose customers have fiados and payments
- **THEN** each customer carries its balance, and a customer with no movements reports `0.00`

#### Scenario: balances are gathered without a query per customer

- **WHEN** the listing is requested for a negocio with many customers
- **THEN** the balances are obtained by one aggregate query rather than one query per customer

#### Scenario: another negocio's movements never leak into a balance

- **WHEN** two negocios have customers with the same name and both have fiados
- **THEN** each listing reports only its own negocio's movements

### Requirement: Migration 0011 is pinned and creates its enum type once

The system SHALL add the `cobro_cliente` table in Alembic revision `0011` with `down_revision = "0010"`. Both SHALL be explicit literals; the migration and its test SHALL NOT reference `head` or `-1` (D-21).

The migration SHALL create the `metodocobro` Postgres enum **exactly once** — created explicitly with `checkfirst`, then referenced by the column with `create_type=False`. A bare enum inside the table creation would issue a second `CREATE TYPE` without `checkfirst`; the new table would still be created, but every migration running afterwards would fail, and the symptom would appear in an unrelated test file (D-56).

`downgrade` SHALL drop the table, its indexes **and** the enum type, so that upgrade → downgrade → upgrade succeeds.

The migration SHALL create indexes on `negocio_id`, on `(negocio_id, cliente_id, deleted_at)` and on `(negocio_id, fecha)` — the tenant filter, the per-customer read this capability exists for, and the listing by period.

#### Scenario: the revision is pinned at both ends

- **WHEN** the migration module is inspected
- **THEN** `revision` is `"0011"` and `down_revision` is `"0010"`, both literal

#### Scenario: the chain survives a full cycle

- **WHEN** the migration is upgraded, downgraded and upgraded again
- **THEN** every step succeeds, with no leftover enum type blocking the second upgrade

#### Scenario: the enum type is created once

- **WHEN** the migration runs
- **THEN** `metodocobro` exists exactly once as a database type, and the migrations that follow still apply

#### Scenario: the per-customer read is indexed

- **WHEN** the created indexes are inspected
- **THEN** one covers `(negocio_id, cliente_id, deleted_at)`
