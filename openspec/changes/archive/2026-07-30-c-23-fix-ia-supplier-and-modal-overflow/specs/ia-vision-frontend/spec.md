## ADDED Requirements

### Requirement: The human can reject the AI's supplier match

The AI-proposed supplier SHALL be dismissible. When the extraction auto-matches a supplier and pre-selects it, the user MUST be able to clear that selection and choose or create a different supplier. A confirmation step in which only "accept" is reachable is not a confirmation (RN-IA-06: the AI proposes, the human confirms).

#### Scenario: Clearing an auto-matched supplier keeps it cleared

- **WHEN** the AI auto-matches a supplier, pre-selects it, and the user activates the clear control
- **THEN** the selection is emptied and STAYS empty across subsequent renders, so the user can search for or create a different supplier

#### Scenario: Auto-match still pre-selects on a fresh proposal

- **WHEN** an extraction returns a supplier name that uniquely matches one of the user's suppliers
- **THEN** that supplier is pre-selected automatically, exactly as before

#### Scenario: A new AI reading may auto-match again after a previous dismissal

- **WHEN** the user cleared the auto-matched supplier and then a new extraction produces a different detected supplier name
- **THEN** the auto-match applies again for the new name — the dismissal applies to the proposal the user rejected, not to the control forever

#### Scenario: The dismissal applies to both invoices and payments

- **WHEN** the clear control is used in either the invoice or the payment AI flow
- **THEN** the behaviour is identical, because both flows share one supplier-match control
