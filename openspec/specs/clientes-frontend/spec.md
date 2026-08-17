# clientes-frontend Specification

## Purpose

The customer autocomplete shared across the app, shipped by C-34 against the C-32 `/api/clientes` endpoints: a `ClienteAutocomplete` component that suggests active customers while the name is typed, mirroring the existing `SupplierSearch`, offers inline creation from the name alone with no modal and no navigation (RN-CLI-01/02) when nothing matches, and — when the typed name collides with an existing customer — offers the existing one instead of creating a second, because the backend's `409` on a duplicate creation carries that customer in its detail (RN-CLI-03). Name identity is decided exclusively by the backend; the frontend implements no normalization, fuzzy matching, or equivalence rule of its own, so it never drifts from `app/core/normalizacion.py`. C-34 created only `src/features/clientes/api/` (`clientesApi.ts` + `clientesHooks.ts`); C-36 added the customers list page, the customer's card, and their routes and navigation entry, which are specified below.

## Requirements

### Requirement: Customers are suggested while the name is typed

The system SHALL provide a shared `ClienteAutocomplete` component that queries the negocio's active customers as the user types and offers the matches as suggestions, mirroring the behaviour of the existing `SupplierSearch`.

Suggestions SHALL come from the backend search endpoint, which returns the exact normalized match first and then the partial ones (RN-CLI-02). The component SHALL NOT rank, filter or re-order the results with a rule of its own.

The component SHALL expose the combobox semantics already used by `SupplierSearch`: `role="combobox"`, `aria-expanded`, a `role="listbox"` of `role="option"` items, arrow-key traversal, Enter to select and Escape to close.

#### Scenario: typing offers the matching customers

- **WHEN** enough characters are typed to trigger a search and customers match
- **THEN** those customers are offered as selectable options

#### Scenario: selecting a customer yields its identity to the form

- **WHEN** a suggestion is chosen
- **THEN** the component reports that customer to its parent and shows it as the current selection

#### Scenario: the selection can be cleared

- **WHEN** the current selection is cleared
- **THEN** the component reports no customer and returns to its search input

#### Scenario: the search is reachable by keyboard alone

- **WHEN** suggestions are open and the arrow keys and Enter are used
- **THEN** a customer can be highlighted and selected without a pointer

### Requirement: A new customer is created inline, without a modal or navigation

When the typed name matches no existing customer, the component SHALL offer to create that customer from the name alone (RN-CLI-01) — without opening a modal, without leaving the form, and without discarding the sale being recorded.

On success the newly created customer SHALL become the current selection immediately, so the sale can be completed in the same gesture.

Only the name SHALL be sent. Phone and notes are optional fields that belong to the customer screens of C-36, not to the counter.

#### Scenario: no match offers creation

- **WHEN** a name is typed that matches no active customer
- **THEN** an option to create that customer by that name is offered

#### Scenario: the created customer is selected without leaving the form

- **WHEN** that creation option is taken and the backend answers with the new customer
- **THEN** the customer becomes the current selection and the sale form still holds the amount, date and payment method already entered

#### Scenario: creation failure does not lose the form

- **WHEN** the creation request fails
- **THEN** an error is shown and the sale form retains everything already entered

### Requirement: A duplicate name offers the existing customer instead of creating a second

When a creation attempt is answered `409`, the component SHALL read the existing customer out of the response detail and offer **that customer**, rather than reporting a failure or retrying. Choosing the offered customer SHALL select it and SHALL NOT issue another creation request.

Two customers with equivalent names in one negocio would split one person's debt across two accounts, which is the one thing the customer entity exists to prevent (RN-CLI-03). The backend enforces this with a unique index and answers a duplicate creation with `409`, whose detail carries the existing customer's `id` and `nombre`.

#### Scenario: a duplicate creation offers the existing customer

- **WHEN** creation is attempted with a name that already exists and the backend answers `409` carrying that customer
- **THEN** the existing customer is offered by name, and no error is presented as the primary outcome

#### Scenario: accepting the offer selects the existing customer

- **WHEN** the offered existing customer is accepted
- **THEN** it becomes the current selection and no further creation request is sent

#### Scenario: an accent-only difference is caught by the backend, not the browser

- **WHEN** a name differing from an existing customer only by accents or casing is submitted for creation
- **THEN** the outcome is whatever the backend decides, surfaced through the same `409` path

