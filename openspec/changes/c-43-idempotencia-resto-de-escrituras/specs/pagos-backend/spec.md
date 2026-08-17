## ADDED Requirements

### Requirement: Registrar un pago es una escritura protegida por clave de idempotencia

`POST /api/pagos` SHALL aceptar el header opcional `Idempotency-Key` y SHALL honrar el contrato completo de la capacidad `escritura-idempotente`: una repetición con los mismos datos devuelve el pago original con `200` y `Idempotent-Replay: true`, una clave reutilizada con datos distintos es `409` con el pago existente en el `detail`, la unicidad la garantiza la base y la búsqueda por clave se filtra por `negocio_id`.

Un pago duplicado no se queda quieto en su propia fila: el pool de pagos del proveedor es la entrada del algoritmo FIFO (RN-FIFO), así que un pago de más marca como `PAGADA` una factura que no lo está. El negocio deja de ver una deuda que sigue existiendo, y se entera cuando el proveedor reclama — a esa altura, sin forma de saber cuál de las dos filas era la real.

La comparación entre el pedido repetido y el pago guardado SHALL hacerse sobre `proveedor_id`, `monto`, `fecha`, `metodo`, `comprobante_url` y `origen`, comparando `origen` contra el valor **resuelto** por el service (`MANUAL` cuando el payload lo omite) y no contra el crudo del payload.

Sin el header, el comportamiento SHALL ser exactamente el anterior a este change, incluido el `origen` automático y el `proveedor_nombre` en la respuesta.

#### Scenario: el reintento de un pago no crea un segundo

- **WHEN** se postea dos veces el mismo pago con la misma clave de idempotencia
- **THEN** existe un solo pago, y la segunda respuesta es `200` con ese mismo pago y el header `Idempotent-Replay: true`

#### Scenario: el reintento no altera el estado FIFO de las facturas del proveedor

- **WHEN** se postea dos veces el mismo pago con la misma clave sobre un proveedor con facturas pendientes
- **THEN** el `estado` de esas facturas es el mismo que si el pago se hubiera registrado una sola vez

#### Scenario: dos pagos iguales sin clave siguen siendo dos pagos

- **WHEN** se postean dos pagos con idéntico proveedor, monto, fecha y método, sin `Idempotency-Key`
- **THEN** se crean los dos, porque pagar dos veces lo mismo el mismo día es una operación legítima

#### Scenario: una clave con un monto corregido no se traga la corrección

- **WHEN** se repite el POST con la misma clave y un monto distinto
- **THEN** la respuesta es `409`, el `detail` incluye el pago existente, y el pago guardado conserva su monto original

#### Scenario: omitir origen no produce un conflicto contra el propio pago

- **WHEN** se repite con la misma clave un POST que no manda `origen`, contra un pago guardado con `origen = MANUAL`
- **THEN** la respuesta es la repetición del pago original, no un `409`

#### Scenario: la clave de un pago eliminado no crea un segundo pago

- **WHEN** un pago creado con clave se elimina y luego llega un reintento con esa misma clave
- **THEN** la respuesta es `409` y no aparece un nuevo pago en el listado

#### Scenario: la misma clave en dos negocios no cruza datos

- **WHEN** dos negocios postean un pago con la misma clave de idempotencia
- **THEN** cada negocio obtiene su propio pago creado, y el listado de cada uno muestra solo el suyo

#### Scenario: la validación de proveedor sigue corriendo antes de persistir

- **WHEN** se postea con una clave nueva un pago cuyo `proveedor_id` es de otro negocio
- **THEN** la respuesta es `404`, no se persiste nada, y la clave queda libre para un envío corregido

#### Scenario: una clave malformada se rechaza

- **WHEN** se postea con `Idempotency-Key: no-es-un-uuid`
- **THEN** la respuesta es `422` y no se persiste ningún pago

### Requirement: La clave de idempotencia se persiste en el pago y no altera su significado

El modelo `Pago` SHALL incorporar una columna `idempotency_key` (uuid, nullable) y un índice único `(negocio_id, idempotency_key)` restringido a las filas con clave presente. La columna SHALL ser exclusivamente un registro de qué escritura creó la fila y SHALL NOT participar del pool FIFO ni de ningún otro cálculo.

La columna es nullable porque todos los pagos existentes no tienen clave y porque el header es opcional: un pago sin clave es un pago válido. `PagoResponse` SHALL NOT exponerla — es transporte, no dominio.

El índice SHALL NOT excluir las filas con soft delete, por la misma razón que en `venta` (C-42): liberar la clave al borrar el pago haría que un reintento tardío creara un segundo.

Ninguna columna de `saldo` ni de `estado` SHALL aparecer en `pago` como consecuencia de este cambio, y `factura_id` SHALL seguir sin existir (RN-PAG-01).

#### Scenario: el índice rechaza el duplicado a nivel de base

- **WHEN** se insertan directamente en la tabla dos pagos del mismo negocio con la misma `idempotency_key`
- **THEN** la base rechaza el segundo

#### Scenario: varios pagos sin clave conviven

- **WHEN** se insertan varios pagos del mismo negocio con `idempotency_key` nula
- **THEN** la base los acepta todos

#### Scenario: la respuesta de la API no expone la clave

- **WHEN** se lee un pago creado con clave de idempotencia
- **THEN** el cuerpo de la respuesta no incluye ningún campo de clave de idempotencia

#### Scenario: el pago sigue sin factura_id ni columnas derivadas

- **WHEN** se inspecciona el esquema de `pago` después de la migración
- **THEN** no existe `factura_id`, ni columna de saldo, ni de estado, igual que antes
