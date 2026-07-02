# perfil-usuario-api Specification

## Purpose

Provide the backend write paths for the authenticated user's profile so the C-04 session can be enriched with a display name, a business name, a contact phone, a Cloudinary-hosted avatar, and a per-user light/dark theme that persists across devices. Shipped by C-05, this capability exposes `PATCH /api/me` (updates the optional profile fields `telefono`, `nombre_negocio`, and `tema_preferido` — every field is `Optional` and `model_dump(exclude_unset=True)` ensures omitted fields are not touched, so identity fields `email`, `nombre`, and `password` are never reachable through this path), `POST /api/me/avatar` (accepts a Cloudinary `secure_url` and validates that the URL is well-formed and belongs to the configured Cloudinary account before persisting it on `Usuario.avatar_url`), and `GET /api/cloudinary/preset-firmado?tipo=avatar` (returns a signed Cloudinary upload preset constrained to PDF / JPG / PNG and ≤ 10 MB; the signing secret is read from `settings.CLOUDINARY_URL` server-side, never returned or logged). All write paths are authorized in the service layer (`UsuarioService.actualizar_perfil`, `UsuarioService.actualizar_avatar`) by scoping every operation to the caller's `usuario_id` — there is only ever the caller's own record, so foreign access resolves to 404 and identity fields cannot be modified through this surface. The `tipo` parameter on the preset endpoint is a Pydantic enum, designed for extension: C-08 added `factura` and C-10 added `comprobante`, with `avatar` shipped here; unsupported `tipo` returns 422. Pydantic validation is authoritative regardless of any frontend validation, and `tema_preferido` is constrained to the existing `TemaPreferido` enum (`CLARO|OSCURO`).
## Requirements
### Requirement: Update authenticated user's profile fields

The system SHALL provide `PATCH /api/me` that updates the authenticated user's optional profile fields: `telefono`, `nombre_negocio`, and `tema_preferido`. All fields are optional and any omitted field MUST be left unchanged. The operation MUST be authorized in the service layer scoped to the authenticated `usuario_id`, and MUST NOT allow changing `email`, `password`, or `nombre`. Validation MUST be enforced with Pydantic on the backend regardless of any frontend validation.

#### Scenario: Update a subset of fields persists in the database
- **WHEN** an authenticated user sends `PATCH /api/me` with `{ "telefono": "1122334455", "nombre_negocio": "Kiosco Don Pepe" }`
- **THEN** the system updates only `telefono` and `nombre_negocio` for that user, leaves `tema_preferido` unchanged, persists the change, and returns the updated profile

#### Scenario: Omitted fields are not modified
- **WHEN** an authenticated user sends `PATCH /api/me` with `{ "tema_preferido": "OSCURO" }` and previously had `telefono = "1100000000"`
- **THEN** `tema_preferido` becomes `OSCURO` and `telefono` remains `"1100000000"`

#### Scenario: Invalid theme value is rejected
- **WHEN** an authenticated user sends `PATCH /api/me` with `{ "tema_preferido": "ROSA" }`
- **THEN** the system rejects the request with a 422 validation error and does not modify the profile

#### Scenario: Attempt to change identity fields is rejected or ignored
- **WHEN** an authenticated user sends `PATCH /api/me` with `{ "email": "otro@x.com" }` or `{ "nombre": "Otro" }`
- **THEN** the system does not change `email` or `nombre` (the field is rejected as not allowed or ignored), and these values remain as set at registration

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated caller sends `PATCH /api/me`
- **THEN** the system responds 401 and performs no update

### Requirement: Set the authenticated user's avatar from a Cloudinary URL

The system SHALL provide `POST /api/me/avatar` that receives a Cloudinary URL and updates the authenticated user's `avatar_url` via `usuario_service.actualizar_avatar(usuario_id, url)`. The URL MUST be validated (well-formed and belonging to the configured Cloudinary account) with Pydantic on the backend before persisting. The operation MUST be scoped to the authenticated `usuario_id` in the service layer.

#### Scenario: Valid Cloudinary URL updates avatar
- **WHEN** an authenticated user sends `POST /api/me/avatar` with a valid Cloudinary URL
- **THEN** the system sets `avatar_url` to that URL for the authenticated user, persists it, and returns the updated profile

#### Scenario: Malformed URL is rejected
- **WHEN** an authenticated user sends `POST /api/me/avatar` with a value that is not a valid URL or not a Cloudinary URL
- **THEN** the system rejects the request with a 422 validation error and does not modify `avatar_url`

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated caller sends `POST /api/me/avatar`
- **THEN** the system responds 401 and performs no update

### Requirement: Issue a signed Cloudinary upload preset for avatars

The system SHALL provide `GET /api/cloudinary/preset-firmado?tipo=avatar` that returns a signed Cloudinary upload preset scoped to avatar uploads. The signed parameters MUST constrain the allowed content types to PDF, JPG, and PNG and the maximum file size to ~10 MB. The Cloudinary signing secret MUST be read from environment variables and MUST NOT appear in the response or in logs. The endpoint MUST require an authenticated user.

#### Scenario: Authenticated request returns a signed preset
- **WHEN** an authenticated user requests `GET /api/cloudinary/preset-firmado?tipo=avatar`
- **THEN** the system returns a signed payload (signature, timestamp, api key, and upload constraints) that the client can use to upload directly to Cloudinary, with content-type limited to PDF/JPG/PNG and max size ~10 MB

#### Scenario: Signing secret is never exposed
- **WHEN** the signed preset is returned
- **THEN** the response contains the public signature parameters but never the Cloudinary API secret, and the secret is not written to logs

#### Scenario: Unsupported tipo is rejected
- **WHEN** an authenticated user requests the preset with an unsupported `tipo` value
- **THEN** the system rejects the request with a validation error and returns no signed preset

#### Scenario: Unauthenticated request is rejected
- **WHEN** an unauthenticated caller requests the signed preset
- **THEN** the system responds 401 and returns no signed preset

### Requirement: Profile operations are isolated per user

The system SHALL ensure that profile read and write operations always operate on the authenticated user's own record, scoped by `usuario_id` in the service layer. A user MUST never be able to read or modify another user's profile; any such attempt MUST resolve to 404 rather than 403.

#### Scenario: A user only ever affects their own profile
- **WHEN** user A is authenticated and performs `PATCH /api/me` or `POST /api/me/avatar`
- **THEN** only user A's record is read and modified, and user B's profile is never affected

