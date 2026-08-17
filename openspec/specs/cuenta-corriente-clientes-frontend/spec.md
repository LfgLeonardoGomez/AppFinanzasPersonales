# cuenta-corriente-clientes-frontend Specification

## Purpose

The customer account (cuenta corriente) view: a customer's full ledger with real-time balance (signed, can be negative per D-58), the active fiados sorted and state-calculated by FIFO, and a chronological history of charges and credits with running balance. Reuses `SaldoBadge`, `HistorialCronologico` and a generalized fiado table from the supplier ledger (C-13); the state of each fiado (PENDIENTE, PARCIAL, COBRADA) comes from the API and is never recomputed in the browser. C-36 adds: collection method form (cobro) with amount ceiling, result classification (created, already recorded, rejected, unconfirmed), and account refresh on any credit or debit from any team member.

## Requirements

### Requirement: The balance shown is the balance the API computed

The system SHALL render the customer's balance exactly as returned by `GET /api/clientes/{id}/cuenta-corriente`. It SHALL NOT sum, clamp, round, or otherwise derive that value in the browser (RN-SALDO, D-01).

The balance is **signed**. A positive value means the customer owes money; a **negative** value means more was credited than charged, which C-35 established as reachable and legitimate (D-58) — deleting a fiado, or moving a sale out of `CUENTA_CORRIENTE`, removes a charge from a customer who was already credited. The system SHALL display the real figure and SHALL NOT clamp it at zero: a balance that hides money the shop cannot account for is worse than one that surprises.

A zero balance SHALL be distinguishable from a negative one and from a positive one, so "al día" is never read as "a favor".

#### Scenario: a customer who owes money

- **WHEN** the account of a customer with a positive balance is displayed
- **THEN** the amount is shown as a debt, exactly as the API reported it

#### Scenario: a negative balance is shown as the real figure

- **WHEN** the account reports a balance below zero
- **THEN** that figure is displayed as a credit in the customer's favour, and is not replaced by zero

#### Scenario: a zero balance reads as settled

- **WHEN** the account reports a balance of zero
- **THEN** it is presented as settled, distinctly from both the debt and the credit case

#### Scenario: the balance is never recomputed from the movements

- **WHEN** the account is displayed with fiados and cobros present
- **THEN** the rendered balance comes from the response's own balance field, not from any client-side arithmetic over the movements

### Requirement: A malformed amount from the wire fails loudly instead of reading as zero

The system SHALL convert every decimal the account endpoint returns as a string into a number at a single parse boundary, and SHALL raise an error when a value is not finite, so the screen reports a failure rather than displaying a fabricated `0`.

The boundary SHALL be the only place this conversion happens, so no component receives a string-encoded decimal.

#### Scenario: a non-numeric amount surfaces as an error

- **WHEN** the account response carries a balance or a movement amount that is not a valid number
- **THEN** the account view reports an error, and no zero balance is displayed

#### Scenario: well-formed decimals reach the view as numbers

- **WHEN** the account response is well formed
- **THEN** the balance, each fiado's amount, and each history row's amount and running balance are available to the view as numbers

### Requirement: Each fiado is shown with the state the API derived for it

The system SHALL render each active fiado with the state the backend computed by FIFO allocation — `PENDIENTE`, `PARCIAL` or `COBRADA` (RN-CCC-02). It SHALL NOT compute, adjust, or infer that state in the browser, and SHALL NOT persist or cache it as truth.

The vocabulary SHALL be the customer-side one. A fiado SHALL NEVER be labelled `PAGADA`, which would read as though the shop had paid it.

A fiado row SHALL show the date, the amount and the state. It SHALL NOT show an invoice number, a due date, or a document origin — a sale at a counter has none of those.

#### Scenario: the three states are rendered as reported

- **WHEN** a customer has one fiado in each of the three states
- **THEN** each row shows the state the response carried for it

#### Scenario: a state change comes from a refetch, not a recalculation

- **WHEN** a cobro is recorded and the account is read again
- **THEN** the new states come from the fresh response, and no state was recomputed locally

#### Scenario: a customer with no fiados

- **WHEN** the account carries no active fiados
- **THEN** an empty state is shown instead of an empty table

### Requirement: The history is rendered in the order received, with its running balance intact

The system SHALL render the chronological history in the exact order the API returned it, because the backend computes each row's `saldo_acumulado` as a running sum during the same ascending walk that produces that order (RN-HIST). The order and the per-row values are therefore coupled.

Where the system offers a newest-first view, it SHALL be a structural reversal of a copy of the array. It SHALL NOT re-sort the rows by any field value: a value-based sort silently decouples each row from the running balance computed for the ascending walk, corrupting the exact invariant the on-demand ledger exists to guarantee.

Each row SHALL identify whether it is a charge (a fiado) or a credit (a cobro), show its date, its always-positive amount, and its signed running balance. A row whose underlying record carries an attached file SHALL make that file reachable.

