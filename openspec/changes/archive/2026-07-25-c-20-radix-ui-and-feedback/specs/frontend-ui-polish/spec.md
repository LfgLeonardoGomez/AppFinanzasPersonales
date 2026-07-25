# Frontend UI Polish Specification

## Purpose

This umbrella capability covers the UX-polish layer of the PWA frontend (`facturas-proveedores-web`) that sits above the existing feature capabilities (auth, proveedores, facturas, pagos, cuenta-corriente, ia-vision, perfil). It defines the cross-cutting contracts for: (a) accessible modal/dialog rendering, (b) non-blocking toast feedback, (c) keyboard shortcuts for power users, and (d) loading-state skeletons. It does **not** introduce new product features, new endpoints, new business rules, or new database columns — it refactors **how** existing flows surface their state, preserving the **what** of every feature capability.

The capability is implemented on top of the existing design system (Tailwind v4 `@theme` tokens, navy/cream/violet palette, Playfair Display + DM Sans typography, `animate-fade-in-up` and `animate-shimmer` keyframes). It does not introduce a new visual language; it strengthens the existing one.

## ADDED Requirements

### Requirement: Modals and dialogs expose accessible semantics and focus management

Every modal, dialog, or confirmation prompt in the frontend SHALL be rendered with the WAI-ARIA `dialog` pattern: the container SHALL expose `role="dialog"` (or `role="alertdialog"` for destructive confirmations), `aria-modal="true"`, and a programmatic `aria-label` or `aria-labelledby` referencing the dialog title. When a dialog opens, the first focusable element inside SHALL receive focus; while the dialog is open, focus SHALL be trapped inside; when the dialog closes, focus SHALL return to the element that triggered it. The dialog SHALL close when the user presses the `Esc` key, and SHALL optionally close when the user clicks the backdrop outside the dialog content (destructive `alertdialog` confirmations may suppress backdrop close to force explicit choice).

#### Scenario: dialog opens with focus on the first focusable element

- **WHEN** a user opens a modal/dialog (create, edit, or confirmation) via its trigger
- **THEN** the dialog element has `role="dialog"` and `aria-modal="true"`, and the first focusable child of the dialog content receives focus within the same animation frame

#### Scenario: dialog traps focus inside the content

- **WHEN** a dialog is open and the user presses `Tab` repeatedly or `Shift+Tab` from the last/first focusable element
- **THEN** focus cycles within the dialog content and does not escape to the underlying page

#### Scenario: dialog closes when the user presses Esc

- **WHEN** a dialog is open and the user presses the `Esc` key
- **THEN** the dialog closes and focus returns to the element that opened it

#### Scenario: dialog returns focus to the trigger on close

- **WHEN** a dialog closes (via Esc, cancel button, or backdrop click)
- **THEN** focus is restored to the trigger element (the button that opened the dialog)

#### Scenario: alertdialog does not close on backdrop click for destructive actions

- **WHEN** an `alertdialog` (destructive confirmation, e.g. delete with dependencies) is open
- **THEN** clicking the backdrop does NOT close the dialog; the user MUST explicitly choose "Confirmar" or "Cancelar"

#### Scenario: dialog has a programmatic label

- **WHEN** a dialog renders
- **THEN** the dialog content has an `aria-label` or `aria-labelledby` that names the dialog (e.g. "Formulario de proveedor", "Confirmar eliminación")

### Requirement: Toasts provide non-blocking feedback with auto-dismiss

A toast notification system SHALL be available globally (mounted at the authenticated layout). Toasts SHALL be categorized as `success`, `error`, or `info`, each with a distinct visual treatment that matches the existing design tokens. Toasts SHALL appear in a fixed position (top-right on desktop, top-center on mobile) without displacing or shifting the underlying layout (no layout reflow). Success and info toasts SHALL auto-dismiss after a fixed timeout. Error toasts SHALL persist until the user dismisses them, but SHALL not block pointer interaction with the page below. Toasts SHALL be aria-live (`role="status"` for success/info, `role="alert"` for error) so screen readers announce them.

#### Scenario: success toast appears and auto-dismisses

- **WHEN** a mutation (create/update/delete) succeeds and the calling code invokes the success toast
- **THEN** a success-styled toast appears in the configured position, is announced to screen readers, and disappears automatically after the timeout

#### Scenario: error toast persists until user dismissal

- **WHEN** a mutation fails and the calling code invokes the error toast
- **THEN** an error-styled toast appears with `role="alert"`, remains visible until the user clicks its dismiss control, and does not block clicks on the page below

#### Scenario: toast does not cause layout reflow

