# ventas-backend Specification

## Purpose

Record what the shop sells (shipped by C-33) — the other half of a system that until then only knew what it spends, and the last piece missing before customer accounts could exist.

The decision that shapes everything: **a fiado is not an entity, it is a payment method**. One `Venta` with `forma_pago = CUENTA_CORRIENTE` and a `cliente_id` is simultaneously the day's sale and the charge on that customer's account, so the two can never drift; entering the amount twice would put one fact in two places and guarantee that some day they disagree with no way to tell which is right.

Owns the `Venta` entity and its `FormaPago`; the bidirectional invariant tying customer to payment method, enforced by a CHECK in the database rather than only in the application, because `cliente_id` must stay nullable and a fiado with no customer is money owed by nobody; correction semantics, where PATCH validates the resulting pair rather than the fields that arrived; and the scoped listing with its filters. Granularity is deliberately not imposed — sale by sale or one lump at closing are both valid, and that is a UX choice.

NOT here: collections and customer balance (C-35), aggregations by period (C-37), and any notion of items or stock — this records amounts, not products, and is not a point of sale.

## Requirements

### Requirement: Una fila por operación de venta

El sistema SHALL definir un modelo `Venta` (tabla `venta`) con `negocio_id` (FK, obligatorio), `cliente_id` (FK → `cliente`, **nullable**), `fecha` (date), `monto` (numeric(12,2)), `forma_pago` (enum `FormaPago`), `notas` (nullable), `creado_por_usuario_id` (FK → `usuario`, nullable) y `deleted_at` (soft delete), más el mixin base.

