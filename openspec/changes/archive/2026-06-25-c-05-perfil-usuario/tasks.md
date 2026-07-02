# Tasks — c-05-perfil-usuario

> Two repos. Backend = `facturas-proveedores-api`, Frontend = `facturas-proveedores-web`.
> Strict TDD: write the failing test first, then minimum code, then triangulate, then refactor.
> Backend tests use real Postgres (testcontainers); Cloudinary is always mocked. No SQLite.

## 1. Backend — Pydantic schemas

- [x] 1.1 Add `PerfilUpdate` schema (all fields optional: `telefono`, `nombre_negocio`, `tema_preferido` as `TemaPreferido` enum); no `email`/`nombre`/`password` fields; partial-update via `exclude_unset`
- [x] 1.2 Add `AvatarUpdate` schema with a validated Cloudinary URL field (well-formed + Cloudinary host/cloud-name check)
- [x] 1.3 Add `PresetFirmadoResponse` schema (signature, timestamp, api_key, cloud_name, constraints) and a `TipoUpload` enum with `avatar` (designed to extend to `factura`/`comprobante`)

## 2. Backend — service layer (usuario_service)

- [x] 2.1 RED: test `actualizar_perfil(usuario_id, datos)` updates only provided fields, leaves others unchanged, persists in DB
- [x] 2.2 GREEN+TRIANGULATE: implement `actualizar_perfil`; cover subset update, omitted-field-unchanged, theme change; scope all reads/writes by `usuario_id`
- [x] 2.3 RED: test `actualizar_avatar(usuario_id, url)` sets `avatar_url` and persists; rejects non-Cloudinary URL
- [x] 2.4 GREEN+TRIANGULATE: implement `actualizar_avatar`; valid URL persists, malformed/foreign URL raises validation error
- [x] 2.5 Verify isolation: a profile operation only ever touches the authenticated user's record (foreign access impossible → 404 semantics preserved)

## 3. Backend — Cloudinary signing helper

- [x] 3.1 RED: test the signing helper produces a signature from the env secret and constrains content-type (PDF/JPG/PNG) and max size (~10 MB), and never returns/logs the secret (Cloudinary mocked)
- [x] 3.2 GREEN+REFACTOR: implement `app/core/cloudinary.py` (or service function) reading `CLOUDINARY_URL` from env; return only public params for `tipo=avatar`

## 4. Backend — routes (usuarios.py + cloudinary preset)

- [x] 4.1 RED: integration test `PATCH /api/me` — authenticated subset update returns updated profile; invalid `tema_preferido` → 422; identity fields not changed; unauthenticated → 401
- [x] 4.2 GREEN: implement `PATCH /api/me` wiring `get_current_user` → `actualizar_perfil`
- [x] 4.3 RED: integration test `POST /api/me/avatar` — valid Cloudinary URL updates avatar; malformed → 422; unauthenticated → 401
- [x] 4.4 GREEN: implement `POST /api/me/avatar` wiring `get_current_user` → `actualizar_avatar`
- [x] 4.5 RED: integration test `GET /api/cloudinary/preset-firmado?tipo=avatar` — authenticated returns signed preset with constraints; secret absent from response; unsupported `tipo` → 422; unauthenticated → 401
- [x] 4.6 GREEN: implement the preset endpoint using the signing helper

## 5. Backend — verify suite

- [x] 5.1 Run the full backend test suite against real Postgres; all green; confirm no secret leaks in logs

## 6. Frontend — types & API layer

- [x] 6.1 Regenerate OpenAPI types (`generate-types`) so the new endpoints/schemas are typed (no `any`)
- [x] 6.2 Add typed Axios functions in `src/shared/api/` for `PATCH /api/me`, `POST /api/me/avatar`, `GET /api/cloudinary/preset-firmado`

## 7. Frontend — theme (Zustand + Tailwind, backend-persisted)

- [x] 7.1 RED: test the theme store/effect applies `document.documentElement.classList` and persists via `PATCH /api/me` (`tema_preferido`), never touching `localStorage` (MSW)
- [x] 7.2 GREEN: implement Zustand UI slice + `src/app/theme/` init that seeds from the authenticated `me` profile and applies the dark class
- [x] 7.3 TRIANGULATE: test theme survives reload by reading from the backend profile (not `localStorage`)

## 8. Frontend — profile page & form

- [x] 8.1 RED: test `PerfilPage` loads current `telefono`/`nombre_negocio` and saving calls `PATCH /api/me` with changed fields (MSW); empty optional fields allowed
- [x] 8.2 GREEN: implement `src/features/perfil/PerfilPage.tsx` with the editable form + TanStack Query mutation that invalidates the `me` query
- [x] 8.3 Wire the theme switch into the profile page

## 9. Frontend — avatar upload

- [x] 9.1 RED: test the avatar uploader fetches the signed preset, uploads to Cloudinary, then calls `POST /api/me/avatar` with the URL (MSW); blocks non-PDF/JPG/PNG or >10 MB client-side; surfaces Cloudinary upload failure
- [x] 9.2 GREEN: implement the avatar upload component (validate → sign → upload to Cloudinary → store URL → invalidate `me`)

## 10. Frontend — verify & wire-up

- [x] 10.1 Add the profile route under `RequireAuth` in `src/app/router.tsx`
- [x] 10.2 Run the full frontend test suite (Vitest + RTL + MSW); all green; TS strict passes with no `any`
