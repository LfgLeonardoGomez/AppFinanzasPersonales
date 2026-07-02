## ADDED Requirements

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
