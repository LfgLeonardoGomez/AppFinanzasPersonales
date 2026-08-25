## ADDED Requirements

### Requirement: Registrar un cobro es una escritura protegida por clave de idempotencia

`POST /api/cobros` SHALL aceptar el header opcional `Idempotency-Key` y SHALL honrar el contrato completo de la capacidad `escritura-idempotente`: una repetición con los mismos datos devuelve el cobro original con `200` y `Idempotent-Replay: true`, una clave reutilizada con datos distintos es `409` con el cobro existente en el `detail`, la unicidad la garantiza la base y la búsqueda por clave se filtra por `negocio_id`.

Un cobro duplicado acredita dos veces lo mismo en la cuenta corriente de una persona con nombre y apellido. Como el saldo es signado y puede irse a negativo (D-58), el resultado no es un error visible sino un número que dice que el negocio le debe plata a su cliente — y la trampa de D-58 cierra por el otro lado: borrar el cobro duplicado más tarde arregla el saldo solo si nadie tocó nada en el medio.

La comparación entre el pedido repetido y el cobro guardado SHALL hacerse sobre `cliente_id`, `monto`, `fecha`, `metodo` y `comprobante_url`.

Sin el header, el comportamiento SHALL ser exactamente el anterior a este change, incluida la validación de saldo de RN-CCC-04.

#### Scenario: el reintento de un cobro no crea un segundo

- **WHEN** se postea dos veces el mismo cobro con la misma clave de idempotencia
- **THEN** existe un solo cobro, y la segunda respuesta es `200` con ese mismo cobro y el header `Idempotent-Replay: true`

#### Scenario: el reintento no acredita dos veces en la cuenta del cliente

- **WHEN** se postea dos veces el mismo cobro con la misma clave sobre un cliente con fiados pendientes
- **THEN** el saldo del cliente descuenta el monto una sola vez

#### Scenario: dos cobros iguales sin clave siguen siendo dos cobros

- **WHEN** se postean dos cobros con idéntico cliente, monto, fecha y método, sin `Idempotency-Key`, y el saldo alcanza para los dos
- **THEN** se crean los dos

#### Scenario: una clave con un monto corregido no se traga la corrección

- **WHEN** se repite el POST con la misma clave y un monto distinto
- **THEN** la respuesta es `409`, el `detail` incluye el cobro existente, y el cobro guardado conserva su monto original

#### Scenario: la clave de un cobro eliminado no crea un segundo cobro

- **WHEN** un cobro creado con clave se elimina y luego llega un reintento con esa misma clave
- **THEN** la respuesta es `409` y no aparece un nuevo cobro en el listado

#### Scenario: la misma clave en dos negocios no cruza datos

- **WHEN** dos negocios postean un cobro con la misma clave de idempotencia
- **THEN** cada negocio obtiene su propio cobro creado, y el listado de cada uno muestra solo el suyo

#### Scenario: una clave malformada se rechaza

- **WHEN** se postea con `Idempotency-Key: no-es-un-uuid`
- **THEN** la respuesta es `422` y no se persiste ningún cobro

### Requirement: La validación de saldo no puede rechazar una repetición legítima

`POST /api/cobros` con una clave de idempotencia SHALL resolver la repetición **antes** de evaluar la regla de saldo de RN-CCC-04, y SHALL NOT responder `422` por saldo insuficiente sobre un cobro que ya fue registrado con esa misma clave.

La regla de saldo es una validación **con estado**: lee los fiados y los cobros del cliente para decidir. El cobro que se está creando entra en esa cuenta apenas se guarda, así que una repetición la evalúa contra un saldo **ya consumido** por la operación original.

La condición para que esto pase es `monto > saldo_restante`, o sea que el cobro cancele más de la mitad de lo adeudado. Saldar la cuenta entera —el caso más frecuente que tiene la pantalla— cae siempre. Sin esta regla, la persona recibiría "el pago supera el saldo pendiente, saldo disponible: 0.00" sobre un cobro que sí se guardó, y la salida obvia —bajar el monto y reintentar— produce un cobro parcial que **sí** es un duplicado real.

La resolución anticipada SHALL ser una lectura por clave filtrada por `negocio_id` en el service layer, y SHALL NOT reemplazar al índice único ni a la traducción del `IntegrityError`: el camino de la violación SHALL permanecer y SHALL seguir resolviendo el caso concurrente.

Un cobro rechazado por saldo SHALL seguir dejando su clave libre, porque nunca llegó a persistirse.

La regla de RN-CCC-04 SHALL seguir intacta para toda escritura que no sea una repetición: un cobro genuinamente nuevo que supere el saldo pendiente SHALL seguir respondiendo `422` (D-37, sin saldo a favor).

#### Scenario: el reintento de un cobro que saldó la cuenta entera devuelve el cobro original

- **WHEN** un cliente debe exactamente el monto de un cobro, ese cobro se registra con una clave, la respuesta se pierde, y llega un reintento con la misma clave y los mismos datos
- **THEN** la respuesta es `200` con el cobro original y `Idempotent-Replay: true`, no un `422` por saldo insuficiente

#### Scenario: un cobro nuevo que supera el saldo se sigue rechazando

- **WHEN** se postea con una clave nueva un cobro cuyo monto supera el saldo pendiente del cliente
- **THEN** la respuesta es `422`, no se persiste nada, y la clave queda libre para un envío corregido

#### Scenario: la resolución anticipada no vuelve inalcanzable el camino de la violación

- **WHEN** dos requests de cobro con la misma clave llegan a la vez y ninguna encuentra la clave en su lectura previa
- **THEN** se crea exactamente un cobro y la segunda request recibe ese mismo cobro

#### Scenario: la lectura por clave no cruza negocios

- **WHEN** un negocio postea un cobro con una clave que ya usó otro negocio
- **THEN** se crea su propio cobro, y nunca se devuelve el cobro ajeno

### Requirement: La clave de idempotencia se persiste en el cobro y no altera su significado

El modelo `CobroCliente` SHALL incorporar una columna `idempotency_key` (uuid, nullable) y un índice único `(negocio_id, idempotency_key)` restringido a las filas con clave presente. La columna SHALL ser exclusivamente un registro de qué escritura creó la fila y SHALL NOT participar del cálculo del saldo ni de la imputación FIFO.

La columna es nullable porque todos los cobros existentes no tienen clave y porque el header es opcional. `CobroClienteResponse` SHALL NOT exponerla — es transporte, no dominio.

El índice SHALL NOT excluir las filas con soft delete, por la misma razón que en `venta` (C-42).

El cobro SHALL seguir sin `venta_id` (RN-CCC-03) y sin ninguna columna de saldo o estado (D-01): agregar la clave no habilita a persistir a qué fiado se imputó.

#### Scenario: el índice rechaza el duplicado a nivel de base

- **WHEN** se insertan directamente en la tabla dos cobros del mismo negocio con la misma `idempotency_key`
- **THEN** la base rechaza el segundo

#### Scenario: varios cobros sin clave conviven

- **WHEN** se insertan varios cobros del mismo negocio con `idempotency_key` nula
- **THEN** la base los acepta todos

#### Scenario: la respuesta de la API no expone la clave

- **WHEN** se lee un cobro creado con clave de idempotencia
- **THEN** el cuerpo de la respuesta no incluye ningún campo de clave de idempotencia

#### Scenario: el cobro sigue sin venta_id ni columnas derivadas

- **WHEN** se inspecciona el esquema de `cobro_cliente` después de la migración
- **THEN** no existe `venta_id`, ni columna de saldo, ni de estado, igual que antes
