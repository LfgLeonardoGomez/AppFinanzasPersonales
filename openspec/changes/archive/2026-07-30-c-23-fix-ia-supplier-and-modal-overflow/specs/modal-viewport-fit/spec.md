## ADDED Requirements

### Requirement: Dialogs never render content outside the viewport

Every modal dialog SHALL constrain its height to the visible viewport and scroll its own content when it does not fit. No part of a dialog — heading, field, or action button — may be clipped or positioned off-screen at any viewport height.

#### Scenario: A dialog taller than the viewport scrolls internally

- **WHEN** a dialog's content is taller than the available viewport height
- **THEN** the dialog is capped to the viewport and its content scrolls within the dialog, so the first heading and the last action button both remain reachable

#### Scenario: A short dialog is unaffected

- **WHEN** a dialog's content fits within the viewport
- **THEN** its appearance and position are unchanged by the height cap

### Requirement: Height caps use dynamic viewport units

Dialog height caps SHALL be expressed in dynamic viewport units (`dvh`) rather than static ones (`vh`). The application is a PWA used primarily on mobile, where the address bar and on-screen keyboard change the usable height; a static unit leaves the action button unreachable exactly when the keyboard is open and the user is filling the form.

#### Scenario: The cap is declared in dvh

- **WHEN** a dialog declares its maximum height
- **THEN** the declaration uses a `dvh`-based value together with a vertical scroll container
