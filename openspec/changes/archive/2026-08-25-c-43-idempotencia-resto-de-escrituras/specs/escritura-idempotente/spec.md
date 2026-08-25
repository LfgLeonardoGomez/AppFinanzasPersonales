## ADDED Requirements

### Requirement: Una validación que depende del estado que la escritura modifica no puede rechazar una repetición

Cuando una escritura protegida tenga una validación cuyo resultado dependa del estado que esa misma escritura modifica, el sistema SHALL resolver la repetición **antes** de correr esa validación, y SHALL NOT responder un rechazo sobre una operación que ya está guardada.

El orden por defecto —validar primero, insertar después— es correcto mientras las validaciones sean puras respecto de la propia escritura, y tiene una razón buena: una operación rechazada no persiste nada y su clave queda libre para un envío corregido. Deja de ser correcto en cuanto una validación lee lo que la escritura escribe, porque sobre una repetición esa validación ve el mundo **después** de la operación original y la rechaza.

El caso concreto del sistema es el cobro de una cuenta corriente: su monto no puede superar el saldo pendiente (RN-CCC-04, D-37), y un cobro que cancela más de la mitad de lo adeudado consume ese saldo. La repetición encontraría el saldo ya consumido y recibiría un rechazo por saldo insuficiente sobre una operación que sí se guardó — un resultado peor que el duplicado que el mecanismo vino a evitar, porque empuja a corregir el monto hacia abajo y eso sí produce un duplicado real.

La resolución anticipada SHALL ser una lectura por clave scopeada por `negocio_id`, y SHALL NOT reemplazar al índice único ni a la traducción del `IntegrityError`: sigue siendo la base la que garantiza la unicidad, y el camino de la violación sigue siendo el que resuelve el caso concurrente.

Un rechazo SHALL seguir dejando la clave libre. La clave la consume una escritura exitosa, nunca un intento.

#### Scenario: la repetición de un cobro que saldó la cuenta entera no se rechaza

- **WHEN** un cobro cancela el saldo pendiente completo de un cliente, la respuesta se pierde, y llega un reintento con la misma clave y los mismos datos
- **THEN** la respuesta es la repetición del cobro original, no un rechazo por saldo insuficiente, y el cliente tiene un solo cobro registrado

#### Scenario: la resolución anticipada no vuelve inalcanzable el camino de la violación

- **WHEN** dos requests con la misma clave llegan a la vez y ninguna encuentra la clave en su lectura previa
- **THEN** las dos intentan el `INSERT`, la base rechaza la segunda, y esa segunda responde con el recurso creado por la primera

#### Scenario: un rechazo no consume la clave

- **WHEN** una escritura con una clave nueva es rechazada por una validación y después se reenvía corregida con esa misma clave
- **THEN** el reenvío se crea normalmente, porque la clave nunca llegó a usarse

### Requirement: La respuesta de una repetición se arma al responder y nunca se congela

El sistema SHALL construir la respuesta de una repetición por el mismo camino que la de una creación, releyendo el recurso y recalculando cualquier valor derivado en ese momento, y SHALL NOT almacenar ni devolver una copia guardada de la respuesta original.

La garantía que da este mecanismo es **"no se creó una segunda fila"**, no **"recibís los mismos bytes"**. Esa distinción es la que permite que un recurso con valores derivados —el `estado` FIFO de una factura, que se calcula en cada lectura y nunca se persiste (RN-FAC-09, D-01)— pueda ser repetido sin mentir.

Guardar el cuerpo de la respuesta original haría que una repetición devolviera un valor derivado que ya es falso: el sistema afirmando algo que sus propias reglas contradicen, y una segunda fuente de verdad que se desincroniza del recurso apenas alguien lo edita o apenas cambia algo de lo que ese valor depende.

La consecuencia SHALL aceptarse explícitamente: **la respuesta de una repetición puede diferir de la respuesta original** cuando un valor derivado cambió en el medio. No es una regresión, es la definición.

#### Scenario: la repetición refleja el estado derivado de ahora

