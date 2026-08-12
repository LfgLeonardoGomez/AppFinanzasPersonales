## Why

Hasta acá el sistema sabe todo sobre lo que el negocio **gasta** y nada sobre lo que **vende**. Esta es la pieza que da vuelta esa asimetría, y es la que vos pediste desde el principio: registrar la venta diaria para poder mirarla por día, semana y mes, y después contrastarla contra las compras.

También es el único ladrillo que falta para los fiados. `Cliente` ya existe (C-32) y el motor de saldo y FIFO funciona hace meses del lado de proveedores; lo que no hay es **el cargo**. Y el cargo es una venta.

## What Changes

- **Entidad `Venta`**: `negocio_id`, `cliente_id` (nullable), `fecha`, `monto`, `forma_pago`, `notas`, `creado_por_usuario_id`, soft delete.
- **Enum `FormaPago`**: `EFECTIVO` / `TRANSFERENCIA` / `TARJETA` / `CUENTA_CORRIENTE` / `OTRO`.
- **El fiado NO es una tabla aparte** (D-33): es una `Venta` con `forma_pago = CUENTA_CORRIENTE` y `cliente_id` cargado. Esa misma fila es la venta del día **y** el cargo en la cuenta corriente del cliente.
- **Invariante bidireccional** `cliente_id IS NOT NULL ⟺ forma_pago = CUENTA_CORRIENTE`, garantizada por un **CHECK en la base**, con el mensaje amable en el service layer.
- **Validaciones**: `monto > 0`, `fecha` no futura (UTC-3), y `Venta.negocio_id == Cliente.negocio_id`.
- **CRUD `/api/ventas`** aislado por `negocio_id`, con filtros por rango de fechas, forma de pago y cliente.
- **Migración `0010`**.

**Fuera de alcance**: cobros y saldo del cliente (C-35), agregaciones y estadísticas (C-37), y frontend (C-34). Este change entrega el registro; sumar y mostrar viene después.

## Capabilities

### New Capabilities
- `ventas-backend`: la entidad `Venta`, el fiado como una de sus formas de pago, la invariante que las liga, y el CRUD aislado con sus filtros.

## Impact

**Backend**: `app/models/venta.py`, `app/repositories/venta_repository.py`, `app/services/venta_service.py`, `app/routers/ventas.py`, `app/schemas/venta.py`, enum en `app/models/enums.py`, migración `0010`. Lee `Cliente` para validar pertenencia; no lo modifica. No toca proveedores, facturas ni pagos.

**Riesgo — el doble registro del fiado.** Es el que motivó todo el diseño. Si el fiado se cargara como venta *y además* como cargo separado en la cuenta del cliente, el mismo dato viviría en dos lugares y divergirían; el día que no coincidan nadie va a saber cuál está bien. Por eso hay una sola fila y una sola carga. La contrapartida: **borrar una venta fiada modifica el saldo del cliente**, y eso tiene que ser obvio para quien la borra.

**Riesgo — cambiar la forma de pago de una venta ya cargada.** Pasar una venta de `CUENTA_CORRIENTE` a `EFECTIVO` **borra silenciosamente una deuda**. Es una corrección legítima —"me equivoqué, en realidad me lo pagó"— pero hay que decidir si se permite y, si se permite, que el efecto no sea invisible.

**Riesgo — la invariante parece opcional.** `cliente_id` es nullable, así que nada en el tipo impide guardar un fiado sin cliente. Una venta fiada sin cliente es **deuda de nadie**: plata que el negocio cree que le deben y no puede cobrarle a nadie. Por eso la garantía vive en la base y no solo en el código.

**Governance: ALTO.** No toca auth ni el aislamiento, pero es la primera entidad que **genera deuda de terceros**. Un error acá no rompe una pantalla: descuadra lo que el negocio cree que le deben.
