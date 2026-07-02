## Context

C-05 builds on an authenticated session (C-03 backend, C-04 frontend, both archived). The `Usuario` model already carries the profile fields (`telefono`, `avatar_url`, `nombre_negocio`, `tema_preferido` enum `CLARO`/`OSCURO` default `CLARO`) from C-02, and `GET /api/me` + `get_current_user` exist from C-03. So C-05 adds no migration and no new model — it adds write paths and a frontend feature.

Two repos are touched:
- `facturas-proveedores-api` — FastAPI, Repository/Service/Router + UnitOfWork, snake_case, Pydantic-validated. Tests use real Postgres (testcontainers); Cloudinary is always mocked.
- `facturas-proveedores-web` — React 18 + TS strict (no `any`), Vite PWA, TanStack Query (server state), Zustand (UI state), Axios, Tailwind v4, feature-based. Types generated from OpenAPI.

Governance for this change is MEDIO: implement with checkpoints, surface non-obvious decisions.

## Goals / Non-Goals

**Goals:**
- Let an authenticated user edit `telefono`, `nombre_negocio`, and `tema_preferido` via `PATCH /api/me`, validated by Pydantic.
- Let the user set an avatar by uploading directly to Cloudinary through a signed preset, then storing the URL via `POST /api/me/avatar`.
- Persist the light/dark theme in the backend profile (not `localStorage`), consistent across devices.
- Keep authorization and field validation in the service/schema layers; isolate by `usuario_id` (foreign profile → 404).

**Non-Goals:**
- Changing `email`, `password`, or `nombre` (owned by registration/auth).
- Any DB migration (fields already exist).
- Persisting balances/state, notifications, or multi-theme beyond `CLARO`/`OSCURO`.
- Server-side image processing or virus scanning of uploads (out of MVP scope).

## Decisions

### D1 — Two endpoints for profile vs avatar instead of one combined PATCH
`PATCH /api/me` updates scalar profile fields; `POST /api/me/avatar` sets the avatar URL separately. Rationale: the avatar follows a distinct two-phase flow (sign preset → client uploads to Cloudinary → store URL) and should not be coupled to the scalar form save. Alternative considered: a single `PATCH /api/me` accepting `avatar_url` too. Rejected because it blurs the upload lifecycle and makes the form mutation depend on the upload completing. The avatar URL still lands on the same `Usuario` record.

### D2 — Partial update semantics via Pydantic `exclude_unset`
`PerfilUpdate` declares every field `Optional` with no default mutation; the service applies only fields explicitly sent (`model_dump(exclude_unset=True)`). This satisfies "omitted fields unchanged" without sentinel values. `tema_preferido` is the existing `TemaPreferido` enum so an invalid value yields a 422 automatically. Identity fields (`email`, `nombre`, `password`) are simply not present on the schema, so they cannot be modified through this path.

### D3 — Cloudinary signing helper reads secret from env, returns only public params
A small helper (e.g. `app/core/cloudinary.py` or a function in the service) computes the signature from `CLOUDINARY_URL`/api secret in env, plus the constrained params (`folder`/preset for avatars, `allowed_formats = pdf,jpg,png`, `max_file_size ~10MB`, `timestamp`). The response returns signature, timestamp, api key, cloud name, and the constraints — never the secret. The secret is never logged. Alternative considered: unsigned upload presets configured in the Cloudinary dashboard. Rejected: signed presets keep the constraints server-controlled and auditable, matching the security baseline.

### D4 — Backend re-validates the avatar URL (don't trust the client content-type)
`POST /api/me/avatar` validates the URL is well-formed and belongs to the configured Cloudinary account (cloud name / host check) before persisting. This honors "validate at persist time, don't trust the client" from the architecture baseline, even though the client also enforces type/size before upload.

### D5 — `tipo` is an enum on the preset endpoint, designed for extension
`GET /api/cloudinary/preset-firmado?tipo=avatar` takes a constrained `tipo` enum. For C-05 only `avatar` is valid; C-08/C-10 will extend it to `factura`/`comprobante`. Designing it as an enum now avoids a breaking signature change later. Unsupported `tipo` → 422.

### D6 — Theme: Zustand UI slice as the runtime source, backend profile as the durable source
Theme lives in a Zustand UI store at runtime and is reflected onto `document.documentElement.classList` (Tailwind v4 dark mode). Durable persistence is the backend profile via `PATCH /api/me`. On load, an init effect reads `tema_preferido` from the authenticated user (already fetched via the `me` query) and seeds the store + applies the class. `localStorage` is deliberately not used (cross-device consistency + project hard rule). Alternative considered: `localStorage` with backend sync. Rejected by the hard rule and because it can drift across devices. Trade-off: a brief default-theme flash before the `me` query resolves on cold load; acceptable for MVP and mitigated by applying the class as soon as the cached user is available.

### D7 — Avatar upload is a self-contained component using the existing Axios client + a raw Cloudinary upload
The uploader: validates type/size client-side, GETs the signed preset (typed via OpenAPI), uploads the file to Cloudinary's upload endpoint (multipart, not through our Axios instance / not `withCredentials`), then POSTs the returned `secure_url` to `/api/me/avatar` via a TanStack Query mutation that invalidates the `me` query. Errors at each stage surface to the user.

## Risks / Trade-offs

- **Cloudinary secret exposure** → Secret only in env, signing done server-side, never returned or logged (D3); preset endpoint requires auth.
- **Forged avatar URL pointing elsewhere** → Backend validates the URL is a Cloudinary URL for the configured cloud before persisting (D4).
- **Theme flash on cold load** → Apply theme as soon as the cached `me` user is available; default `CLARO` until then (D6). Acceptable for MVP.
- **Cross-tenant leakage** → All writes scoped to `usuario_id` in the service; there is only ever the caller's own record, so foreign access cannot occur (404 semantics preserved).
- **Direct client upload could bypass size limits** → Constraints are baked into the signed params server-side, so Cloudinary rejects oversized/wrong-type uploads even if the client is tampered with.

## Migration Plan

- No DB migration (fields exist since C-02).
- Backend: add schemas, service methods, routes, Cloudinary helper; ensure `CLOUDINARY_URL` is set in env (already in `.env.example` from C-01).
- Frontend: regenerate OpenAPI types after backend routes land, then build the `perfil` feature and theme wiring.
- Rollback: the endpoints are additive and the frontend feature is a new route; reverting the change removes them without affecting existing auth flows.

## Open Questions

- Exact Cloudinary folder/preset naming convention for avatars vs future factura/comprobante uploads — settle a `tipo`→folder map during apply (does not affect the contract).
- Whether the signed-preset response should include an explicit `public_id` prefix per user for easier cleanup — minor, deferrable.