- **WHEN** se repite el registro de un recurso cuyo estado derivado cambió entre el intento original y el reintento
- **THEN** la respuesta lleva el estado derivado actual, no el que devolvió la respuesta original

#### Scenario: la repetición sigue siendo el mismo recurso

- **WHEN** la respuesta de una repetición difiere de la original en un valor derivado
- **THEN** el `id` es el mismo y sigue existiendo un solo recurso con esa clave

### Requirement: Una escritura protegida sin su mitad de cliente no está protegida

Todo endpoint declarado como escritura protegida SHALL tener el envío y la reutilización de la clave cableados en el cliente que lo consume, y esa mitad SHALL entregarse junto con la protección del backend, nunca como un paso opcional posterior.

El backend solo puede desduplicar lo que el cliente le pide desduplicar. Un endpoint que sabe reconocer una clave repetida, consumido por un formulario que no manda ninguna, está exactamente tan expuesto como antes — con la diferencia de que ahora **parece** arreglado, y eso es peor que estar roto de forma visible.

Cada escritura protegida SHALL usar su propio espacio de nombres de clave, de modo que dos formularios distintos abiertos a la vez no compartan ni pisen la clave del otro.

Un envío nuevo, sin clave, SHALL ser detectable por prueba: como un `POST` sin la clave **no** produce error, la única señal de que un punto de llamada se la olvidó es una prueba que afirme que siempre viaja.

#### Scenario: cada escritura protegida manda la clave

- **WHEN** el cliente ejecuta la creación de cualquier recurso cuyo endpoint es una escritura protegida
- **THEN** la request lleva el header `Idempotency-Key`

#### Scenario: dos formularios abiertos a la vez no comparten clave

- **WHEN** se cargan en paralelo dos operaciones de tipos distintos, ambos protegidos
- **THEN** cada una lleva su propia clave y confirmar una no descarta la de la otra

## MODIFIED Requirements

### Requirement: La desduplicación la garantiza la base de datos, no una comprobación previa

El sistema SHALL garantizar la unicidad de `(negocio_id, idempotency_key)` con un **índice único** en la base de datos, y SHALL NOT depender de un `SELECT` previo al `INSERT` para decidir si una clave ya fue usada.

Entre consultar y escribir hay una ventana, y dos taps sobre el mismo botón la encuentran. La violación de unicidad SHALL traducirse a la respuesta de repetición, siguiendo el mismo patrón que la unicidad de nombre de cliente (D-45): la aplicación valida para dar un mensaje útil, la base valida para que la regla sea cierta.

Una lectura previa por clave SHALL estar permitida únicamente para decidir **si hace falta correr una validación con estado** (ver el requisito correspondiente), nunca para decidir si la clave está libre. La distinción no es formal: la lectura previa puede no encontrar nada y aun así la clave estar tomada por una transacción sin commitear, así que el camino del `INSERT` y su `IntegrityError` SHALL permanecer y SHALL seguir siendo alcanzable. Borrarlo por creer que la lectura previa lo reemplaza degrada el caso concurrente a un error de servidor.

El índice SHALL NOT excluir las filas con soft delete. Liberar la clave al borrar el recurso haría que un reintento tardío creara una segunda operación: la clave la consume la operación, no el ciclo de vida del recurso.

#### Scenario: dos requests concurrentes con la misma clave

- **WHEN** dos requests con la misma clave llegan a la vez y la primera todavía no commiteó
- **THEN** se crea exactamente un recurso, y la segunda request recibe ese mismo recurso en lugar de un error

#### Scenario: una violación de unicidad ajena no se confunde con una repetición

- **WHEN** el `INSERT` falla por una restricción de unicidad distinta de la de idempotencia
- **THEN** el error se propaga como corresponde a esa restricción y no se responde como si fuera una repetición

#### Scenario: la sesión sigue usable después de la violación

- **WHEN** el `INSERT` viola el índice de idempotencia y el sistema debe releer el recurso original
- **THEN** la lectura posterior funciona, porque la transacción fallida se revierte antes de consultar

#### Scenario: la lectura previa no sustituye a la garantía de la base

