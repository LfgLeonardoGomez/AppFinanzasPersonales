## MODIFIED Requirements

### Requirement: Per-user rate limit (10 requests/hour) on /extraer-ia endpoints

The system SHALL enforce a sliding window rate limit per `usuario_id` (the authenticated user) on
both `POST /api/facturas/extraer-ia` and `POST /api/pagos/extraer-ia`. The window size and the
maximum requests SHALL be **configurable via environment variables** — `IA_RATE_MAX_REQUESTS`
(max requests per window) and `IA_RATE_WINDOW_SECONDS` (window length in seconds) — declared as
typed settings in `app/core/config.py`. The defaults SHALL be **comfortable for a single-user MVP**:
`IA_RATE_MAX_REQUESTS = 60` and `IA_RATE_WINDOW_SECONDS = 3600` (60 requests/hour). The limiter
SHALL read the settings at evaluation time (consistent with the C-16 read-through settings proxy),
so changing the env var changes the limit without a code change.

The request that exceeds `IA_RATE_MAX_REQUESTS` inside the window SHALL return HTTP 429 with a
`Retry-After` header set to the seconds remaining until the oldest counted request leaves the
window. The rate limit state SHALL be keyed by `usuario_id`, NOT by IP, so users behind the same
NAT do not share the budget and users with dynamic IPs do not lose theirs. The rate limit SHALL be
evaluated AFTER authentication, so unauthenticated requests return 401 (not 429) and do not consume
budget. The same shared limiter SHALL apply to both the factura and pago extraction endpoints.

#### Scenario: requests up to the configured max within the window are allowed

- **WHEN** an authenticated user makes `IA_RATE_MAX_REQUESTS` requests to `/extraer-ia` endpoints (any combination of factura/pago) within one `IA_RATE_WINDOW_SECONDS` window
- **THEN** every request returns 200 (or 200 with `error: true` from the extractor) and none is rate-limited

#### Scenario: the request over the configured max is rejected

- **WHEN** an authenticated user has made `IA_RATE_MAX_REQUESTS` requests in the current window and makes one more
- **THEN** the response is 429 Too Many Requests with a `Retry-After` header and a clear error message

#### Scenario: the limit is driven by the env settings, not hardcoded constants

- **WHEN** `IA_RATE_MAX_REQUESTS` is set to `2` in the environment and an authenticated user makes a 3rd request in the window
- **THEN** the 3rd request returns 429 — the limiter honors the configured value rather than a hardcoded 10

#### Scenario: the defaults are 60 requests per hour when the env vars are unset

- **WHEN** neither `IA_RATE_MAX_REQUESTS` nor `IA_RATE_WINDOW_SECONDS` is set in the environment
- **THEN** the limiter allows 60 requests per 3600-second window before returning 429

#### Scenario: rate limit is keyed by usuario_id, not by IP

- **WHEN** user A makes `IA_RATE_MAX_REQUESTS` requests from IP `1.2.3.4`, exhausting their budget, and user B makes a request from the same IP
- **THEN** user B's request is NOT rate-limited (user B's budget is independent)

#### Scenario: rate limit window slides

- **WHEN** an authenticated user exhausted the budget at minute 0 and then makes a request after `IA_RATE_WINDOW_SECONDS` has elapsed for the oldest request
- **THEN** the new request is allowed (the oldest counted requests are now outside the window)

#### Scenario: unauthenticated request does not consume budget

- **WHEN** an unauthenticated request reaches the endpoint
- **THEN** the response is 401 Unauthorized and no rate limit slot is consumed
