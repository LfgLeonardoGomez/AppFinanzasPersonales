# Design: c-20-radix-ui-and-feedback

## Architecture Overview

C-20 is a **frontend-only, non-feature housekeeping change** that touches the presentation layer of `facturas-proveedores-web` and leaves the backend, the data model, the API contracts, the PWA service worker registration, and the IA extraction pipeline completely untouched. The change introduces three new shared building blocks (a dialog primitive layer, a toast layer, and a global keyboard shortcuts hook), migrates two existing call sites to use them, refactors one component (`LoadingState`) to use an already-defined CSS keyframe, and bootstraps an ESLint v9 flat config that the project never had. Each of the four changes is mechanically independent and can be verified in isolation.

The architecture follows the existing feature-based layout of the frontend (`src/features/<domain>/` for domain code, `src/shared/` for cross-cutting infrastructure). The new shared building blocks land in `src/shared/`. The migration of `ProveedoresPage` and `DeleteProveedorDialog` is a local change inside `src/features/proveedores/`. The `SuccessMessage` deprecation is a mechanical replacement at three to four call sites. The ESLint setup is a new file at the web root and four entries in `package.json`.

The change does not introduce a state-management library, does not introduce a new data-fetching mechanism, does not introduce a router change, does not introduce a build-time tool beyond what `package.json` already declares. The TanStack Query + Zustand + Axios stack from C-04/C-07/C-09/C-11/C-13 is preserved verbatim. The multi-tenant cookie auth from C-03/C-04 is preserved verbatim. The PWA shell from C-01 is preserved verbatim.

## Components

### Toaster (NEW)

- **Responsibility**: Mounts `sonner`'s `<Toaster />` exactly once at the authenticated layout, themed with the project's design tokens.
- **Location**: `facturas-proveedores-web/src/shared/components/Toaster/Toaster.tsx`
- **Interface**:
  ```ts
  // Default export: a React component that renders <Toaster richColors .../>
  // Themed via CSS variables wired to the @theme tokens in index.css
  // (--toast-success-bg, --toast-error-bg, --toast-info-bg,
  //  --toast-success-fg, --toast-error-fg, --toast-info-fg)
  ```
- **Why a wrapper**: sonner is a third-party lib; wrapping it in a project component means future migrations (e.g. to react-hot-toast or to a custom build) are a one-file change, not a repo-wide search-and-replace.
- **Where it's mounted**: in `src/app/AuthenticatedLayout.tsx`, alongside `<Outlet />` and the existing theme bootstrap. The Toaster renders into a fixed position portal so it does not reflow the page (satisfies the `frontend-ui-polish` toast contract).

### Toast API (NEW — module-level helper)

- **Responsibility**: A thin module that re-exports `toast.success`, `toast.error`, `toast.info`, `toast.loading`, `toast.dismiss` from `sonner` so call sites do not import from `sonner` directly.
- **Location**: `facturas-proveedores-web/src/shared/components/Toaster/toast.ts`
- **Interface**:
  ```ts
  export const toast = {
    success: (message: string) => sonnerToast.success(message),
    error: (message: string) => sonnerToast.error(message),
    info: (message: string) => sonnerToast.info(message),
    loading: (message: string) => sonnerToast.loading(message),
    dismiss: (id: string | number) => sonnerToast.dismiss(id),
  }
  ```
- **Why a wrapper**: same reason as above — single point of customization for future telemetry opt-out, i18n, or migration. Also makes the API surface explicit (no `toast.promise` or other sonner features that this app does not need).

### useGlobalShortcuts (NEW)

- **Responsibility**: Registers a fixed set of keyboard shortcuts on `window` (or `document`), with smart suppression when the user is typing in a form field, and sequence handling for the `g` + `<key>` combos.
- **Location**: `facturas-proveedores-web/src/shared/hooks/useGlobalShortcuts.ts`
- **Interface**:
  ```ts
  interface ShortcutBinding {
    keys: string[]                   // e.g. ['n'], ['g', 'p'], ['/']
    description: string              // e.g. 'Cargar factura'
    action: () => void
    when?: () => boolean             // optional extra condition (e.g. !isOnNewFactura)
  }

  export function useGlobalShortcuts(bindings: ShortcutBinding[]): void
  ```