#### Scenario: the running balance is identical in both display orders

- **WHEN** the history is viewed oldest-first and then newest-first
- **THEN** every row shows the same running balance in both views, and only the row order differs

#### Scenario: charges and credits are distinguishable

- **WHEN** the history contains both a fiado and a cobro
- **THEN** each row is marked as a charge or a credit, and the amount is shown as a positive number in both cases

#### Scenario: a cobro's receipt is reachable from its row

- **WHEN** a cobro was recorded with an attached receipt
- **THEN** that file is reachable from the cobro's history row

#### Scenario: a customer with no movements

- **WHEN** the account carries an empty history
- **THEN** a "no movements" message is shown

### Requirement: One history table implementation serves both ledgers

The system SHALL hold the chronological history table in a single shared component consumed by both the supplier ledger and the customer ledger, parameterized by the row-type vocabulary of each. The system SHALL NOT contain two implementations of that table.

The supplier ledger's observable behaviour SHALL NOT change: its rendered rows, chips, running balances, attachment affordances and empty state SHALL be identical before and after, verified by its existing tests running **unmodified**.

The shared component SHALL be parameterized over the row-type strings its caller passes, and SHALL NOT reference either ledger's type vocabulary directly, so neither ledger depends on the other's enum.

#### Scenario: the table exists once

- **WHEN** the components are inspected for the history table's markup
- **THEN** it appears in exactly one shared component, and both ledgers render through it

#### Scenario: the supplier ledger is unchanged

- **WHEN** the supplier history tests are run without editing them
- **THEN** they pass, reporting the same rows, chips and running balances as before

#### Scenario: the shared table is vocabulary-agnostic

- **WHEN** the shared component is inspected
- **THEN** it does not hard-code the supplier's row types nor the customer's, and each caller supplies its own labels and attachment titles

### Requirement: A cobro is recorded against the customer, never against a sale

The system SHALL let a cobro be recorded from the customer's account, sending the customer, an amount, a date and a collection method. It SHALL NOT send, reference, or offer to select a sale: which fiados a cobro settles is derived by FIFO at read time and is never stored (RN-CCC-03).

The collection method offered SHALL be the customer-side set — cash, transfer, card or other. It SHALL NOT offer an on-account method: debt is not cancelled with debt.

The system SHALL NOT send the negocio or the authoring user in the payload; both come from the session.

#### Scenario: a cobro is recorded from the customer's account

- **WHEN** an amount, a date and a method are entered and the cobro is submitted
- **THEN** the request carries the customer, the amount, the date and the method, and nothing identifying a sale

#### Scenario: no sale can be selected

- **WHEN** the cobro form is inspected
- **THEN** it offers no way to choose or reference a fiado

#### Scenario: paying on account is not offered

- **WHEN** the available collection methods are inspected
- **THEN** an on-account option is absent

### Requirement: The pending balance is a visible ceiling on the amount, and the backend is the rule

The system SHALL show the customer's pending balance as the maximum collectable amount and SHALL reject a larger amount before sending the request (RN-CCC-04, D-37 — a customer account never holds a credit balance).

That client-side ceiling SHALL NOT be treated as the guarantee. The backend recomputes the available balance on every create and can legitimately reject an amount the form accepted, because another member of the same negocio can record a cobro between the page loading and the form being submitted. When that happens the system SHALL present the backend's own message — which states the remaining balance — rather than a generic failure, SHALL retain everything already entered, and SHALL refresh the account so the ceiling corrects itself.

The system SHALL NOT silently alter an amount the user typed in order to fit the ceiling.

#### Scenario: the ceiling is stated, not implied

- **WHEN** the cobro form is opened for a customer with an outstanding balance
- **THEN** the maximum collectable amount is shown alongside the amount field

#### Scenario: an amount above the balance is refused before the request

- **WHEN** an amount greater than the pending balance is submitted
- **THEN** the form reports the problem and no request is sent

#### Scenario: a backend rejection is shown verbatim and loses nothing

- **WHEN** the backend rejects the cobro because the balance changed since the form was opened
- **THEN** the backend's message is displayed, the entered values are retained, and the account is refreshed

#### Scenario: the typed amount is never rewritten

- **WHEN** an amount above the ceiling is typed
- **THEN** the value stays exactly as typed and the ceiling is communicated instead

### Requirement: When there is nothing to collect, the action is not offered

The system SHALL NOT offer the cobro action when the customer's balance is zero or negative. The backend rejects a payment for a customer with no live fiados outright, so a form rendered in that state can only fail, and a form that can only fail teaches the user that the app is broken.

The system SHALL instead state the customer's situation — settled, or in credit — where the action would otherwise be.

#### Scenario: a settled customer offers no cobro

- **WHEN** the account of a customer with a zero balance is displayed
- **THEN** the cobro action is not available, and the settled state is stated

