## Why

After authentication (C-04), an authenticated user has no way to complete their profile or control the app's appearance. The data model already reserves `telefono`, `avatar_url`, `nombre_negocio`, and `tema_preferido` on `Usuario` (all optional), but no endpoints or UI exist to read/update them. F-PERF-01 and F-PERF-02 require an in-app profile screen, a Cloudinary-backed avatar, and a light/dark theme that is persisted in the backend (not `localStorage`) so it stays consistent across devices.

## What Changes

- **Backend — profile update**: `PATCH /api/me` updates the optional profile fields (`telefono`, `nombre_negocio`, `tema_preferido`). All fields optional; absence never blocks. Pydantic validates each field (enum for theme, length/format for the rest) on the backend regardless of frontend validation.
- **Backend — avatar**: `POST /api/me/avatar` receives a Cloudinary URL (the frontend uploads directly via a signed preset) and updates `avatar_url` after validating the URL.
- **Backend — signed upload preset**: `GET /api/cloudinary/preset-firmado?tipo=avatar` returns a signed Cloudinary upload preset scoped to avatars, constraining content-type (PDF/jpg/png) and max size (~10 MB). The signing secret stays in env vars.
- **Backend — service methods**: `usuario_service.actualizar_perfil(usuario_id, datos)` and `usuario_service.actualizar_avatar(usuario_id, url)`. Authorization is enforced in the service layer by scoping every operation to `usuario_id`; a resource that does not belong to the user resolves to 404 (never 403).
- **Frontend — profile page**: `src/features/perfil/PerfilPage.tsx` with an editable form (`telefono`, `nombre_negocio`) and a light/dark theme switch.
- **Frontend — theme persistence**: theme toggle wired to Zustand + `document.documentElement.classList`, persisted via `PATCH /api/me` (`tema_preferido`). **Never** uses `localStorage`. On load, theme is applied from the authenticated user's profile.
- **Frontend — avatar upload**: component that fetches the signed preset from the backend, uploads the file directly to Cloudinary, then calls `POST /api/me/avatar` with the resulting URL.

## Capabilities

### New Capabilities
- `perfil-usuario-api`: backend profile management — update profile fields, set avatar from a Cloudinary URL, and issue scoped signed upload presets for avatars; all service-layer authorized and Pydantic-validated.
- `perfil-usuario-frontend`: in-app profile screen — editable profile form, avatar upload through a signed Cloudinary preset, and a light/dark theme switch persisted in the backend (no `localStorage`).

### Modified Capabilities
<!-- None. The existing auth-backend/auth-frontend capabilities are not having their requirements changed; C-05 introduces new profile capabilities that build on top of the authenticated session. -->

## Impact

- **Backend (`facturas-proveedores-api`)**: new routes on `app/routers/usuarios.py` (`PATCH /api/me`, `POST /api/me/avatar`) and a new/extended Cloudinary preset endpoint (`GET /api/cloudinary/preset-firmado?tipo=avatar`); new methods in `app/services/usuario_service.py`; new Pydantic schemas (`PerfilUpdate`, `AvatarUpdate`, signed-preset response); a Cloudinary signing helper reading credentials from env (`CLOUDINARY_URL`). No DB migration — `Usuario` fields already exist (C-02). The existing `GET /api/me` (C-03) is reused for reads.
- **Frontend (`facturas-proveedores-web`)**: new `src/features/perfil/` feature (page, form, avatar uploader, theme switch); theme wiring in `src/app/theme/` + a Zustand UI slice; TanStack Query hooks for profile read/update and avatar; Axios calls typed from regenerated OpenAPI types.
- **Dependencies**: Cloudinary (signed upload); no new libraries beyond what C-01 set up. Depends on C-04 (auth-frontend) ✓ archived and C-03 (`GET /api/me`, `get_current_user`) ✓ archived.
- **Out of scope**: changing email/password/`nombre` (registration owns those), notifications, and any persisted balance/state. Theme has exactly two values (`CLARO`/`OSCURO`).