- **Behavior**:
  - Listens on `window` for `keydown`.
  - Skips the event if `event.target instanceof HTMLElement` AND the target is `<input>`, `<textarea>`, or `[contenteditable]`.
  - Skips the event if Radix's open dialog has focus (detected by querying for `[role="dialog"]` and checking `contains(document.activeElement)`).
  - Maintains a `Map<string, number>` of last-key-timestamp for sequence matching; the sequence window is 1000 ms.
  - `g` (when pressed alone) sets the `g` "prefix" timestamp; the next keypress within 1000 ms is matched against bindings.
  - The `n` binding passes a `when: () => location.pathname !== '/facturas/nueva'` so the shortcut is a no-op on its own destination.
- **Why a hook (not module-level init)**: routes mount and unmount with React Router. A hook tied to the `AuthenticatedLayout`'s lifecycle means shortcuts are bound exactly once per authenticated session and cleaned up on logout.

### ProveedorDialog (NEW — extracted from ProveedoresPage)

- **Responsibility**: Wraps the existing `ProveedorForm` in a Radix `Dialog.Root` with proper a11y attributes, focus trap, and Esc handling. Replaces the custom modal in `ProveedoresPage.tsx:46-83`.
- **Location**: `facturas-proveedores-web/src/features/proveedores/components/ProveedorDialog.tsx`
- **Interface**:
  ```ts
  interface ProveedorDialogProps {
    mode: 'create' | 'edit'
    proveedor?: Proveedor | null
    onSuccess: (saved: Proveedor) => void
    onCancel: () => void
  }
  ```
- **Why a new component (not in-place migration)**: a separate component is testable in isolation with RTL, satisfies the `proveedores-frontend` spec's scenario "dialog opens with focus on the first field" cleanly, and lets the existing `ProveedorForm` remain an unstyled form that works inside both a Radix Dialog and (potentially, in the future) a side panel.

### DeleteProveedorDialog migration (MODIFIED)

- **Responsibility**: Replace the custom modal pattern in `DeleteProveedorDialog.tsx` with Radix `AlertDialog`. Focus the Cancel button by default (per `frontend-ui-polish` destructive dialog contract). Do NOT close on backdrop click (per `proveedores-frontend` delta).
- **Location**: `facturas-proveedores-web/src/features/proveedores/components/DeleteProveedorDialog.tsx`
- **Interface**: unchanged from C-07 (`onConfirm: () => void`, `onCancel: () => void`, `proveedorNombre: string`).

### SuccessMessage deprecation (MODIFIED)

- **Responsibility**: Mark `SuccessMessage` as `@deprecated` in JSDoc with a `@see` pointing at the new `toast` helper. Do NOT remove the component or its existing test in this change.
- **Location**: `facturas-proveedores-web/src/shared/components/SuccessMessage/SuccessMessage.tsx`
- **Call sites migrated** (one-for-one replacement of `setSuccessMessage` + JSX with `toast.success`):
  - `src/features/proveedores/ProveedoresPage.tsx:38-49` → remove the `useState` for `successMessage`, replace `setSuccessMessage(...)` with `toast.success(...)`, remove the JSX render of `<SuccessMessage>`.
  - `src/features/proveedores/ProveedorDetailPage.tsx` (if it has the same pattern) → same.
  - `src/features/perfil/PerfilPage.tsx` (if it has the same pattern) → same.
- **Removed**: local `useState<string | null>(null)` for the success message at each migrated call site.

### LoadingState skeleton refactor (MODIFIED)

- **Responsibility**: Render a shimmer skeleton (placeholder rectangles with the existing `animate-shimmer` keyframe) instead of the current spinner. Maintain the same public API.
- **Location**: `facturas-proveedores-web/src/shared/components/LoadingState/LoadingState.tsx`
- **Interface**: unchanged (`<LoadingState />`, no props).
- **Internal change**: replace the `<Loader2 />` lucide-react icon with three stacked `<div>`s that have the `animate-shimmer` class. Container gets `aria-busy="true"` and `aria-label="Cargando"`.

### eslint.config.js (NEW)

- **Responsibility**: ESLint v9 flat config that lints `src/**/*.{ts,tsx}` with the rule set described in the proposal.
- **Location**: `facturas-proveedores-web/eslint.config.js`
- **Imports**:
  ```js
  import js from '@eslint/js'
  import tseslint from 'typescript-eslint'
  import react from 'eslint-plugin-react'
  import reactHooks from 'eslint-plugin-react-hooks'
  import reactRefresh from 'eslint-plugin-react-refresh'
  ```
