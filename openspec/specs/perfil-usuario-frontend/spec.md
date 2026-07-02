# perfil-usuario-frontend Specification

## Purpose

Provide the in-app profile screen of the PWA (`facturas-proveedores-web`) that lets the authenticated user view and edit their optional profile fields, upload a Cloudinary-hosted avatar, and toggle a light/dark theme that persists across devices via the backend (not `localStorage`). Shipped by C-05, this capability exposes the `PerfilPage` at `src/features/perfil/PerfilPage.tsx` with an editable form for `telefono` and `nombre_negocio` (both optional, leaving them empty never blocks saving), an avatar uploader that follows the C-04 two-phase flow (fetch the signed preset from `GET /api/cloudinary/preset-firmado?tipo=avatar`, upload the file directly to Cloudinary, then `POST /api/me/avatar` with the returned `secure_url`, which in turn invalidates the `me` TanStack Query), and a light/dark theme switch. The theme runtime source is a Zustand UI slice reflected onto `document.documentElement.classList` for Tailwind v4 dark mode, while the durable source is the backend profile via `PATCH /api/me`; on load, an init effect reads `tema_preferido` from the cached `me` user and seeds the store + applies the class, so the theme is consistent across devices and `localStorage` is deliberately never used. All HTTP calls go through the shared `apiClient` with `withCredentials` and the 401 silent-refresh interceptor from C-04, all types come from `@shared/api/api` (extended with the C-05 `PerfilUpdate`, `AvatarUpdate`, and signed-preset shapes; no `any`), and the route is gated by `RequireAuth` from C-04. All tests are offline: Vitest + React Testing Library + MSW, with Cloudinary never hit for real.
## Requirements
### Requirement: In-app editable profile page

The system SHALL provide a profile page at `src/features/perfil/PerfilPage.tsx` that lets the authenticated user view and edit their optional profile fields `telefono` and `nombre_negocio`. The form MUST load current values from the authenticated user's profile and persist changes via `PATCH /api/me` using a TanStack Query mutation. All fields are optional; leaving them empty MUST NOT block saving.

#### Scenario: Editing and saving updates the profile
- **WHEN** the user opens the profile page, changes `telefono` and `nombre_negocio`, and saves
- **THEN** the app calls `PATCH /api/me` with the changed fields and reflects the saved values after the mutation succeeds

#### Scenario: Empty optional fields are allowed
- **WHEN** the user clears `telefono` and `nombre_negocio` and saves
- **THEN** the app saves successfully without a blocking validation error

### Requirement: Light/dark theme switch persisted in the backend

The system SHALL provide a light/dark theme switch on the profile page wired to a Zustand UI store and to `document.documentElement.classList`, and MUST persist the selected theme to the backend via `PATCH /api/me` (`tema_preferido`). The app MUST NOT use `localStorage` for theme persistence. On application load for an authenticated user, the theme MUST be applied from the user's profile `tema_preferido`.

#### Scenario: Toggling theme applies and persists it
- **WHEN** the user toggles the theme from light to dark
- **THEN** the app adds/removes the dark class on `document.documentElement`, updates the Zustand store, and calls `PATCH /api/me` with `tema_preferido = "OSCURO"`

#### Scenario: Theme survives a reload via the backend
- **WHEN** the user has saved `tema_preferido = "OSCURO"` and reloads the app while authenticated
- **THEN** the app reads the theme from the user's profile and renders in dark mode without reading `localStorage`

#### Scenario: localStorage is not used for theme
- **WHEN** the theme is toggled and the app reloads
- **THEN** the persisted theme comes from the backend profile, and no theme value is read from or written to `localStorage`

### Requirement: Avatar upload via signed Cloudinary preset

The system SHALL provide an avatar upload component that (1) requests a signed preset from `GET /api/cloudinary/preset-firmado?tipo=avatar`, (2) uploads the selected file directly to Cloudinary using that preset, and (3) calls `POST /api/me/avatar` with the resulting Cloudinary URL. The component MUST accept only PDF/JPG/PNG files up to ~10 MB and surface upload errors to the user.

#### Scenario: Successful avatar upload flow
- **WHEN** the user selects a valid image and confirms the upload
- **THEN** the app fetches the signed preset, uploads the file to Cloudinary, and calls `POST /api/me/avatar` with the returned URL, then displays the new avatar

#### Scenario: Invalid file type or size is blocked client-side
- **WHEN** the user selects a file that is not PDF/JPG/PNG or exceeds ~10 MB
- **THEN** the app blocks the upload and shows a validation message without calling the backend avatar endpoint

#### Scenario: Cloudinary upload failure is surfaced
- **WHEN** the direct upload to Cloudinary fails
- **THEN** the app shows an error message and does not call `POST /api/me/avatar`

