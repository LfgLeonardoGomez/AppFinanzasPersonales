# IA Vision Backend Specification

> New capability: HTTP API for AI-assisted image-based extraction of invoice and payment headers
> (C-14). Introduces the `VisionExtractor` abstraction with two implementations (Claude and
> OpenAI), strict Pydantic proposal schemas, a per-user rate limiter, and two additive endpoints
> (`POST /api/facturas/extraer-ia`, `POST /api/pagos/extraer-ia`). The capability enforces RN-IA-01
> (image only), RN-IA-02 (header only), RN-IA-03 (never invent, null when unreadable), RN-IA-04
> (never persist), RN-IA-05 (graceful failure, never 500), and RN-IA-06 (the IA never assigns a
> supplier). Derived state (`saldo`, `estado`) and the supplier-matching flow (RN-VINC) remain
> unchanged: the frontend owns the matching and the persistence.

## ADDED Requirements

### Requirement: Image-only payload validation on /extraer-ia endpoints

The system SHALL accept `POST /api/facturas/extraer-ia` and `POST /api/pagos/extraer-ia` only when
the request body is a `multipart/form-data` with a single `file` part whose real MIME type (verified
by magic bytes, NOT by the `Content-Type` header) is one of `image/jpeg`, `image/png`, or
`image/webp`. The system SHALL reject PDFs and any other MIME type with HTTP 422. The system
SHALL reject files larger than 10 MB with HTTP 422. The system SHALL NOT accept a `file` part
that is missing, empty, or whose name does not match `file`.

#### Scenario: valid JPEG is accepted

- **WHEN** an authenticated user POSTs `multipart/form-data` with a `file` part containing a valid JPEG (magic bytes `FF D8 FF`) of 1 MB
- **THEN** the request reaches the vision extractor and the response is 200 with a `PropuestaFacturaEnvelope` (or `PropuestaPagoEnvelope`)

#### Scenario: valid PNG is accepted

- **WHEN** an authenticated user POSTs a valid PNG (magic bytes `89 50 4E 47`)
- **THEN** the request reaches the vision extractor and the response is 200

#### Scenario: valid WebP is accepted

- **WHEN** an authenticated user POSTs a valid WebP (`RIFF....WEBP`)
- **THEN** the request reaches the vision extractor and the response is 200

#### Scenario: PDF is rejected with 422

- **WHEN** an authenticated user POSTs a file whose magic bytes are `%PDF` even if the `Content-Type` header claims `image/jpeg`
- **THEN** the response is 422 Unprocessable Entity with a clear error message and the vision extractor is NOT called

#### Scenario: file exceeding 10 MB is rejected

- **WHEN** an authenticated user POSTs a 10 MB + 1 byte image
- **THEN** the response is 422 Unprocessable Entity and the vision extractor is NOT called

#### Scenario: file with unsupported MIME is rejected

- **WHEN** an authenticated user POSTs a HEIC, TIFF, BMP, or GIF image
- **THEN** the response is 422 Unprocessable Entity and the vision extractor is NOT called

#### Scenario: missing or empty file part is rejected

- **WHEN** the multipart payload is missing the `file` part or the part is empty
- **THEN** the response is 422 Unprocessable Entity

### Requirement: Per-user rate limit (10 requests/hour) on /extraer-ia endpoints

The system SHALL enforce a sliding window of 10 requests per hour per `usuario_id` (the
authenticated user) on both `POST /api/facturas/extraer-ia` and `POST /api/pagos/extraer-ia`. The
11th request inside a 60-minute window SHALL return HTTP 429 with a `Retry-After` header set to
the seconds remaining until the oldest counted request leaves the window. The rate limit state
SHALL be keyed by `usuario_id`, NOT by IP, so users behind the same NAT do not share the
budget and users with dynamic IPs do not lose theirs. The rate limit SHALL be evaluated AFTER
authentication, so unauthenticated requests return 401 (not 429) and do not consume budget.

#### Scenario: 10 requests within an hour are allowed

- **WHEN** an authenticated user makes 10 requests to `/extraer-ia` endpoints (any combination of
  factura/pago) within a 60-minute window
- **THEN** every request returns 200 (or 200 with `error: true` from the extractor) and none is rate-limited

#### Scenario: 11th request in the window is rejected

- **WHEN** an authenticated user has made 10 requests in the last 60 minutes and makes an 11th
- **THEN** the response is 429 Too Many Requests with a `Retry-After` header and a clear error message

#### Scenario: rate limit is keyed by usuario_id, not by IP

- **WHEN** user A makes 10 requests from IP `1.2.3.4`, exhausting their budget, and user B makes a request from the same IP
- **THEN** user B's request is NOT rate-limited (user B's budget is independent)

