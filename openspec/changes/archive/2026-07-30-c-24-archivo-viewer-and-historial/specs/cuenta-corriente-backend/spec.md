## MODIFIED Requirements

### Requirement: Historial merges facturas and pagos chronologically (RN-HIST)

`historial` SHALL be a list whose elements are either `{ tipo: "FACTURA", id, fecha, monto, saldo_acumulado, archivo_url }` or `{ tipo: "PAGO", id, fecha, monto, saldo_acumulado, archivo_url }`. Facturas appear as `FACTURA` rows with `monto = factura.monto_total` and `archivo_url = factura.archivo_url`; pagos appear as `PAGO` rows with `monto = pago.monto` and `archivo_url = pago.comprobante_url`. `archivo_url` SHALL be `None` when the underlying row has no file attached — no new upload capability is introduced by this field, it only threads through an already-persisted value. The list SHALL be ordered by `(fecha ASC, created_at ASC, id ASC)`. The `saldo_acumulado` field SHALL be the running sum at each row, where facturas add (debe) and pagos subtract (haber). The sign convention SHALL match `saldo` (positive = deuda). The `saldo_acumulado` of the **last** row SHALL equal the `saldo` of the response.

#### Scenario: empty historial for a supplier with no movimientos

- **WHEN** the supplier has no active invoices and no active payments
- **THEN** `historial = []` and `saldo = 0.00`

#### Scenario: historial with one factura

- **WHEN** the supplier has exactly one active invoice of 1500.00 and no payments
- **THEN** `historial` has one entry: `{ tipo: "FACTURA", monto: 1500.00, saldo_acumulado: 1500.00 }` and `saldo = 1500.00`

#### Scenario: historial with one pago (saldo a favor)

- **WHEN** the supplier has no active invoices and one active payment of 500.00
- **THEN** `historial` has one entry: `{ tipo: "PAGO", monto: 500.00, saldo_acumulado: -500.00 }` and `saldo = -500.00` (negative: saldo a favor)

#### Scenario: mixed facturas and pagos in chronological order

- **WHEN** the supplier has facturas on dates 2026-06-10 (1000) and 2026-06-20 (500) and a pago on 2026-06-15 (300)
- **THEN** `historial` is `[FACTURA 1000 (saldo 1000), PAGO 300 (saldo 700), FACTURA 500 (saldo 1200)]` and `saldo = 1200.00`

#### Scenario: end-of-historial saldo_acumulado equals saldo

- **WHEN** the endpoint returns a non-empty `historial`
- **THEN** `historial[-1].saldo_acumulado == saldo` (the running balance at the last row equals the aggregate balance)

#### Scenario: facturas and pagos on the same date are merged by created_at

- **WHEN** a factura and a pago share the same `fecha` and `fecha_emision`
- **THEN** the row with the earlier `created_at` (and then the earlier `id`) appears first in `historial`

#### Scenario: the id field on a historial entry points to the underlying row

- **WHEN** a `historial` entry has `tipo = FACTURA`
- **THEN** its `id` equals the corresponding `factura.id`; analogously for `PAGO` entries (id == `pago.id`)

#### Scenario: a FACTURA row carries the factura's archivo_url

- **WHEN** a `historial` entry has `tipo = FACTURA` and the underlying factura has `archivo_url = "https://res.cloudinary.com/demo/facturas/x.pdf"`
- **THEN** the entry's `archivo_url` equals that value

#### Scenario: a PAGO row carries the pago's comprobante_url as archivo_url

- **WHEN** a `historial` entry has `tipo = PAGO` and the underlying pago has `comprobante_url = "https://res.cloudinary.com/demo/comprobantes/y.jpg"`
- **THEN** the entry's `archivo_url` equals that value

#### Scenario: a row with no attached file has archivo_url = None

- **WHEN** the underlying factura or pago has no file attached (`archivo_url` / `comprobante_url` is `None`)
- **THEN** the corresponding `historial` entry has `archivo_url = None`

### Requirement: Pydantic response schema shape

The response SHALL conform to the `CuentaCorrienteResponse` shape with `proveedor_id` (UUID), `saldo` (Decimal, signed), `facturas_con_estado` (list of `FacturaConEstado`), and `historial` (list of `EntradaHistorial`). `FacturaConEstado` SHALL mirror `FacturaResponse` from C-08 with `items` and `items_sum_mismatch` omitted, plus an `estado: EstadoFactura` field (PENDIENTE / PARCIAL / PAGADA). `EntradaHistorial` SHALL have `id` (UUID), `tipo` (`Literal["FACTURA", "PAGO"]`), `fecha` (date), `monto` (Decimal, always positive), `saldo_acumulado` (Decimal, signed), and `archivo_url` (`Optional[str]`, default `None`). The schemas are output-only; the endpoint has no request body, so no input schema is required. No Alembic migration is required for `archivo_url` — it is sourced from the already-persisted `Factura.archivo_url` and `Pago.comprobante_url` columns.

#### Scenario: CuentaCorrienteResponse has the four required fields

- **WHEN** the response is parsed
- **THEN** it contains `proveedor_id` (UUID), `saldo` (Decimal string), `facturas_con_estado` (list), and `historial` (list)

#### Scenario: FacturaConEstado has estado and no items

- **WHEN** a `FacturaConEstado` is parsed
- **THEN** it has `id`, `proveedor_id`, `fecha_emision`, `monto_total`, `origen`, `estado` (one of PENDIENTE / PARCIAL / PAGADA), and the standard timestamps; it does NOT have an `items` field and does NOT have an `items_sum_mismatch` field

#### Scenario: EntradaHistorial has tipo, saldo_acumulado, and an optional archivo_url

- **WHEN** an `EntradaHistorial` is parsed
- **THEN** it has `id` (UUID), `tipo` (string, exactly "FACTURA" or "PAGO"), `fecha` (date), `monto` (Decimal, positive), `saldo_acumulado` (Decimal, signed), and `archivo_url` (string or `None`, defaulting to `None` when omitted)
