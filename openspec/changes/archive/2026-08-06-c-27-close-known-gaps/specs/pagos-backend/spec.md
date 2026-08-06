## ADDED Requirements

### Requirement: Collection endpoints answer without redirecting

Collection endpoints SHALL respond directly on both the trailing-slash and the bare path. Neither form may produce a redirect.

A redirect is not cosmetic here: HTTP clients rebuild the request when they follow one, and some drop headers set explicitly on the original. That is precisely what let the old multi-user test harness attribute writes to the wrong user (C-22) — the request arrived authenticated as whoever the client's cookie jar held rather than the header the caller set.

#### Scenario: Both path forms answer directly

- **WHEN** an authenticated client issues a collection request to either `/api/<recurso>` or `/api/<recurso>/`
- **THEN** the endpoint answers the request itself, with no 3xx redirect in the exchange

#### Scenario: Ownership and validation are unaffected

- **WHEN** a request that previously returned 401, 404 or 422 is issued on either path form
- **THEN** it returns the same status as before — only the redirect disappears

#### Scenario: The generated schema stays single-valued

- **WHEN** the OpenAPI document is produced
- **THEN** each collection operation appears once, so generated clients and types do not gain a duplicate
