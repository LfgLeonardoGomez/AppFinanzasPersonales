# ventas-frontend Specification

## Purpose

The counter screen for C-33's sales backend, shipped by C-34: a filterable sales list (date range, payment method, customer) and a counter-optimised entry form whose customer field exists exactly when the sale is on account — the field's presence *is* the backend invariant `cliente_id IS NOT NULL ⟺ forma_pago = CUENTA_CORRIENTE` (RN-VTA-03), not a decoration on top of it. Day totals with a per-payment-method breakdown are computed on-demand in the browser over the loaded sales (RN-VTA-05 forbids persisting them) and stay legible while the list is still loading. The capability's sharpest requirement is the warning shown before a delete or an edit would remove a live charge from a customer's account: it names the customer and the amount that stops being owed, because `venta_service.actualizar` and `venta_service.eliminar` both hand that consequence to the frontend by name. Customer balances, the customer account view, aggregations beyond the day's totals, export, and a customer list or detail page are explicitly out of scope here.

## Requirements

### Requirement: The customer field appears if and only if the sale is on account

The sales form SHALL render the customer field when, and only when, the selected payment method is `CUENTA_CORRIENTE`. For every other payment method the field SHALL be absent from the DOM — not merely hidden — and any customer already chosen SHALL be discarded from the form state.

This is not a presentation preference. It is the backend invariant `cliente_id IS NOT NULL ⟺ forma_pago = CUENTA_CORRIENTE` (RN-VTA-03), enforced in `venta_service._validar_par` and by a database CHECK, expressed as a shape on screen. Rendering the field for a cash sale would offer the user a value the server is guaranteed to reject; hiding it while keeping the value in state would send that rejected value invisibly.

The form SHALL NOT submit a `cliente_id` unless the payment method is `CUENTA_CORRIENTE`.

#### Scenario: switching to cuenta corriente reveals the customer field

- **WHEN** the payment method is changed from `EFECTIVO` to `CUENTA_CORRIENTE`
- **THEN** the customer field becomes present and reachable by keyboard

#### Scenario: switching away from cuenta corriente removes the field and the value

- **WHEN** a customer has been selected on a `CUENTA_CORRIENTE` sale and the payment method is then changed to `EFECTIVO`
- **THEN** the customer field is no longer in the document, and submitting sends no `cliente_id`

#### Scenario: a cash sale never carries a customer

- **WHEN** a sale is submitted with any payment method other than `CUENTA_CORRIENTE`
- **THEN** the request body has no `cliente_id` key

#### Scenario: a fiado cannot be submitted without a customer

- **WHEN** the payment method is `CUENTA_CORRIENTE` and no customer has been chosen
- **THEN** the form blocks submission and explains that a fiado needs a customer

### Requirement: The form is usable standing at a counter

The sales form SHALL open ready to record the most common sale: the date SHALL default to today, computed in `America/Argentina/Buenos_Aires` rather than from the browser's local clock, and the amount field SHALL hold initial focus.

The date field SHALL NOT accept a date later than today in that same timezone, matching `venta_service._validar_fecha`. The amount SHALL be required and greater than zero.

Client-side validation exists to make the form usable, never to make it safe: the system SHALL surface the backend's rejection message when a submission is refused, rather than assuming the client already prevented it.

#### Scenario: the form opens on today

- **WHEN** the sales form is opened
- **THEN** the date field holds today's date in `America/Argentina/Buenos_Aires`

#### Scenario: a future date is refused

- **WHEN** a date after today is entered
- **THEN** submission is blocked with a message saying the date cannot be in the future

#### Scenario: a non-positive amount is refused

- **WHEN** an amount of zero or less is entered
- **THEN** submission is blocked with a message saying the amount must be greater than zero

#### Scenario: a backend rejection is shown to the user

- **WHEN** the backend answers a submission with a `422` and an explanatory detail
- **THEN** that message is displayed instead of a generic failure

### Requirement: The sales list is filterable by date, payment method and customer

The system SHALL present the negocio's active sales, newest first, filterable by date range (both bounds inclusive), by payment method, and by customer. Filters SHALL be reflected in the URL search params so a filtered view can be shared or reloaded.

Because `VentaResponse` carries `cliente_id` and no customer name, the list SHALL resolve names from the customers endpoint rather than displaying a raw identifier.

#### Scenario: filtering by payment method

