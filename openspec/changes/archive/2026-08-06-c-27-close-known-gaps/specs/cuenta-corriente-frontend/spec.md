## ADDED Requirements

### Requirement: The Historial tab exposes the attachment it receives

Each chronological history row that carries an attachment SHALL offer the same in-app view-file control the Facturas and Pagos tabs already provide. The field is already present in the response; the tab must not be the only place that ignores it.

#### Scenario: A row with an attachment offers the viewer

- **WHEN** a history row carries an attachment URL
- **THEN** a view-file control is shown, and activating it opens the in-app viewer with that file

#### Scenario: A row without an attachment offers nothing

- **WHEN** a history row has no attachment
- **THEN** no view-file control is rendered for that row

#### Scenario: The control does not navigate away

- **WHEN** the user opens an attachment from the history
- **THEN** it opens inside the application, never in a new browser tab
