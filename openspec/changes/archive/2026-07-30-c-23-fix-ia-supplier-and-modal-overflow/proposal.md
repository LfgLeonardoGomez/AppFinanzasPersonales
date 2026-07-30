# Proposal: c-23-fix-ia-supplier-and-modal-overflow

## Why

Two frontend defects found while testing the MVP. Both block normal use, so they ship ahead of the feature work in c-24.

**1. The AI-matched supplier cannot be cleared.** In the AI load flow the supplier is auto-matched and pre-selected, which is the intended behaviour (RN-IA-06: the AI proposes, the human confirms). But the "x" that clears the selection does nothing — the user cannot override the AI's pick and type a supplier manually. The confirmation stops being a confirmation when one of the two possible answers is unreachable.

Root cause, verified at `facturas-proveedores-web/src/features/ia-vision/components/SupplierMatchControl.tsx:55-59`: the re-apply effect guards on `selectedProveedor === null`, a state that means two different things — "nothing chosen yet" and "the user just cleared an explicit choice". Clearing sets the state to `null`, the effect's dependency fires, the guard passes, and the same supplier is re-applied on the next render. The comment above the effect claims it "never clobbers a user's manual pick"; the code does exactly that. `SupplierSearch.tsx:74-79` (the "x" itself) is a correctly controlled component and is not at fault. Because `SupplierMatchControl` is shared, both the invoice and the payment AI flows carry the same defect.

**2. The supplier dialog overflows the viewport.** `ProveedorDialog.tsx:65-69` centres content with `top-1/2 -translate-y-1/2` and declares no height cap and no scroll container, so tall content overflows symmetrically: text is clipped above and the action button is cut off below, leaving the form unusable at small viewport heights — on a PWA whose primary target is mobile.

This is not isolated to one dialog. A search for `max-h-[` across `facturas-proveedores-web/src` returns **zero** matches: no modal in the codebase constrains its height. `DeleteProveedorDialog` and `CargaModal` share the same flaw and are saved only by having short content today. So the fix establishes a pattern rather than following one.

## What Changes

- **`SupplierMatchControl` distinguishes "not chosen yet" from "cleared by the user".** A dismissal flag, local to the control, suppresses the auto-match re-apply once the user clears an explicit selection. The flag resets when a new proposal arrives (a different detected supplier name), so a fresh AI read still auto-matches. Auto-match on first render is unchanged — this removes the trap, not the convenience.
- **The misleading comment above the effect is corrected** to describe what the code actually guarantees.
- **`ProveedorDialog` caps its height and scrolls internally** (`max-h-[90dvh]` + `overflow-y-auto`). `dvh` rather than `vh` because the dynamic viewport unit accounts for the mobile address bar and on-screen keyboard.
- **The same treatment is applied to the other two dialogs** (`DeleteProveedorDialog`, `CargaModal`) so the defect is fixed as a class rather than left latent in two places. Their content fits today; that is luck, not design.
- **Regression tests** for both: clearing an auto-matched supplier keeps it cleared, and each dialog declares a height cap with an internal scroll container.

## Capabilities

### New Capabilities
- `modal-viewport-fit`: how dialogs constrain their height and scroll internally so content is never clipped off-screen.

### Modified Capabilities
- `ia-vision-frontend`: the supplier confirmation step must allow the human to reject the AI's match, not only accept it. This tightens RN-IA-06 (the AI proposes, the human confirms) with an explicit requirement that the proposal be dismissible.

## Impact

- **Affected code**: `facturas-proveedores-web/src/features/ia-vision/components/SupplierMatchControl.tsx`, `src/features/proveedores/components/ProveedorDialog.tsx`, `src/features/proveedores/components/DeleteProveedorDialog.tsx`, `src/features/ia-vision/components/CargaModal.tsx`, plus new/updated tests.
- **Not affected**: no backend change, no schema change, no migration. Nothing under `facturas-proveedores-api/`.
- **Risk**: low. The dialog change is additive CSS on a wrapper and touches no DOM structure or ARIA attribute that existing tests exercise. The `SupplierMatchControl` change alters auto-match lifecycle logic, so the risk is regressing the auto-match itself — covered by requiring both behaviours (auto-match still fires; clearing still sticks) in tests.
- **Test gap being closed**: `SupplierMatchControl` has no test file at all today, and the AI modal e2e suites never click the clear button — which is why a defect this visible shipped.
