## ADDED Requirements

### Requirement: The carga modal behaves like every other dialog

The carga modal SHALL be built on the same dialog primitive as the rest of the application. It MUST trap focus while open, dismiss on `Esc` and on backdrop activation, and restore focus to the element that opened it — the same contract every other dialog has satisfied since C-20.

#### Scenario: Focus is trapped while the modal is open

- **WHEN** the modal is open and the user moves focus forward past the last focusable control
- **THEN** focus stays within the modal instead of reaching the page behind it

#### Scenario: Dismissal is conventional

- **WHEN** the user presses `Esc`, or activates the backdrop, while dismissal is allowed
- **THEN** the modal closes

#### Scenario: Dismissal stays blocked while the AI is reading the image

- **WHEN** the extraction is in progress and the user presses `Esc` or activates the backdrop
- **THEN** the modal does NOT close, preserving the guard the previous implementation enforced

#### Scenario: Existing behaviour is unchanged

- **WHEN** the modal is used for any of its flows — origen, processing, review, success, for factura or pago, image or manual
- **THEN** it behaves exactly as before the dialog primitive was swapped
