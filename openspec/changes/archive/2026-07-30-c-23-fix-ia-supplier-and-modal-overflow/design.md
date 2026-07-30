# Design: c-23-fix-ia-supplier-and-modal-overflow

## Context

Two independent frontend defects, grouped because both block manual testing of the MVP and neither touches the backend.

**Defect 1** — `SupplierMatchControl.tsx:55-59`:

```tsx
// Pre-select on a unique normalized-exact match. Only fires while
// nothing is selected yet, so it never clobbers a user's manual pick
useEffect(() => {
  if (autoMatch.status === 'matched' && selectedProveedor === null) {
    onProveedorChange(autoMatch.proveedor)
  }
}, [autoMatch, selectedProveedor, onProveedorChange])
```

`selectedProveedor === null` is overloaded: it is the state on mount *and* the state right after a deliberate clear. `useAutoMatchProveedor` keeps returning `{status:'matched'}` because `proveedorNombre` has not changed, so the effect re-applies the same supplier immediately after the user clears it. The control has no memory of the user's action.

**Defect 2** — `ProveedorDialog.tsx:65-69` centres with `top-1/2 -translate-y-1/2` and declares neither a height cap nor a scroll container, so tall content overflows above and below the viewport. `grep "max-h-\["` over `facturas-proveedores-web/src` returns zero matches: this is a codebase-wide gap, not a one-dialog slip.

## Goals / Non-Goals

**Goals:**
- The user can reject the AI's supplier match, in both the invoice and payment flows.
- Auto-match on a fresh proposal keeps working exactly as today.
- No dialog can clip its content off-screen, on any viewport height, with the keyboard open.
- Close the test gap that let both defects ship.

**Non-Goals:**
- Not redesigning `SupplierSearch` — it is correct.
- Not restructuring `ProveedorForm` into header/body/footer slots. A single scrolling container fixes the reported defect; a sticky footer is a refinement nobody asked for.
- Not building a shared `Dialog` wrapper component. Three dialogs each gain two utility classes; extracting an abstraction over three call sites, two of which are already diverging in structure, would be premature.
- No backend work.

## Decisions

### D1: Track the dismissal in `SupplierMatchControl`, not in `CargaModal`

A local `dismissed` flag, set when the control emits a `null` change, checked alongside `selectedProveedor === null`, and reset when `proveedorNombre` changes.

*Alternatives considered:*
- **Lift a `proveedorTouchedByUser` flag into `CargaModal`.** Rejected: the auto-match/dismiss lifecycle is entirely local to this control; lifting it would widen the prop contracts of both `PropuestaFacturaFields` and `PropuestaPagoFields` for no gain.
- **Drop the auto-match effect and pre-select once on mount.** Rejected: the match resolves asynchronously (`useBuscarProveedores`), so it is generally not available at mount. The effect is the right shape; only its guard is wrong.
- **Compare against the previously applied supplier instead of a boolean.** Rejected as strictly weaker: it cannot distinguish "cleared the auto-match" from "cleared a manual pick that happened to equal the auto-match", and both must suppress re-application.

Reset on `proveedorNombre` change matters: without it, a user who dismisses one proposal and then loads a different image would silently lose auto-match for the rest of the modal's life.

### D2: Fix all three dialogs, not only the reported one

`ProveedorDialog` is the one that overflows today. `DeleteProveedorDialog` and `CargaModal` have identical markup and are saved only by short content — `CargaModal` in particular grows with the AI proposal form.

*Alternative considered:* fix only what was reported. Rejected — the cost of the other two is two utility classes each, and leaving a known defect in place because it has not yet been observed is how this one got here.

### D3: `max-h-[90dvh]` + `overflow-y-auto` on the dialog content

`dvh` over `vh` because this is a mobile-first PWA: `100vh` ignores the address bar and the on-screen keyboard, which is precisely the state the user is in while filling a form. Tailwind v4 accepts arbitrary values, so no config change. 90 rather than 100 keeps the backdrop visible so the dialog still reads as a dialog.

*Alternative considered:* sticky header + scrolling body + sticky footer. Better ergonomics for long forms, but it requires restructuring `ProveedorForm`'s markup, which currently emits its buttons as inline form content. Deferred until a form is long enough to need it.

### D4: Test the dismissal across a render tick, not just the click

The bug is that the state is restored by an effect *after* the click. A test asserting the emitted value at click time passes against the broken code — `SupplierSearch.test.tsx:113-122` does exactly that and stayed green throughout. The regression test must therefore assert the selection is still empty after effects have flushed (`waitFor`/`findBy`), or it reproduces the same blind spot.

### D5: Assert the height cap declaratively

JSDOM performs no layout, so "nothing is clipped" cannot be asserted by rendering. The test asserts that the dialog content node carries a `dvh`-based max-height and a vertical overflow class. This is weaker than a visual check and is stated as such: it locks the declaration, not the rendered result. A real viewport check belongs in Playwright (`webapp-testing`) and is out of scope here.

## Risks / Trade-offs

- **Suppressing the auto-match too aggressively** (e.g. forgetting the reset on `proveedorNombre`) would silently remove a feature users rely on → covered by a dedicated scenario requiring auto-match to fire again for a new detected name.
- **`dvh` support**: broadly available in current mobile browsers; in an unsupported engine the declaration is ignored and behaviour degrades to today's, so the failure mode is the current bug, not a worse one.
- **`CargaModal` is a hand-rolled modal, not Radix** — adding overflow classes there must not interfere with its own flex centring. Verify its layout still centres after the change.
- **D5's test is declarative only** — it will not catch a future change that adds a taller inner container with its own overflow. Accepted, and recorded here so it is not mistaken for a stronger guarantee than it is.

## Open Questions

- Should `CargaModal` be migrated to Radix Dialog for consistency with the c-20 primitives? Out of scope here; worth its own change since it also affects focus trapping and Esc handling.
