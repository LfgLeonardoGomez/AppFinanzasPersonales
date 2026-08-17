## ADDED Requirements

### Requirement: Registrar una factura es una escritura protegida por clave de idempotencia

`POST /api/facturas` SHALL aceptar el header opcional `Idempotency-Key` y SHALL honrar el contrato completo de la capacidad `escritura-idempotente`: una repetición con los mismos datos devuelve la factura original con `200` y `Idempotent-Replay: true`, una clave reutilizada con datos distintos es `409` con la factura existente en el `detail`, la unicidad la garantiza la base y la búsqueda por clave se filtra por `negocio_id`.

Una factura duplicada infla la deuda con el proveedor y, además, **desordena el FIFO de todo ese proveedor**: la imputación es por antigüedad, así que una factura de más corre la asignación de todos los pagos y cambia el `estado` de facturas que no tienen nada que ver con el duplicado.

La comparación entre el pedido repetido y la factura guardada SHALL incluir los **items**, comparados como lista ordenada de `(descripcion, cantidad, precio_unitario)`, además de `proveedor_id`, `fecha_emision`, `monto_total`, `numero`, `fecha_vencimiento`, `archivo_url` y `origen` resuelto. Una línea de detalle corregida es exactamente la corrección que no puede descartarse en silencio, así que dos pedidos con la misma clave y distinto detalle SHALL ser un conflicto, no una repetición.

`items_sum_mismatch` SHALL NOT participar de la comparación: es una salida derivada de `monto_total` y los items, no una entrada.

Sin el header, el comportamiento SHALL ser exactamente el anterior a este change.

#### Scenario: el reintento de una factura no crea una segunda

- **WHEN** se postea dos veces la misma factura con la misma clave de idempotencia
- **THEN** existe una sola factura, y la segunda respuesta es `200` con esa misma factura y el header `Idempotent-Replay: true`

#### Scenario: el reintento no desordena el FIFO del proveedor

- **WHEN** se postea dos veces la misma factura con la misma clave sobre un proveedor con pagos ya registrados
- **THEN** el `estado` de las demás facturas de ese proveedor es el mismo que si la factura se hubiera registrado una sola vez

#### Scenario: la repetición no duplica los items

- **WHEN** se repite el POST de una factura con tres items usando la misma clave
- **THEN** la factura tiene tres items, no seis

#### Scenario: un item corregido es un conflicto, no una repetición

- **WHEN** se repite el POST con la misma clave y el mismo `monto_total`, pero con el detalle de un item modificado
- **THEN** la respuesta es `409`, el `detail` incluye la factura existente, y la factura guardada conserva sus items originales

#### Scenario: dos facturas iguales sin clave siguen siendo dos facturas

- **WHEN** se postean dos facturas con idéntico proveedor, monto y fecha de emisión, sin `Idempotency-Key`
- **THEN** se crean las dos

#### Scenario: la clave de una factura eliminada no crea una segunda factura

- **WHEN** una factura creada con clave se elimina y luego llega un reintento con esa misma clave
- **THEN** la respuesta es `409` y no aparece una nueva factura en el listado

#### Scenario: la misma clave en dos negocios no cruza datos

- **WHEN** dos negocios postean una factura con la misma clave de idempotencia
- **THEN** cada negocio obtiene su propia factura creada, y el listado de cada uno muestra solo la suya

#### Scenario: la validación de proveedor sigue corriendo antes de persistir

- **WHEN** se postea con una clave nueva una factura cuyo `proveedor_id` es de otro negocio
- **THEN** la respuesta es `404`, no se persiste ni la factura ni ningún item, y la clave queda libre para un envío corregido

#### Scenario: una clave malformada se rechaza

- **WHEN** se postea con `Idempotency-Key: no-es-un-uuid`
- **THEN** la respuesta es `422` y no se persiste ninguna factura

### Requirement: La repetición de una factura se arma con el estado derivado del momento de responder

La respuesta de una repetición de `POST /api/facturas` SHALL recalcular el `estado` FIFO y releer los items en el momento de responder, por el mismo camino que una creación, y SHALL NOT devolver una copia guardada de la respuesta original.

`estado` es derivado y nunca persistido (RN-FAC-09, D-01). Congelarlo en una respuesta guardada haría que una repetición devolviera un valor que ya es falso, y crearía una segunda fuente de verdad que se desincroniza en cuanto entra un pago al proveedor.

La consecuencia SHALL aceptarse explícitamente: si entre el intento original y el reintento cambió algo de lo que ese valor depende, **la respuesta de la repetición puede diferir de la original**. La garantía es que no se creó una segunda factura, no que los bytes coincidan.

#### Scenario: la repetición refleja el FIFO de ahora, no el del intento original

- **WHEN** una factura se crea con `estado = PENDIENTE`, entra después un pago al mismo proveedor, y recién entonces llega la repetición con la misma clave
- **THEN** la respuesta de la repetición lleva el `estado` recalculado —`PARCIAL` o `PAGADA` según corresponda— y sigue existiendo una sola factura con esa clave

#### Scenario: la repetición devuelve los items releídos

- **WHEN** se repite el POST de una factura con items usando la misma clave
- **THEN** la respuesta incluye los items de la factura guardada, leídos de la base y no reconstruidos desde el pedido

### Requirement: La clave de idempotencia se persiste en la factura y no altera su significado

El modelo `Factura` SHALL incorporar una columna `idempotency_key` (uuid, nullable) y un índice único `(negocio_id, idempotency_key)` restringido a las filas con clave presente. La columna SHALL ser exclusivamente un registro de qué escritura creó la fila y SHALL NOT participar del cálculo FIFO ni de ningún otro.

La clave vive en `factura` y no en `factura_item`: la operación que se desduplica es "registrar una factura con su detalle", una sola intención, no una por línea.

La columna es nullable porque todas las facturas existentes no tienen clave y porque el header es opcional. Las respuestas de factura SHALL NOT exponerla — es transporte, no dominio.

El índice SHALL NOT excluir las filas con soft delete, por la misma razón que en `venta` (C-42).

Ninguna columna de `saldo` ni de `estado` SHALL aparecer en `factura` como consecuencia de este cambio (D-01).

#### Scenario: el índice rechaza el duplicado a nivel de base

- **WHEN** se insertan directamente en la tabla dos facturas del mismo negocio con la misma `idempotency_key`
- **THEN** la base rechaza la segunda

#### Scenario: varias facturas sin clave conviven

- **WHEN** se insertan varias facturas del mismo negocio con `idempotency_key` nula
- **THEN** la base las acepta todas

#### Scenario: los items no llevan clave

- **WHEN** se inspecciona el esquema de `factura_item` después de la migración
- **THEN** no existe columna de clave de idempotencia

#### Scenario: la respuesta de la API no expone la clave

- **WHEN** se lee una factura creada con clave de idempotencia
- **THEN** el cuerpo de la respuesta no incluye ningún campo de clave de idempotencia

#### Scenario: la factura sigue sin columnas derivadas

- **WHEN** se inspecciona el esquema de `factura` después de la migración
- **THEN** no existe columna de saldo ni de estado, igual que antes