- **Rule set** (conservative, passes clean against current code):
  - `@eslint/js` recommended (the v9 baseline).
  - `typescript-eslint` recommended (the v8 baseline; the v9 `typescript-eslint` package exposes both `recommended` and `strict`).
  - `react/jsx-uses-react` and `react/react-in-jsx-scope` are OFF (React 17+ JSX transform, project uses React 18).
  - `react-hooks/rules-of-hooks`: error. `react-hooks/exhaustive-deps`: warn.
  - `react-refresh/only-export-components`: warn (Vite HMR pattern; this may be promoted to error in a future change if it stabilizes).
  - `no-unused-vars`: error, with `{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }` (the project already uses `_` prefixes to opt out).
  - `no-console`: warn (so a stray `console.log` in a feature file is flagged, not blocked).
- **Why these choices**: every rule above either (a) catches a real bug class, (b) is required by tooling, or (c) is in the official "recommended" set of its plugin. Aggressive stylistic rules (e.g. `prefer-const` autofix aggressive mode, `no-explicit-any` enforcement) are deferred because they would force changes to productive code without a clear bug-prevention payoff.

### Frontend lint regression-guard test (NEW)

- **Responsibility**: Executes `npm run lint` as a child process and asserts exit code 0. Skipped if `node_modules/` is absent.
- **Location**: `facturas-proveedores-web/tests/frontend-lint.test.ts` (new file, top-level under `tests/`, not under `src/`).
- **Interface**:
  ```ts
  describe('frontend lint baseline', () => {
    it('npm run lint exits 0', () => {
      if (!existsSync('node_modules')) {
        return it.skip('node_modules not installed')
      }
      const result = execSync('npm run lint', { encoding: 'utf-8' })
      expect(result.status).toBe(0)
    })
  })
  ```
- **Why a top-level test (not under `src/`)**: the project's vitest config in `vite.config.ts` typically scopes `vitest` to `src/**`. A top-level test for the lint command needs to be picked up by an explicit include. The test is structured to be opt-in via a `vitest.config.ts` extension or a dedicated `lint.test.config.ts` so it does not slow down the inner loop.

## Data Model

**No data model changes.** No new tables, no new columns, no Alembic migrations, no Pydantic schema changes. The change is entirely UI-layer.

## API Changes

**No API changes.** No new endpoints, no modified contracts, no changes to `app/routers/`, `app/services/`, or `app/schemas/`. The TypeScript types in `src/shared/api/api.d.ts` (generated from OpenAPI) are unchanged. The change is entirely UI-layer.

## Implementation Notes

### Why Radix Primitives (not shadcn/ui)

shadcn/ui is a popular choice but its design contract is "Radix primitives + Tailwind classes + CSS variables in HSL". Our project's design system is already custom (navy/cream/violet, Playfair Display + DM Sans, custom easings in `@theme`). Adopting shadcn/ui would require either re-templating every component to use our tokens (defeating the time-saving purpose) or accepting two parallel design systems in the same app (UX inconsistency). Going with Radix Primitives + our own Tailwind classes means we own the design system end-to-end. The cost is a one-time `Dialog`/`AlertDialog` wrapper per use case; we get to write it once and reuse.

### Why sonner (not react-hot-toast or react-toastify)

- sonner is the most actively maintained toast library as of 2024-2026.
- Headless: the visual layer is fully customizable via CSS variables; no `!important` wars with our Tailwind.
- Theme-friendly: ships a `theme` prop and a CSS variable surface; we can wire it to our `@theme` tokens.
- Promise support (`toast.promise`): not used in this change but available for future flows.
- Bundle: ~5 KB gzipped for the core, smaller than react-toastify.

### Why not migrate the IA modal (PropuestaIAModal) to Radix Dialog in this change