- **WHEN** a toast appears
- **THEN** the underlying page layout does not shift; the toast is positioned with `position: fixed` and does not push or reflow the surrounding DOM

#### Scenario: toasts are aria-live for screen reader announcement

- **WHEN** any toast (success, error, or info) is shown
- **THEN** it is announced to assistive technology via the appropriate aria-live region (`role="status"` for non-critical, `role="alert"` for error)

### Requirement: Global keyboard shortcuts navigate and focus without mouse

A `useGlobalShortcuts` hook SHALL be mounted in the authenticated layout. The hook SHALL bind a fixed set of shortcuts that work **only when the user is not typing in an input, textarea, or contenteditable element**: pressing `n` SHALL navigate to `/facturas/nueva` (the "Cargar factura" action), pressing `/` SHALL focus the first search/filter input on the current page (no-op if none exists), and the two-key sequences `g` then `p`, `g` then `f`, `g` then `c` SHALL navigate to `/proveedores`, `/facturas`, and `/pagos` respectively. The `n` shortcut SHALL be suppressed on the `/facturas/nueva` route itself (no infinite re-navigation). All shortcuts SHALL be no-ops if the focus is inside a form field, contenteditable, or modal/dialog content.

#### Scenario: n opens the new-invoice route from any non-input context

- **WHEN** the user presses the `n` key while focus is on the page body, a button, or any non-input element
- **THEN** the application navigates to `/facturas/nueva`

#### Scenario: n is suppressed when focus is in a form field

- **WHEN** the user presses the `n` key while focus is inside an `<input>`, `<textarea>`, or `[contenteditable]` element
- **THEN** the character `n` is typed into the field and no navigation occurs

#### Scenario: slash focuses the first search/filter input on the current page

- **WHEN** the user presses the `/` key while focus is on the page body and the current page has at least one search/filter input marked as the "global" search target
- **THEN** that input receives focus and its current value is selected for replacement

#### Scenario: g-then-p navigates to proveedores

- **WHEN** the user presses `g` and then `p` (within the sequence timeout) while focus is on the page body
- **THEN** the application navigates to `/proveedores`

#### Scenario: g-then-f and g-then-c navigate to facturas and pagos

- **WHEN** the user presses `g` then `f` or `g` then `c` (within the sequence timeout) while focus is on the page body
- **THEN** the application navigates to `/facturas` or `/pagos` respectively

#### Scenario: shortcuts are no-ops inside an open dialog

- **WHEN** a dialog is open and the user presses `n`, `/`, or any `g`-prefixed shortcut
- **THEN** no navigation occurs (the `Esc` to close the dialog remains the user's escape)

### Requirement: Loading state uses shimmer skeleton instead of a spinner

The shared `LoadingState` component SHALL render a skeleton block (placeholder rectangles matching the layout of the content being loaded) with the existing `animate-shimmer` keyframe applied. The component SHALL NOT render a CSS spinner or a generic "Loading…" text. The skeleton SHALL have an `aria-busy="true"` attribute on the container and an `aria-label` of "Cargando" for screen readers. The component SHALL continue to accept the same public API (no breaking change to call sites) and SHALL be used as a drop-in replacement wherever loading is rendered.

#### Scenario: LoadingState renders a shimmer skeleton

- **WHEN** `LoadingState` is rendered
- **THEN** the container has `aria-busy="true"`, an `aria-label="Cargando"`, and one or more placeholder blocks with the `animate-shimmer` class applied

#### Scenario: LoadingState has no spinner and no "Loading…" text

- **WHEN** `LoadingState` is rendered
- **THEN** no `<svg>` spinner is present in the rendered output and no "Loading…" / "Cargando…" text is visible to sighted users (the `aria-label` is for assistive tech only)

### Requirement: Deprecated inline success message is preserved during migration

The existing `SuccessMessage` component SHALL continue to be exported and functional during the migration window. Call sites that previously used `<SuccessMessage message={...} onDismiss={...} />` SHALL migrate to `toast.success(message)` calls; the `<SuccessMessage>` component SHALL be marked `@deprecated` in JSDoc and SHALL be removed in a subsequent change. The migration SHALL be mechanical: each existing call site is replaced one-for-one with a `toast.success` call, and the local `useState<string | null>(null)` for the success message is removed.

#### Scenario: SuccessMessage is still exported and still passes its existing test

- **WHEN** `SuccessMessage` is imported and rendered with `message` and `onDismiss` props
- **THEN** the component renders the same output as before the migration and its existing test continues to pass

#### Scenario: SuccessMessage is marked deprecated in JSDoc

- **WHEN** a developer inspects the source of `SuccessMessage`
- **THEN** a `@deprecated` JSDoc tag is present directing developers to use the toast system instead