#### Scenario: rate limit window slides

- **WHEN** an authenticated user made 10 requests at minute 0 and then makes a request at minute 61
- **THEN** the new request is allowed (the 10 oldest are now outside the 60-minute window)

#### Scenario: unauthenticated request does not consume budget

- **WHEN** an unauthenticated request reaches the endpoint
- **THEN** the response is 401 Unauthorized and no rate limit slot is consumed

### Requirement: PropuestaFactura schema with strict null semantics

The system SHALL define `PropuestaFactura` as a Pydantic `BaseModel` (NOT a `SQLModel`) with the
following fields, ALL of which SHALL be nullable: `proveedor_nombre: str | None`,
`numero: str | None`, `fecha_emision: date | None`, `monto_total: Decimal | None`,
`error: bool = False`, `error_message: str | None = None`. The schema SHALL be defined in
`app/schemas/factura.py` (the existing CRUD schemas file). The schema SHALL ignore extra fields
when validating (so a vision model that returns additional keys does not fail). When the vision
model returns `null` for a field, the corresponding schema field SHALL be `None` (RN-IA-03); the
system SHALL NEVER invent, guess, or compute a value for an unreadable field.

#### Scenario: complete proposal with all fields populated

- **WHEN** the vision model returns `{"proveedor_nombre": "Acme SA", "numero": "0001-00012345",
  "fecha_emision": "2026-06-15", "monto_total": 12345.67}`
- **THEN** the `PropuestaFactura` instance has all four fields populated with the model's values

#### Scenario: partial proposal with unreadable fields set to null

- **WHEN** the vision model returns `{"proveedor_nombre": "Acme SA", "numero": null,
  "fecha_emision": "2026-06-15", "monto_total": null}` (number and total are unreadable)
- **THEN** the `PropuestaFactura` instance has `proveedor_nombre="Acme SA"`, `numero=None`,
  `fecha_emision=date(2026, 6, 15)`, `monto_total=None`

#### Scenario: proposal with all fields null is valid

- **WHEN** the vision model returns `{"proveedor_nombre": null, "numero": null,
  "fecha_emision": null, "monto_total": null}`
- **THEN** the `PropuestaFactura` instance is valid with all four fields `None` and the system
  does not invent defaults

#### Scenario: extra fields from the model are ignored

- **WHEN** the vision model returns `{"proveedor_nombre": "Acme SA", "cuit": "30-12345678-9",
  "iva": 1234.56}` (extra fields beyond the schema)
- **THEN** the `PropuestaFactura` instance is valid; `cuit` and `iva` are ignored and never appear
  in the response

### Requirement: PropuestaPago schema with strict null semantics

The system SHALL define `PropuestaPago` as a Pydantic `BaseModel` (NOT a `SQLModel`) with the
following fields, ALL of which SHALL be nullable: `proveedor_nombre: str | None`,
`monto: Decimal | None`, `fecha: date | None`, `metodo: MetodoPago | None`,
`error: bool = False`, `error_message: str | None = None`. The `metodo` field SHALL only accept
values from the `MetodoPago` enum (EFECTIVO, TRANSFERENCIA, TARJETA, MERCADOPAGO, OTRO); any
other value returned by the vision model SHALL be normalized to `None` (RN-IA-03). The schema
SHALL be defined in `app/schemas/pago.py`.

#### Scenario: complete proposal with all fields populated

- **WHEN** the vision model returns `{"proveedor_nombre": "Acme SA", "monto": 5000.00,
  "fecha": "2026-06-20", "metodo": "TRANSFERENCIA"}`
- **THEN** the `PropuestaPago` instance has all four fields populated

#### Scenario: metodo value not in enum is normalized to null

- **WHEN** the vision model returns `{"metodo": "CRIPTOMONEDA"}` (not in the enum)
- **THEN** the `PropuestaPago` instance has `metodo=None` (the invalid value is NOT preserved,
  per RN-IA-03)

#### Scenario: proposal with all fields null is valid

- **WHEN** the vision model returns `{"proveedor_nombre": null, "monto": null, "fecha": null,
  "metodo": null}`
- **THEN** the `PropuestaPago` instance is valid with all four fields `None`

### Requirement: VisionExtractor abstraction with Claude and OpenAI implementations