- **WHEN** the payment-method filter is set to `CUENTA_CORRIENTE`
- **THEN** only sales on account are listed

#### Scenario: filtering by date range includes both bounds

- **WHEN** a range is set whose bounds each contain a sale
- **THEN** the sales on both the first and the last day are listed

#### Scenario: the list shows customer names, not identifiers

- **WHEN** a sale on account is listed
- **THEN** the customer's name is displayed, and no UUID appears in the row

#### Scenario: filters survive a reload

- **WHEN** filters are applied and the page is reloaded
- **THEN** the same filters are still in effect, read back from the URL

#### Scenario: an empty result is distinguishable from a loading list

- **WHEN** the filters match no sale
- **THEN** an empty state is shown, distinct from the loading state

### Requirement: The day's totals are computed on-demand and legible while loading

The system SHALL show the total sold for the selected day together with a breakdown by payment method. Both SHALL be computed in the browser from the sales already retrieved — never read from a stored aggregate and never persisted, per RN-VTA-05 and D-01.

The totals region SHALL be present from the first render, showing a loading affordance rather than disappearing or displaying a misleading zero while the request is in flight.

#### Scenario: the total is the sum of the day's sales

- **WHEN** the day holds sales of $1.000 in cash, $2.500 by card and $500 on account
- **THEN** the total shown is $4.000

#### Scenario: the breakdown separates the fiado from the money that came in

- **WHEN** that same day is shown
- **THEN** the breakdown lists $1.000 under *Efectivo*, $2.500 under *Tarjeta* and $500 under *Cuenta corriente*

#### Scenario: totals do not flash a false zero

- **WHEN** the sales request is still in flight
- **THEN** the totals region is present and shows a loading affordance instead of `$0`

#### Scenario: a day with no sales

- **WHEN** the selected day has no sales
- **THEN** the total shown is `$0` and the breakdown is empty, after loading has finished

### Requirement: The user is warned before a customer's debt disappears

The system SHALL require an explicit confirmation before deleting a sale on account, or editing one so that its payment method is no longer `CUENTA_CORRIENTE`, and that confirmation SHALL name **who** stops owing and **how much**, formatted as currency. A generic confirmation SHALL NOT be considered to satisfy this requirement.

Both actions remove a live charge from that customer's account. The backend permits them — they are legitimate corrections — and computes the balance over what is live, so there is nothing to reverse afterwards.

The confirmation SHALL also state that payments already recorded against that customer are not removed, and that the balance may consequently end up in the customer's favour — C-35 defines the balance as a signed value that may legitimately go negative for exactly this reason.

The dialog SHALL follow the destructive-confirmation pattern already established for supplier deletion (RN-PROV-04): `role="alertdialog"`, initial focus on the cancel action, and no dismissal by clicking the backdrop.

Deleting a sale that is **not** on account destroys no debt; it SHALL be confirmed, but SHALL NOT carry the debt warning.

#### Scenario: deleting a fiado names the customer and the amount

- **WHEN** deletion is requested for a $4.500 sale on account belonging to Juan Pérez
- **THEN** a confirmation appears naming Juan Pérez and $4.500 as the debt that stops being owed

#### Scenario: moving a sale out of cuenta corriente warns before saving

- **WHEN** a sale on account is edited so its payment method becomes `EFECTIVO`, and saving is requested
- **THEN** the same warning appears before the request is sent

#### Scenario: cancelling changes nothing

- **WHEN** the warning is dismissed with the cancel action
- **THEN** no request is sent and the sale is unchanged

#### Scenario: the warning explains that recorded payments remain

- **WHEN** the warning is shown
- **THEN** it states that payments already recorded are not removed and the balance may end up in the customer's favour

#### Scenario: a cash sale is confirmed without the debt warning

- **WHEN** deletion is requested for a sale whose payment method is `EFECTIVO`
- **THEN** a confirmation appears with no mention of debt, of a customer, or of an amount ceasing to be owed

#### Scenario: focus starts on the safe action

- **WHEN** the warning opens
- **THEN** focus is on the cancel action, and clicking the backdrop does not dismiss the dialog

### Requirement: A sale edit never asks the backend to clear the customer

The edit form SHALL never send `cliente_id: null`, and SHALL rely on the payment method alone to express that a sale is leaving cuenta corriente.

