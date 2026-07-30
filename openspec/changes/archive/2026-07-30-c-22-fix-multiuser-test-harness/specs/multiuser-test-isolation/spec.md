## ADDED Requirements

### Requirement: Each authenticated identity owns an isolated cookie jar

The backend test suite SHALL establish every authenticated identity through a dedicated HTTP client whose session lives exclusively in that client's own cookie jar. Tests MUST NOT authenticate a request by passing a hand-written `Cookie` header, because under cookie auth the client's jar takes precedence on write requests and silently substitutes the identity.

#### Scenario: Two users acting in the same test never collapse into one identity

- **WHEN** a test creates two authenticated users and each performs a write through its own client
- **THEN** every resource created reports the `usuario_id` of the client that created it, and the two ids differ

#### Scenario: A resource created by one user is owned by that user

- **WHEN** user A creates a proveedor and a pago through A's client
- **THEN** both resources are persisted with A's `usuario_id`, never with another user's

### Requirement: Cross-tenant access returns 404 through every mutating and reading path

The suite SHALL assert regla dura #3 across the full verb surface of an owned resource, using genuinely distinct identities. A foreign resource MUST be indistinguishable from a missing one: the response is 404, never 403 and never 200.

#### Scenario: User B cannot read, update or delete user A's pago

- **WHEN** user B issues `GET`, `PATCH` and `DELETE` against the id of a pago owned by user A
- **THEN** each request returns 404

#### Scenario: User B cannot read user A's proveedor

- **WHEN** user B issues `GET` against the id of a proveedor owned by user A
- **THEN** the request returns 404

#### Scenario: Listings are scoped to the requesting user

- **WHEN** user A owns one pago and user B owns none, and each lists pagos through its own client
- **THEN** A's listing reports a total of 1 and B's listing reports a total of 0

### Requirement: Anonymous requests carry no inherited session

The suite SHALL issue unauthenticated requests through a client with a guaranteed-empty cookie jar, so that a `401` assertion proves the absence of a session rather than inheriting one from an earlier test in the same module.

#### Scenario: An unauthenticated request stays unauthenticated regardless of test order

- **WHEN** a test asserting 401 runs after another test in the same file has logged a user in
- **THEN** the request is rejected with 401, and the result is identical to running that test in isolation

### Requirement: The suite guards against reintroducing header-based identity

The suite SHALL contain an executable guard that fails if the hand-written `Cookie` header pattern is reintroduced, documenting the failure mode so it is not rediscovered by debugging a red suite months later.

#### Scenario: An explicit Cookie header does not override a foreign session in the jar

- **WHEN** a request is issued with an explicit `Cookie` header for user A while the client's jar holds user B's session
- **THEN** the guard demonstrates that the resulting identity is not reliably A, proving the pattern unsafe for multi-user tests

### Requirement: Isolation tests must fail when the invariant they guard is broken

Every migrated isolation test SHALL be verified to fail when ownership enforcement is removed from the service layer. A test that stays green while the invariant is broken provides no protection and MUST NOT be counted as coverage.

#### Scenario: Removing the ownership check turns the isolation tests red

- **WHEN** the ownership comparison in the service layer is temporarily disabled
- **THEN** the cross-tenant 404 tests fail, and they pass again once it is restored

### Requirement: The full backend suite is deterministic and green

The backend suite SHALL pass in full, and the files migrated by this change SHALL also pass when executed in isolation, preserving the determinism guarantee established by the test-pollution work.

#### Scenario: Whole suite and isolated files agree

- **WHEN** the full suite runs, and then each migrated integration file runs on its own
- **THEN** both runs report zero failures
