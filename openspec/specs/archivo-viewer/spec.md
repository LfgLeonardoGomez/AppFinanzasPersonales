# archivo-viewer Specification

## Purpose
TBD - created by archiving change c-24-archivo-viewer-and-historial. Update Purpose after archive.
## Requirements
### Requirement: In-app preview dialog for factura and comprobante files

The frontend SHALL expose a shared `ArchivoPreviewDialog` component that previews a `archivo_url` (factura scan) or `comprobante_url` (payment receipt) in-app, without navigating the user away from the PWA. The component SHALL be a Radix `Dialog` (`Dialog.Root`/`Dialog.Portal`/`Dialog.Overlay`/`Dialog.Content`) matching the existing controlled-`open`/`onOpenChange` pattern used by `ProveedorDialog`, with an `sr-only` `Dialog.Title` and `Dialog.Description`. The component SHALL accept `url: string | null`, `open: boolean`, `onOpenChange: (open: boolean) => void`, and an optional `title: string` prop. The component SHALL render nothing when `url` is `null`.

Format detection SHALL be based on the file extension of the URL (ignoring any query string), case-insensitively: URLs ending in `.pdf` render an embedded PDF viewer; any other extension (or no recognized extension) renders an `<img>`. In both cases the dialog SHALL always render an "Abrir en pestaña nueva" link pointing at the raw `url` with `target="_blank" rel="noopener noreferrer"`, because embedded PDF rendering is unreliable inside mobile PWA webviews and the fallback must be reachable regardless of whether the embedded preview renders.

The dialog's content container SHALL declare a `max-h-[90dvh]` cap with an internal vertical scroll container, so the preview never clips off-screen on any viewport height (matching the `dvh`-based pattern already established for other dialogs in this codebase).

#### Scenario: an image URL renders as an image with the fallback link

- **WHEN** `ArchivoPreviewDialog` is rendered with `open=true` and `url="https://res.cloudinary.com/demo/facturas/abc.jpg"`
- **THEN** the dialog renders an `<img>` element whose `src` is the given URL, and an "Abrir en pestaña nueva" link whose `href` is also the given URL with `target="_blank"` and `rel="noopener noreferrer"`

#### Scenario: a PDF URL renders an embedded viewer with the fallback link

- **WHEN** `ArchivoPreviewDialog` is rendered with `open=true` and `url="https://res.cloudinary.com/demo/facturas/abc.pdf"`
- **THEN** the dialog renders an embedded PDF viewer element referencing the given URL, and the same "Abrir en pestaña nueva" fallback link is present and points at the given URL

#### Scenario: a URL with a query string is still classified by its extension

- **WHEN** `ArchivoPreviewDialog` is rendered with `url="https://res.cloudinary.com/demo/facturas/abc.pdf?v=2"`
- **THEN** the dialog renders the embedded PDF viewer branch (the query string does not defeat the `.pdf` classification)

#### Scenario: url=null renders nothing

- **WHEN** `ArchivoPreviewDialog` is rendered with `open=true` and `url={null}`
- **THEN** no dialog content is rendered (`getByRole('dialog')` finds nothing)

#### Scenario: closing the dialog calls onOpenChange

- **WHEN** the user presses Escape or clicks outside the open dialog
- **THEN** `onOpenChange(false)` is called

#### Scenario: the dialog caps its height and scrolls internally

- **WHEN** the dialog is open
- **THEN** its content container declares a `dvh`-based max-height together with a vertical scroll container, consistent with the codebase's existing dialog-viewport-fit pattern

### Requirement: TablaFacturasConEstado opens the file in-app instead of a new tab

The `TablaFacturasConEstado` "Ver archivo" affordance SHALL be a `<button>` (not an `<a>`) that opens `ArchivoPreviewDialog` with the row's `archivo_url` when clicked. The row SHALL render nothing in that cell when `archivo_url` is `null` (unchanged from prior behavior). Only one preview dialog instance SHALL exist per table; clicking a different row's "Ver archivo" button SHALL swap the previewed URL.

#### Scenario: clicking "Ver archivo" opens the dialog with that row's URL

- **WHEN** the user clicks the "Ver archivo" button on a row whose `archivo_url` is `"https://example.com/f2.pdf"`
- **THEN** `ArchivoPreviewDialog` opens with `url="https://example.com/f2.pdf"`

#### Scenario: no button is rendered when archivo_url is null

- **WHEN** a row's `archivo_url` is `null`
- **THEN** no "Ver archivo" control is rendered for that row

#### Scenario: switching rows swaps the previewed file

- **WHEN** the dialog is open for one row's file and the user closes it, then clicks "Ver archivo" on a different row
- **THEN** the dialog reopens with the second row's `archivo_url`

### Requirement: PagosRegistrados shows an Archivo column

The "Pagos" tab (`PagosRegistrados`) SHALL render an additional "Archivo" column. When a row's `archivo_url` (sourced from `EntradaHistorial.archivo_url` for `PAGO` entries — the persisted `Pago.comprobante_url`) is present, the cell SHALL render a "Ver archivo" button that opens `ArchivoPreviewDialog` with that URL, using the same component as `TablaFacturasConEstado`. When absent, the cell SHALL render the existing "—" placeholder convention used elsewhere in this table.

#### Scenario: a pago with a saved comprobante shows a "Ver archivo" button

- **WHEN** `PagosRegistrados` renders a row whose `archivo_url` is a non-null Cloudinary URL
- **THEN** the row's Archivo cell shows a "Ver archivo" button that opens `ArchivoPreviewDialog` with that URL on click

#### Scenario: a pago without a comprobante shows the empty placeholder

- **WHEN** `PagosRegistrados` renders a row whose `archivo_url` is `null`
- **THEN** the row's Archivo cell shows "—" and no interactive control