### Requirement: The frontend does not decide which names mean the same person

Name identity SHALL be determined exclusively by the backend. The system SHALL NOT implement any client-side normalization, fuzzy matching, or equivalence rule to decide whether a typed name is "the same" as an existing customer.

`app/core/normalizacion.py` deliberately preserves `ñ` so that "Peña" never collapses into "Pena", and the unique index freezes that rule into stored data. A competing rule in the browser would eventually disagree with it, and the disagreement would show up as one person's debt split across two accounts.

`nombre_normalizado` is returned by the API and MAY be displayed or compared for information, but SHALL NOT be sent in any request payload.

#### Scenario: no client-side normalization is applied before searching

- **WHEN** a name is typed into the autocomplete
- **THEN** the fragment is sent to the backend as typed, apart from trimming, and the returned order is respected

#### Scenario: the normalized name is never sent

- **WHEN** a customer is created from the autocomplete
- **THEN** the request body contains only the name, with no `nombre_normalizado` key

### Requirement: Customers are listed with their balance, ordered by who owes the most

The system SHALL provide a customer list showing each active customer of the negocio with the balance the backend computed for them, ordered by balance descending by default, so the screen opens on the question it exists to answer.

The balances SHALL come from the customer listing endpoint, which computes every customer's balance in a **single aggregate query**. The system SHALL NOT request a customer's account per row: ordering by debt must never become one request per customer.

The ordering SHALL be adjustable, and the list SHALL remain usable when a customer's balance is absent — an absent balance SHALL order last rather than as zero, because "unknown" and "settled" are different facts.

Each row SHALL lead to that customer's account.

#### Scenario: the list opens on who owes the most

- **WHEN** the customer list is displayed for a negocio whose customers have different balances
- **THEN** the customer with the largest debt appears first

#### Scenario: balances are read without a request per customer

- **WHEN** the customer list is displayed for a negocio with many customers
- **THEN** the balances come from the listing response, and no per-customer account request is issued

#### Scenario: the ordering can be changed

- **WHEN** the ordering is switched
- **THEN** the list re-orders accordingly without refetching per customer

#### Scenario: a customer without a reported balance orders last

- **WHEN** a row carries no balance
- **THEN** it is ordered after every customer that has one, and is not treated as settled

#### Scenario: a row leads to the customer's account

- **WHEN** a customer row is followed
- **THEN** that customer's account is opened

#### Scenario: a negocio with no customers

- **WHEN** the customer list is displayed for a negocio with no customers
- **THEN** an empty state is shown rather than an empty table

### Requirement: The customer's card never reads the balance off the customer record

The system SHALL present a customer's card with the customer's identity read from the customer endpoint and the balance, the fiados and the history read from that customer's account endpoint.

The system SHALL NOT display the balance field carried on the customer record itself. That field is populated **only** by the plain customer listing; on a single-customer read it is always absent. Rendering it would type-check, compile, and silently show nothing on precisely the screen where a balance is the point.

#### Scenario: identity and balance come from their own sources

- **WHEN** a customer's card is displayed
- **THEN** the name comes from the customer endpoint and the balance comes from the account endpoint

#### Scenario: the customer record's balance field is not rendered

- **WHEN** the card is inspected
- **THEN** it does not read the balance field of the single-customer response

#### Scenario: a missing customer is reported once

- **WHEN** either the customer read or the account read answers not-found
- **THEN** a single "customer not found" state is shown, with a way back to the customer list

### Requirement: The customer screens are reachable from the app's navigation

The system SHALL expose the customer list and each customer's account as addressable routes, and SHALL offer a customers entry in the application's main navigation alongside the existing ones.

Both routes SHALL be private, behind the same authentication guard as the rest of the application.

#### Scenario: the customer list has its own address

- **WHEN** the customer list route is opened directly
- **THEN** the customer list is rendered

#### Scenario: a customer's account has its own address

- **WHEN** a customer's account route is opened directly with that customer's identifier
- **THEN** that customer's account is rendered

#### Scenario: customers appear in the main navigation

- **WHEN** the application shell is rendered for an authenticated user
- **THEN** a customers entry is present in the navigation

#### Scenario: the customer routes require a session

- **WHEN** either customer route is opened without a session
- **THEN** access is refused by the same guard that protects the other private routes
