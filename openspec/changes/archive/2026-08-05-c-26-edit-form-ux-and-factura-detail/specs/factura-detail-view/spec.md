## ADDED Requirements

### Requirement: An invoice can be read without entering edit mode

The invoice list SHALL let the user open a read-only view of an invoice by activating its row. Reading MUST NOT place the user inside an editable form: editing is a further, explicit action taken from within the detail view.

#### Scenario: Activating a row opens the detail view

- **WHEN** the user activates an invoice row in the list
- **THEN** a read-only detail view for that invoice opens, and no field is editable

#### Scenario: Editing is reachable from the detail view

- **WHEN** the user activates the edit action inside the detail view
- **THEN** the application navigates to the edit form for that same invoice

#### Scenario: The row action buttons keep working independently

- **WHEN** the user activates the edit or delete control on a row
- **THEN** that control's own action runs and the detail view does NOT open

### Requirement: The detail view shows the invoice as stored

The detail view SHALL present the invoice's number, supplier name, issue date, status, total and line items. Values MUST be rendered with the same formatting used elsewhere in the application, so a figure never appears in two different shapes.

#### Scenario: Core fields are shown

- **WHEN** the detail view is open for an invoice
- **THEN** it shows the invoice number, the supplier name, the issue date, the status and the total

#### Scenario: Line items are listed when present

- **WHEN** the invoice has line items
- **THEN** each item's description, quantity and unit price are listed

#### Scenario: An invoice without line items says so

- **WHEN** the invoice has no line items
- **THEN** the view states that explicitly rather than rendering an empty region

### Requirement: The attachment opens in the application

When the invoice has an attachment, the detail view SHALL offer to open it in the in-app viewer rather than navigating away.

#### Scenario: Attachment present

- **WHEN** the invoice has an attachment and the user activates the view-file action
- **THEN** the in-app viewer opens with that file

#### Scenario: No attachment

- **WHEN** the invoice has no attachment
- **THEN** no view-file action is offered

### Requirement: The detail view is dismissible and fits the viewport

The detail view SHALL expose a visible close control, and SHALL constrain its height with an internal scroll container so no content is clipped off-screen.

#### Scenario: Visible close control

- **WHEN** the detail view is open
- **THEN** a close control is present and activating it dismisses the view

#### Scenario: Height is capped

- **WHEN** the detail view renders
- **THEN** it declares a dynamic-viewport height cap together with a scroll container