The system SHALL define a `VisionExtractor` `typing.Protocol` with two methods:
`extraer_factura(imagen_bytes: bytes, content_type: str) -> PropuestaFactura` and
`extraer_pago(imagen_bytes: bytes, content_type: str) -> PropuestaPago`. Both methods SHALL
NEVER raise; they SHALL encapsulate any exception (SDK error, network failure, JSON parse
failure, Pydantic validation failure) into `error: bool = True` and `error_message: str` while
leaving the other fields as `None` (RN-IA-05). The system SHALL provide two implementations:
`ClaudeVisionExtractor` (using the `anthropic` SDK) and `OpenAIVisionExtractor` (using the
`openai` SDK). Both implementations SHALL use a shared system prompt that explicitly forbids
inventing fields and that constrains the response to a documented JSON schema. Both
implementations SHALL parse the model's response with
`PropuestaFactura.model_validate(json, strict=True)` (or `PropuestaPago`).

#### Scenario: extractor returns a complete proposal on success

- **WHEN** the SDK returns a valid JSON with all fields populated
- **THEN** the extractor returns a `PropuestaFactura` (or `PropuestaPago`) with those values,
  `error=False`, `error_message=None`

#### Scenario: extractor captures SDK error and returns error envelope

- **WHEN** the SDK raises `anthropic.APIError` (or `openai.OpenAIError`)
- **THEN** the extractor returns `PropuestaFactura(error=True, error_message="<class>:
  <message>", ... all other fields None)` and does NOT propagate the exception

#### Scenario: extractor captures JSON parse error

- **WHEN** the SDK returns a string that is not valid JSON
- **THEN** the extractor returns `error=True` and `error_message` describing the parse failure

#### Scenario: extractor captures Pydantic validation error

- **WHEN** the SDK returns JSON that does not match the schema (e.g. wrong type for a field)
- **THEN** the extractor returns `error=True` and `error_message` describing the validation failure

### Requirement: Vision provider selected by VISION_PROVIDER env var via factory

The system SHALL expose `get_vision_extractor()` (cached singleton via `@lru_cache(maxsize=1)`)
that returns a `VisionExtractor` instance based on the `settings.VISION_PROVIDER` value:
`"claude"` → `ClaudeVisionExtractor`, `"openai"` → `OpenAIVisionExtractor`. Any other value
SHALL raise `ValueError` at instantiation time. The factory SHALL be the only entry point used
by the routers; the routers SHALL NOT import `ClaudeVisionExtractor` or `OpenAIVisionExtractor`
directly.

#### Scenario: VISION_PROVIDER=claude returns ClaudeVisionExtractor

- **WHEN** `settings.VISION_PROVIDER == "claude"`
- **THEN** `get_vision_extractor()` returns a `ClaudeVisionExtractor` instance

#### Scenario: VISION_PROVIDER=openai returns OpenAIVisionExtractor

- **WHEN** `settings.VISION_PROVIDER == "openai"`
- **THEN** `get_vision_extractor()` returns a `OpenAIVisionExtractor` instance

#### Scenario: factory is cached (singleton)

- **WHEN** `get_vision_extractor()` is called multiple times in the same process
- **THEN** the same instance is returned (verified by `is` identity)

#### Scenario: unsupported VISION_PROVIDER raises ValueError

- **WHEN** `settings.VISION_PROVIDER` is set to a value other than `claude` or `openai` (should
  be caught by `Settings` validation, but tested as defense in depth)
- **THEN** `get_vision_extractor()` raises `ValueError`

### Requirement: HTTP contract for POST /api/facturas/extraer-ia

The system SHALL expose `POST /api/facturas/extraer-ia` (multipart, image-only) returning
HTTP 200 with a `PropuestaFactura` JSON body on success OR on extractor failure (RN-IA-05). The
endpoint SHALL require authentication (`get_current_user`); unauthenticated requests return 401.
The endpoint SHALL apply the per-user rate limit. The endpoint SHALL NOT write to the database
(RN-IA-04). The response body SHALL always include `error: bool` and `error_message: str | None`
so the frontend can branch without inspecting absence.

#### Scenario: authenticated request with valid image returns proposal

- **WHEN** an authenticated user POSTs a valid JPEG to `/api/facturas/extraer-ia`
- **THEN** the response is 200 with a `PropuestaFactura` JSON body; on success `error=false` and
  fields are populated; on failure `error=true`, `error_message` is set, and the other fields are `None`

#### Scenario: authenticated request with rate limit exhausted returns 429

- **WHEN** an authenticated user has made 10 requests in the last hour and POSTs another
- **THEN** the response is 429 Too Many Requests with a `Retry-After` header

#### Scenario: unauthenticated request returns 401

- **WHEN** an unauthenticated request reaches the endpoint
- **THEN** the response is 401 Unauthorized and the vision extractor is NOT called

#### Scenario: the response is a PropuestaFactura JSON (not a wrapper)

- **WHEN** the request succeeds (or the extractor fails gracefully)
- **THEN** the response body matches the `PropuestaFactura` schema directly: top-level keys
  include `proveedor_nombre`, `numero`, `fecha_emision`, `monto_total`, `error`, `error_message`

