## ADDED Requirements

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