D-19 (project decision) says "the IA modal is intentionally blocking — the user just chose 'Cargar con IA', their intent is clear, and a non-blocking sidebar risks confirming with empty fields". Radix Dialog is a `role="dialog"` with focus trap and Esc-closes; this is a behavior change (Esc would close the modal, which is currently the user's escape from an incomplete extract). Migrating the IA modal would either require disabling the Esc behavior on Radix Dialog (which is a Radix anti-pattern) or revisiting D-19, which is a UX product decision the user has already weighed. Out of scope for C-20.

### Sequence handling in useGlobalShortcuts

The `g` + `<key>` pattern is borrowed from GitHub's keyboard shortcuts. Implementation: maintain a `prefix: { key: string; timestamp: number } | null` in a ref. On keydown:
1. If no prefix and key is `g` → set prefix `{ key: 'g', timestamp: now }`, return.
2. If prefix is `g` and key is one of `{p, f, c}` and (now - timestamp) < 1000 → fire binding, clear prefix.
3. If prefix is `g` and key is anything else → clear prefix.
4. If prefix is `g` and (now - timestamp) > 1000 → clear prefix, treat current key as a fresh single-key press.

The 1000 ms window matches GitHub's. Tests will assert both the happy path (`g` then `p` within 500 ms) and the timeout case (`g`, wait 1500 ms, press `p` — should NOT navigate).

### Form-field suppression

The "is the user typing?" check uses:
```ts
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (target.isContentEditable) return true
  return false
}
```
Tests will assert: focus an `<input>`, press `n`, the input's value gains an `n` and no navigation occurs. Also: focus a `<button>`, press `n`, navigation occurs.

### ESLint config format: flat config only

ESLint v9 dropped legacy `.eslintrc.*` support. The new format is `eslint.config.js` (or `.mjs`, `.cjs`, `.ts`) at the project root exporting a flat config array. We use `eslint.config.js` (CommonJS-or-ESM depending on `package.json` `type`; the project's `package.json` has `"type": "module"`, so the config must be `eslint.config.js` with ESM imports OR `eslint.config.mjs`). Decision: use `eslint.config.js` with ESM syntax; the file is JS, the project's `type: module` makes the import statements work natively.

## Risks & Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Radix Dialog changes the DOM in a way that breaks the existing test that asserts the modal markup | Medium | Migrate the test alongside the component; preserve the `aria-label="Formulario de proveedor"` so any test that selects by accessible name continues to work. Triangulate with `toHaveRole('dialog')` instead of CSS class assertions. |
| sonner SSR-incompatible (this is a PWA / SPA, but worth flagging) | Low | sonner is client-only by design; the `<Toaster />` is mounted inside `AuthenticatedLayout` which is always client-rendered. Document the no-SSR constraint in a code comment. |
| `useGlobalShortcuts` interferes with browser shortcuts (e.g. `Ctrl+L` for address bar) | Low | We only bind single-letter keys (`n`, `/`, `g`) and they only fire when no modifier is held (`!event.ctrlKey && !event.metaKey && !event.altKey`). Browser shortcuts with modifiers are not intercepted. |
| ESLint config too strict → hundreds of errors in existing code | Medium | Conservative rule set (only `recommended` from each plugin + `no-unused-vars` + react-hooks); aggressive rules deferred. If any single file still trips a recommended rule, that file gets a one-line `// eslint-disable-next-line <rule>` with a comment explaining why. Never blanket-ignore. |
| `eslint-disable` comments proliferate as debt | Low | The lint regression-guard test asserts exit 0 but does not assert zero `eslint-disable` comments. We will NOT enforce that in this change (it is a separate concern, would be its own change). Documented in the proposal's out-of-scope. |
| Test pollution re-introduced by adding a new test file (`frontend-lint.test.ts`) | Low | The test uses `execSync`, which is synchronous and does not mutate global state. No fixtures, no monkeypatching, no env mutation. Risk is negligible. |
| Tailwind v4 alpha conflicts with sonner or Radix CSS | Low | Both Radix and sonner are CSS-agnostic. Radix ships with a separate stylesheet only if you use `@radix-ui/themes` (we are not); we use the unstyled primitives and style with Tailwind. sonner uses CSS variables for theming; our `index.css` already defines CSS variables in `@theme` that we can reference from sonner's overrides. |
| ESLint v9 + typescript-eslint v8 + Vite HMR require specific node version | Low | Project already requires `>=3.11` (Python) and uses `node:20-slim` in the Dockerfile. Node 20 supports everything we need. No upgrade required. |
| The renamed change (`c-20`) collides with something in CHANGES.md the user has not published yet | Low | We already verified: C-20 is free; C-19 is the archived `fix-dev-setup`. The CHANGES.md update reflects this. |
| Monorepo absorption means `facturas-proveedores-web/` is no longer isolated; changes here could affect sibling projects | Low | Verified: the repo has no `package.json` at the root and no npm workspaces. `facturas-proveedores-web/` is a fully self-contained project inside a repo. Changes here are local. |
