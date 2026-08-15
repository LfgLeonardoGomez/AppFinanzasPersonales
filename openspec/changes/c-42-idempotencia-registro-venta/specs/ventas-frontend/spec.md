<!-- Written in English to match the language of openspec/specs/ventas-frontend/spec.md, which this delta merges into. The rest of this change's artifacts are in Spanish, like the ventas-backend spec they extend. -->

## ADDED Requirements

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

When the outcome is unknown the form SHALL say that it could not confirm whether the sale was recorded, SHALL offer retrying as the primary action while stating that retrying is safe, and SHALL keep every entered value. After repeated unconfirmed attempts it SHALL also offer going to the sales list, which is the only way the person can check with their own eyes.

When the response is a deduplicated replay the form SHALL report success, stating that the sale was **already** recorded, and SHALL NOT show an error for a sale that exists.

#### Scenario: a deduplicated retry reads as success

- **WHEN** a retry is answered with `200` and `Idempotent-Replay: true`
- **THEN** the form reports that the sale was already recorded and continues as it does after a successful save

#### Scenario: an unconfirmed outcome is named, not disguised as an error

- **WHEN** the submission times out or fails with a network error
- **THEN** the form states that it could not confirm whether the sale was saved, says that retrying is safe, and keeps the amount, date, payment method and customer as entered

#### Scenario: a validation rejection still shows the backend's message

- **WHEN** the submission is answered `422`
- **THEN** the form shows the backend's `detail` as it does today

#### Scenario: a gateway error is not reported as a failure to save

- **WHEN** the submission is answered `502`
- **THEN** the form treats the outcome as unconfirmed rather than as a rejection

#### Scenario: a conflicting key points at the existing sale

- **WHEN** the submission is answered `409` because the key already recorded different data
- **THEN** the form explains that the operation was already recorded and does not present it as an unknown outcome