#### Scenario: a customer in credit offers no cobro

- **WHEN** the account of a customer with a negative balance is displayed
- **THEN** the cobro action is not available, and the credit is stated rather than presented as an error

#### Scenario: a customer who owes money offers the cobro

- **WHEN** the account of a customer with a positive balance is displayed
- **THEN** the cobro action is available

### Requirement: The outcome of a cobro submission is classified, and an unconfirmed one is not an error

The system SHALL distinguish an unconfirmed outcome — no response at all, or any server error at or above 500 — from a real rejection. An unconfirmed outcome SHALL NOT be presented as a failure and SHALL NOT be folded into the rejection message.

Because `POST /api/cobros` does not deduplicate retries today, the unconfirmed message SHALL NOT claim that retrying is safe. It SHALL direct the user to check the customer's movements before retrying, since a duplicate cobro would appear there.

A real rejection below 500 SHALL continue to present the backend's message.

#### Scenario: a stalled request is not reported as a failure

- **WHEN** the cobro request produces no response
- **THEN** the form reports that the outcome could not be confirmed, distinctly from a rejection, and retains everything entered

#### Scenario: a server error is treated as unconfirmed, not rejected

- **WHEN** the cobro request fails with a server error at or above 500
- **THEN** the outcome is reported as unconfirmed rather than as a rejection

#### Scenario: the unconfirmed message points at the movements, not at a retry

- **WHEN** the unconfirmed message is shown
- **THEN** it directs the user to check the customer's movements before retrying and does not state that retrying is safe

#### Scenario: a validation rejection keeps the backend's wording

- **WHEN** the cobro is rejected with a client error below 500
- **THEN** the backend's own message is displayed

### Requirement: One function owns the cobro write, and it resolves to a classified result

The system SHALL route every cobro creation through a single function that owns the request to `POST /api/cobros`; no component or hook SHALL call that endpoint directly.

That function SHALL resolve to a result object carrying both the created cobro and a flag distinguishing a newly created cobro from a deduplicated replay of an earlier attempt. The flag SHALL be derived from the response's real status and headers, never guessed from the body — a replay and a creation return identical bodies.

Until deduplication exists for this endpoint (C-43), the flag is always false. The **shape** is the requirement: it is what lets deduplication be added inside that one function without changing the hook, the form, or any caller's types.

#### Scenario: every creation goes through the one function

- **WHEN** the cobro call sites are inspected
- **THEN** each one calls that function, and none issues its own request to the cobros endpoint

#### Scenario: the result distinguishes a creation from a replay

- **WHEN** the function resolves
- **THEN** it yields the cobro together with a flag stating whether it was a deduplicated replay

#### Scenario: the replay flag is not guessed from the body

- **WHEN** the response body of a creation and of a replay are identical
- **THEN** the flag is decided by the response's status and headers

#### Scenario: a replayed cobro is reported as already recorded

- **WHEN** the function resolves with the replay flag set
- **THEN** the form reports that the cobro was already recorded rather than announcing a new one

### Requirement: Recording a cobro refreshes every view of that customer's balance

The system SHALL invalidate the cached customer data after a cobro is recorded, so the account being viewed and the customer listing's balance both reflect the new figure without a manual reload.

The cached key for a customer's account SHALL be nested under the customer cache namespace, so that the existing invalidation performed by the sales feature whenever a fiado is created, edited or deleted also refreshes the account view — without the sales feature being modified.

#### Scenario: the account refreshes after a cobro

- **WHEN** a cobro is recorded while the customer's account is open
- **THEN** the balance, the fiado states and the history are refetched

#### Scenario: the customer listing's balance refreshes after a cobro

- **WHEN** a cobro is recorded and the customer listing is read again
- **THEN** that customer's balance reflects the cobro

#### Scenario: a fiado's creation refreshes the open account without touching the sales feature

- **WHEN** a sale on account is created, edited or deleted
- **THEN** the customer's account view is invalidated by the sales feature's existing customer-cache invalidation

### Requirement: A customer that cannot be read is a real answer, not a retry

The system SHALL treat a not-found response from the account endpoint as a final answer and SHALL NOT retry it. A customer belonging to another negocio, soft-deleted, or non-existent all yield the same response by design, so retrying can only fail again.

The system SHALL present an empty state offering a way back to the customer list, rather than a loading spinner or a generic error.

A failure that is not a not-found SHALL offer a way to retry.

#### Scenario: a missing or foreign customer shows an empty state

- **WHEN** the account endpoint answers not-found
- **THEN** a "customer not found" state is shown with a way back to the customer list, and the request is not retried

#### Scenario: a transient failure offers a retry

- **WHEN** the account request fails for a reason other than not-found
- **THEN** a retry affordance is offered

#### Scenario: the account is refetched on revisit

- **WHEN** a customer's account is opened again after having been viewed
- **THEN** the account is read from the API rather than served as a settled cached value