- **WHEN** una escritura resuelve la repetición con una lectura previa por clave y esa lectura no encuentra nada porque la request original todavía no commiteó
- **THEN** el `INSERT` se intenta igual, la base rechaza el duplicado, y la repetición se resuelve por ese camino

### Requirement: El resultado de un guardado se clasifica en cuatro estados distinguibles

El cliente SHALL clasificar el resultado de una escritura protegida como **creado**, **ya registrado**, **rechazado** o **desconocido**, y SHALL mostrar algo distinto en cada caso.

Hoy los cuatro se ven igual —un mensaje genérico de error con el botón habilitado— y esa indistinción es la que produce el duplicado.

Una respuesta `5xx` SHALL clasificarse como **desconocido**, no como rechazo: un `502` o un `504` de un proxy puede llegar después de que la aplicación commiteó, y tratarlo como "no se guardó" invita al mismo duplicado por otro camino.

Ante un resultado **desconocido** el cliente SHALL decir que no se pudo confirmar si la operación se guardó, SHALL ofrecer el reintento como acción principal indicando que **debería** ser seguro, y SHALL conservar todo lo cargado en el formulario. Esa promesa SHALL NOT ser incondicional: SHALL excluir explícitamente el caso en que la página se cerró o recargó entre el intento y el reintento, porque ahí la bitácora de la clave del lado del cliente se pierde de verdad y el reintento ya no está garantizado. Ante **ya registrado** SHALL informar éxito señalando que la operación ya estaba registrada, y SHALL NOT mostrar un error.

La promesa de reintento seguro SHALL hacerse **solo** sobre una escritura efectivamente protegida — un endpoint que desduplica, consumido por un formulario que manda la clave. Un formulario cuya escritura todavía no está protegida SHALL, ante un resultado desconocido, pedir que se revise el listado antes de volver a intentar y SHALL NOT ofrecer el reintento como acción principal ni afirmar que es seguro. Ese copy conservador SHALL retirarse en el mismo entregable que cablea la clave en ese formulario, nunca antes: retirarlo primero promete una seguridad que no existe, y dejarlo después obliga a un trabajo manual que el sistema ya está haciendo.

#### Scenario: una creación confirmada

- **WHEN** la respuesta es `201`
- **THEN** se informa que la operación quedó registrada y se continúa como hasta ahora

#### Scenario: una repetición se ve como éxito, no como error

- **WHEN** la respuesta es `200` con `Idempotent-Replay: true`
- **THEN** se informa éxito aclarando que la operación **ya estaba** registrada, y no se muestra ningún error

#### Scenario: un rechazo muestra el motivo del backend

- **WHEN** la respuesta es `422`
- **THEN** se muestra el mensaje del backend y se deja el formulario con los datos cargados

#### Scenario: un timeout no se presenta como fallo

- **WHEN** la request se corta por `timeout` o por error de red, y la página siguió abierta
- **THEN** se informa que no se pudo confirmar si se guardó, se aclara que volver a intentar debería ser seguro, y el reintento queda como acción principal

#### Scenario: la promesa de reintento seguro no cubre una página cerrada o recargada

- **WHEN** la request se corta por `timeout` o por error de red
- **THEN** el mensaje aclara que la garantía de reintento seguro no aplica si la página se cerró o recargó mientras tanto, porque la clave pendiente vivía solo en ese contexto

#### Scenario: un 502 se trata como desconocido

- **WHEN** la respuesta es `502`
- **THEN** se clasifica como desconocido y no como rechazo

#### Scenario: una escritura sin proteger no promete que el reintento sea seguro

- **WHEN** un formulario cuya escritura todavía no manda clave de idempotencia obtiene un resultado desconocido
- **THEN** el mensaje pide revisar el listado antes de volver a intentar, y el reintento no se ofrece como acción principal

#### Scenario: el copy conservador se retira junto con la clave

- **WHEN** un formulario pasa a mandar la clave de idempotencia en su escritura
- **THEN** su mensaje de resultado desconocido pasa a ofrecer el reintento como acción principal y deja de pedir que se revise el listado