### Requirement: HTTP contract for POST /api/pagos/extraer-ia

The system SHALL expose `POST /api/pagos/extraer-ia` (multipart, image-only) returning HTTP 200
with a `PropuestaPago` JSON body, mirroring the `/facturas/extraer-ia` contract. Authentication,
rate limit, image validation, graceful failure, and no-persistence rules apply identically.

#### Scenario: authenticated request with valid image returns payment proposal

- **WHEN** an authenticated user POSTs a valid PNG to `/api/pagos/extraer-ia`
- **THEN** the response is 200 with a `PropuestaPago` JSON body

#### Scenario: extractor failure returns 200 with error=true

- **WHEN** the vision SDK raises an exception during a `/api/pagos/extraer-ia` call
- **THEN** the response is 200 with `error=true`, `error_message` set, and the other fields `None`

#### Scenario: unauthenticated request returns 401

- **WHEN** an unauthenticated request reaches the endpoint
- **THEN** the response is 401 Unauthorized and the vision extractor is NOT called

### Requirement: No database writes during /extraer-ia requests (RN-IA-04)

The system SHALL NOT execute any INSERT, UPDATE, or DELETE on the `factura`, `factura_item`,
`pago`, or `proveedor` tables during a request to `POST /api/facturas/extraer-ia` or
`POST /api/pagos/extraer-ia`. The router handlers SHALL NOT receive a `Session` dependency; the
extractors SHALL NOT receive a repository or session. A regression test SHALL attach a
SQLAlchemy `before_flush` listener that captures every INSERT/UPDATE/DELETE attempted during the
request and asserts the captured list is empty.

#### Scenario: a successful /extraer-ia request produces no DB writes

- **WHEN** an authenticated user POSTs a valid image to `/api/facturas/extraer-ia` and the
  extractor returns a complete proposal
- **THEN** the `before_flush` listener captured 0 events during the request

#### Scenario: an extractor failure during /extraer-ia produces no DB writes

- **WHEN** an authenticated user POSTs a valid image and the vision SDK raises an exception
- **THEN** the `before_flush` listener captured 0 events during the request (the failure path
  does not persist the partial proposal)

#### Scenario: a rate-limited /extraer-ia request produces no DB writes

- **WHEN** an authenticated user is rate-limited and the request returns 429
- **THEN** the `before_flush` listener captured 0 events during the request (rate limiting
  happens before the extractor is called)

### Requirement: The vision proposal does not assign a proveedor (RN-IA-06)

The `proveedor_nombre` field in `PropuestaFactura` and `PropuestaPago` SHALL be returned to the
client exactly as the vision model provided it (validated as `str | None`). The system SHALL
NOT match the name against the authenticated user's `Proveedor` table, SHALL NOT resolve a
`proveedor_id`, and SHALL NOT pre-select or suggest a `Proveedor` instance in the response. The
client (frontend) is solely responsible for normalizing the name and applying the RN-VINC
matching flow against the user's `Proveedor` list.

#### Scenario: the response contains a proveedor_nombre string (not a proveedor_id)

- **WHEN** the vision model returns `{"proveedor_nombre": "Acme SA"}`
- **THEN** the response body contains `proveedor_nombre: "Acme SA"` and does NOT contain any
  `proveedor_id` field (the schema does not declare it and the system does not invent one)

#### Scenario: the backend does not call ProveedorRepository during /extraer-ia

- **WHEN** any request to `/api/facturas/extraer-ia` or `/api/pagos/extraer-ia` is made
- **THEN** no query is executed against the `proveedor` table (verified by a query log listener
  in tests, or by absence of `ProveedorRepository` import in the service module)

### Requirement: The vision proposal does not include internal fields (origen, id, usuario_id)

`PropuestaFactura` and `PropuestaPago` SHALL NOT contain any of the following fields: `id`,
`usuario_id`, `proveedor_id`, `origen`, `created_at`, `updated_at`. These are persisted-document
fields and are not part of a vision proposal. The `origen` field is set by the CRUD endpoints
(`POST /api/facturas`, `POST /api/pagos`) when the user confirms, not by the vision endpoints.

#### Scenario: PropuestaFactura has no id, usuario_id, origen, or timestamps

- **WHEN** the `PropuestaFactura` schema is introspected
- **THEN** it declares exactly: `proveedor_nombre`, `numero`, `fecha_emision`, `monto_total`,
  `error`, `error_message`

#### Scenario: PropuestaPago has no id, usuario_id, origen, or timestamps

- **WHEN** the `PropuestaPago` schema is introspected
- **THEN** it declares exactly: `proveedor_nombre`, `monto`, `fecha`, `metodo`, `error`,
  `error_message`