`FormaPago` SHALL ser `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `CUENTA_CORRIENTE` u `OTRO`.

Una fila representa **una operación de venta**. El sistema SHALL NOT imponer una granularidad: la misma tabla admite cargar venta por venta durante el día o una sola fila agregada al cierre, y esa elección es de UX, no de modelo (D-35).

#### Scenario: venta al contado

- **WHEN** se registra una venta con `forma_pago = EFECTIVO`, monto positivo y fecha no futura
- **THEN** queda persistida con `cliente_id` en `null`

#### Scenario: la granularidad no está impuesta

- **WHEN** se registran diez ventas de $1.000 y, en otro negocio, una sola de $10.000
- **THEN** ambas formas son válidas y el modelo no distingue entre ellas

#### Scenario: monto cero o negativo rechazado

- **WHEN** se intenta registrar una venta con `monto` menor o igual a cero
- **THEN** la operación es rechazada y no se persiste nada

#### Scenario: fecha futura rechazada

- **WHEN** se intenta registrar una venta con `fecha` posterior a hoy en `America/Argentina/Buenos_Aires`
- **THEN** la operación es rechazada

### Requirement: El fiado es una venta, no otra entidad

Una venta fiada SHALL representarse como una `Venta` con `forma_pago = CUENTA_CORRIENTE` y `cliente_id` cargado. El sistema SHALL NOT definir ninguna tabla de cargos separada.

Esa fila es, al mismo tiempo, la venta del día y el cargo en la cuenta corriente del cliente. Registrarla dos veces —una en ventas y otra como cargo— haría que el mismo dato viva en dos lugares y diverja, y el día que no coincidan nadie podría saber cuál es el correcto.

#### Scenario: el fiado queda registrado como venta

- **WHEN** se registra una venta con `forma_pago = CUENTA_CORRIENTE` y un cliente del negocio
- **THEN** aparece en el listado de ventas junto a las de contado

#### Scenario: no existe una tabla de cargos

- **WHEN** se inspecciona el esquema
- **THEN** no hay ninguna tabla de cargos de cuenta corriente: el cargo es la venta

#### Scenario: el fiado del día se distingue por su forma de pago

- **WHEN** un día tiene ventas en efectivo, con tarjeta y fiadas
- **THEN** filtrar por `forma_pago = CUENTA_CORRIENTE` devuelve exactamente las fiadas

### Requirement: Invariante bidireccional entre cliente y forma de pago

El sistema SHALL exigir que `cliente_id` esté presente **si y solo si** `forma_pago = CUENTA_CORRIENTE`. Las dos direcciones SHALL rechazarse:

- una venta fiada **sin** cliente es deuda de nadie — plata que el negocio cree que le deben y no puede cobrarle a ninguna persona;
- una venta no fiada **con** cliente es ruido que alguien va a interpretar como deuda más adelante.

La garantía SHALL vivir en una restricción de la **base de datos**, y el mensaje explicativo en el service layer. Validar solo en la aplicación deja la regla a merced de cualquier camino nuevo que escriba en la tabla.

#### Scenario: fiado sin cliente rechazado

- **WHEN** se intenta registrar una venta con `forma_pago = CUENTA_CORRIENTE` y sin `cliente_id`
- **THEN** la operación es rechazada con un mensaje que explica que un fiado necesita cliente

#### Scenario: venta al contado con cliente rechazada

- **WHEN** se intenta registrar una venta con `forma_pago = EFECTIVO` y un `cliente_id`
- **THEN** la operación es rechazada

#### Scenario: la base rechaza aunque se saltee la aplicación

- **WHEN** se intenta insertar directamente en la tabla una fila que viola la invariante
- **THEN** la base de datos la rechaza

#### Scenario: cliente de otro negocio rechazado

- **WHEN** se intenta registrar una venta fiada con un `cliente_id` de otro negocio
- **THEN** la respuesta es 404 y no se persiste ninguna venta

### Requirement: Cambiar la forma de pago mantiene la invariante

El sistema SHALL permitir corregir la `forma_pago` de una venta ya registrada, exigiendo que el par `(forma_pago, cliente_id)` siga siendo coherente **después** del cambio. Pasar una venta a `CUENTA_CORRIENTE` SHALL requerir un cliente; sacarla de `CUENTA_CORRIENTE` SHALL dejar `cliente_id` en `null`.

Es una corrección legítima —"me equivoqué, en realidad me lo pagó en el momento"— pero **modifica el saldo del cliente**: sacar una venta de cuenta corriente hace desaparecer una deuda. La operación SHALL ser explícita, nunca un efecto colateral de editar otro campo.

#### Scenario: pasar de fiado a contado libera la deuda

- **WHEN** una venta fiada se cambia a `forma_pago = EFECTIVO`
- **THEN** queda sin `cliente_id` y deja de contar como cargo de ese cliente

#### Scenario: pasar de contado a fiado exige cliente

- **WHEN** una venta en efectivo se intenta cambiar a `CUENTA_CORRIENTE` sin indicar cliente
- **THEN** la operación es rechazada

#### Scenario: editar el monto no altera la forma de pago

- **WHEN** se modifica solo el `monto` de una venta fiada
- **THEN** sigue siendo fiada, con el mismo cliente

### Requirement: Listado con filtros y aislamiento

El sistema SHALL exponer `GET /api/ventas` devolviendo las ventas activas del `negocio_id` del solicitante, ordenadas por `fecha DESC, created_at DESC, id DESC`. SHALL aceptar filtros por rango de fechas (`desde`, `hasta`), por `forma_pago` y por `cliente_id`.

Una venta de otro negocio SHALL responder **404**, nunca 403. Un `cliente_id` de otro negocio SHALL responder 404, no una lista vacía.

#### Scenario: el listado es del negocio, no de la persona

- **WHEN** dos miembros del mismo negocio registran ventas y cualquiera de los dos lista
- **THEN** ve las de ambos

#### Scenario: filtro por rango de fechas

- **WHEN** se listan las ventas con `desde` y `hasta`
- **THEN** solo aparecen las de ese rango, incluidos los extremos

#### Scenario: filtro por forma de pago

- **WHEN** se filtra por `forma_pago = CUENTA_CORRIENTE`
- **THEN** solo aparecen las fiadas

#### Scenario: filtro por cliente ajeno devuelve 404

- **WHEN** se filtra por un `cliente_id` de otro negocio
- **THEN** la respuesta es 404 y no se filtra ninguna venta

#### Scenario: venta de otro negocio devuelve 404

- **WHEN** un usuario intenta leer, modificar o eliminar una venta de otro negocio
- **THEN** cada operación responde 404 y la venta ajena queda intacta

### Requirement: Eliminar una venta es soft delete y afecta el saldo

El sistema SHALL exponer `DELETE /api/ventas/{id}` como **soft delete**, preservando la fila. Una venta eliminada SHALL desaparecer de listados y filtros.

Cuando la venta eliminada era fiada, **su cargo deja de contar en la cuenta corriente del cliente**. Esto es coherente con cómo el saldo se calcula on-demand sobre lo activo (D-01), y es la razón por la que borrar una venta nunca puede ser una acción casual.

#### Scenario: la fila sobrevive al borrado

- **WHEN** se elimina una venta
- **THEN** la fila sigue en la base con `deleted_at` poblado y desaparece de los listados

#### Scenario: eliminar una venta fiada quita el cargo

- **WHEN** se elimina una venta con `forma_pago = CUENTA_CORRIENTE`
- **THEN** deja de figurar entre las ventas fiadas activas de ese cliente

#### Scenario: eliminar una venta ajena devuelve 404

- **WHEN** un usuario intenta eliminar una venta de otro negocio
- **THEN** la respuesta es 404 y la venta no se modifica

### Requirement: Los endpoints de ventas requieren sesión

Todo endpoint bajo `/api/ventas` SHALL requerir sesión válida y SHALL rechazar con **401** a los usuarios sin sesión y a los `desactivado`. Las rutas de colección SHALL responder igual con y sin barra final, **sin redirect 307** (contrato de C-27).

El `negocio_id` y el `creado_por_usuario_id` SHALL tomarse siempre de la sesión; ningún payload SHALL poder fijarlos.

#### Scenario: sin sesión no hay acceso

- **WHEN** se llama a cualquier endpoint de `/api/ventas` sin cookie válida
- **THEN** la respuesta es 401

#### Scenario: usuario desactivado rechazado

- **WHEN** un usuario con `desactivado = true` y token vigente llama a `/api/ventas`
- **THEN** la respuesta es 401

#### Scenario: el payload no puede fijar el negocio

- **WHEN** un payload de alta incluye `negocio_id`
- **THEN** la venta se persiste con el `negocio_id` de la sesión

#### Scenario: la barra final no redirige

- **WHEN** se llama a `/api/ventas` y a `/api/ventas/` con la misma sesión
- **THEN** ambas responden 200 con el mismo cuerpo, sin 307