`PATCH /api/ventas/{id}` treats an absent `cliente_id` as "leave it alone"; it has no way to be told "remove it". Clearing happens implicitly, as a consequence of sending a payment method other than `CUENTA_CORRIENTE`, which `venta_service.actualizar` handles by validating the resulting pair rather than the fields that arrived.

#### Scenario: leaving cuenta corriente sends only the payment method

- **WHEN** a sale on account is edited to `EFECTIVO`
- **THEN** the PATCH body carries the new `forma_pago` and no `cliente_id` key

#### Scenario: editing the amount of a fiado leaves it a fiado

- **WHEN** only the amount of a sale on account is changed
- **THEN** the sale remains on account with the same customer, and no debt warning is shown

### Requirement: Saving a sale carries an idempotency key that survives the retry

`createVenta` SHALL send an `Idempotency-Key` header on every `POST /api/ventas`, and the sales form SHALL reuse the same key when the person retries the same sale after an unconfirmed attempt.

Reuse is the whole mechanism. A retry that mints a fresh key is a duplicate with extra steps, and it is indistinguishable from a fix unless it is tested directly — so this requirement is about the second request, not about the first. Changing any field before retrying SHALL mint a new key: that is a different sale, not a retry.

The key SHALL be discarded once the outcome is confirmed — created, already recorded, or rejected with a conflict — and SHALL be kept when the outcome is unknown. It SHALL survive a tab reload, degrading to memory-only if browser storage is unavailable.

#### Scenario: pressing save again after an unconfirmed failure reuses the key

- **WHEN** the first submission fails with no response and the person presses "Guardar" again without editing anything
- **THEN** the second request carries the same `Idempotency-Key` as the first

#### Scenario: correcting the amount mints a new key

- **WHEN** a submission fails, the person changes the amount and submits again
- **THEN** the request carries a different `Idempotency-Key`

#### Scenario: the next sale gets its own key

- **WHEN** a sale is saved successfully and the form is opened again for another sale
- **THEN** the new submission carries a key different from the one just used

#### Scenario: every create request carries a key

- **WHEN** `createVenta` is called from anywhere in the app
- **THEN** the request includes an `Idempotency-Key` header

### Requirement: The sales form distinguishes "saved", "already saved" and "we don't know"

The sales form SHALL present a distinct outcome for a created sale, a deduplicated retry, a rejection, and an unconfirmed result, and SHALL NOT collapse the last one into the generic error it shows today.

Today a lost response, a stalled connection and a validation failure all render the same message with the button re-enabled and the typed data intact, so the only visible move is to press "Guardar" again. That is exactly the sequence that creates the duplicate charge.

When the outcome is unknown the form SHALL say that it could not confirm whether the sale was recorded, SHALL offer retrying as the primary action while stating that retrying **should** be safe, and SHALL keep every entered value. That statement SHALL NOT be unconditional: it SHALL name the one case it does not cover — the page having been closed or reloaded between the attempt and the retry, which genuinely loses the client-side key bookkeeping this promise depends on. After repeated unconfirmed attempts it SHALL also offer going to the sales list, which is the only way the person can check with their own eyes.

When the response is a deduplicated replay the form SHALL report success, stating that the sale was **already** recorded, and SHALL NOT show an error for a sale that exists.

#### Scenario: a deduplicated retry reads as success

- **WHEN** a retry is answered with `200` and `Idempotent-Replay: true`
- **THEN** the form reports that the sale was already recorded and continues as it does after a successful save

#### Scenario: an unconfirmed outcome is named, not disguised as an error

- **WHEN** the submission times out or fails with a network error, and the page stayed open
- **THEN** the form states that it could not confirm whether the sale was saved, says that retrying should be safe, and keeps the amount, date, payment method and customer as entered

#### Scenario: the safe-retry promise does not cover a closed or reloaded page

- **WHEN** the submission times out or fails with a network error
- **THEN** the message names the one case the safe-retry guarantee does not cover — the page having been closed or reloaded in the meantime, since the pending key lived only in that context

#### Scenario: a validation rejection still shows the backend's message

- **WHEN** the submission is answered `422`
- **THEN** the form shows the backend's `detail` as it does today

#### Scenario: a gateway error is not reported as a failure to save

- **WHEN** the submission is answered `502`
- **THEN** the form treats the outcome as unconfirmed rather than as a rejection

#### Scenario: a conflicting key points at the existing sale

- **WHEN** the submission is answered `409` because the key already recorded different data
- **THEN** the form explains that the operation was already recorded and does not present it as an unknown outcome
