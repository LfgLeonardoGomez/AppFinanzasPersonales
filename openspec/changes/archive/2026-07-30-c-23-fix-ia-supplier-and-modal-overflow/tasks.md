# Tasks: c-23-fix-ia-supplier-and-modal-overflow

> Frontend-only. Nothing under `facturas-proveedores-api/` may be modified.
> Strict TDD: every fix starts from a test that fails against the current code.

## 1. Baseline

- [x] 1.1 Run the frontend suite and record the exact pass count as the safety net
- [x] 1.2 Confirm `SupplierMatchControl.test.tsx` does not exist and no e2e test clicks the clear control

## 2. Supplier dismissal — RED

- [x] 2.1 Create `SupplierMatchControl.test.tsx` with a test that auto-matches a supplier, clears it, and asserts the selection stays empty AFTER effects flush (`waitFor`) — per D4, asserting only at click time would pass against the broken code
- [x] 2.2 Run it and confirm it FAILS against the current implementation, for the right reason (the supplier is re-applied), not an unrelated setup error

## 3. Supplier dismissal — GREEN

- [x] 3.1 Add the local dismissal flag to `SupplierMatchControl`, set when the control emits a `null` selection, checked alongside `selectedProveedor === null` in the auto-match effect (D1)
- [x] 3.2 Reset the flag when `proveedorNombre` changes so a new AI reading can auto-match again
- [x] 3.3 Replace the misleading comment above the effect with one that states what the guard actually guarantees
- [x] 3.4 Run the test and confirm it passes

## 4. Supplier dismissal — TRIANGULATE

- [x] 4.1 Add a test that auto-match still pre-selects on a fresh proposal (the convenience must survive the fix)
- [x] 4.2 Add a test that a NEW detected supplier name auto-matches again after a previous dismissal
- [x] 4.3 Add a test asserting the inline-create path is unaffected when the AI found no match
- [x] 4.4 Verify the payment flow inherits the fix — assert via the shared control, or add a payment-flow case if the wiring differs

## 5. Dialog viewport fit

- [x] 5.1 Write a test asserting `ProveedorDialog`'s content node declares a `dvh` max-height and a vertical scroll container; confirm it FAILS first (D5)
- [x] 5.2 Add `max-h-[90dvh] overflow-y-auto` to `ProveedorDialog`'s `Dialog.Content` and confirm the test passes
- [x] 5.3 Apply the same to `DeleteProveedorDialog` (D2)
- [x] 5.4 Apply the same to `CargaModal`, then verify its flex centring still works — it is hand-rolled, not Radix
- [x] 5.5 Extend the assertions to cover all three dialogs

## 6. Close out

- [x] 6.1 Run the full frontend suite; zero failures and no fewer tests passing than the 1.1 baseline
- [x] 6.2 Run `npm run typecheck` and `npm run lint`; both clean
- [x] 6.3 Confirm `git status` shows no modifications under `facturas-proveedores-api/`
- [ ] 6.4 (PENDING — user will verify in the browser)  ~~ Manually verify in the running app at http://localhost:5173: load an invoice by AI, clear the matched supplier, confirm it stays cleared and a different one can be chosen
