# escritura-idempotente Specification

## Purpose

A generic, reusable idempotency mechanism for the system's protected writes, shipped by C-42 against `POST /api/ventas` as its first and — for now — only caller. A client-supplied `Idempotency-Key` header lets the database itself decide whether a request is a retry (return the original resource) or a real conflict (`409`), instead of trusting a `SELECT`-then-`INSERT` check that a concurrent request can always outrun.

Deliberately generic — the capability's requirements never mention `Venta` — because the same shape is meant to cover pagos, facturas and cobros without a redesign (C-43). The client half of the mechanism (key minting/reuse, the shared HTTP timeout, and outcome classification into created / already-recorded / rejected / unknown) lives here too, since a header nobody's client reuses on retry is decorative.

The retry-is-safe promise the client makes has one honest limit: it does not cover a page that was closed or reloaded between the failed attempt and the retry, because the pending key's bookkeeping lives only in that browser context and is genuinely lost when it goes away.

NOT here: which endpoints besides ventas call this (that is each capability's own delta, e.g. `ventas-backend`), and any dedup story for pagos/facturas/cobros — those endpoints do not yet send or check an idempotency key (C-43).
## Requirements
### Requirement: Una escritura protegida acepta una clave de idempotencia provista por el cliente

Un endpoint de escritura protegido SHALL aceptar un header **opcional** `Idempotency-Key` cuyo valor es un UUID, y SHALL comportarse exactamente como antes cuando el header está ausente.

La clave la genera el **cliente**, nunca se deriva del contenido de la operación. Derivarla del contenido —un hash de monto, fecha y forma de pago— convertiría dos operaciones reales e idénticas en una sola, y en este dominio dos ventas iguales en el mismo minuto son un caso normal (RN-VTA-06). El error que introduce es peor que el que evita: un duplicado se ve y se corrige, una operación que nunca se guardó no deja rastro.

Un valor que no sea un UUID válido SHALL ser rechazado con `422`, sin crear nada.

#### Scenario: sin header, el comportamiento no cambia

- **WHEN** se postea una operación sin `Idempotency-Key`
- **THEN** se crea normalmente y la respuesta es idéntica a la de antes de este change

#### Scenario: una clave malformada se rechaza

- **WHEN** se postea con `Idempotency-Key: no-es-un-uuid`
- **THEN** la respuesta es `422` y no se persiste nada

#### Scenario: dos operaciones idénticas con claves distintas son dos operaciones

- **WHEN** se postean dos operaciones con exactamente los mismos datos pero con claves de idempotencia diferentes
- **THEN** se crean las dos, porque son dos intenciones distintas del usuario

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

### Requirement: Una request repetida devuelve el recurso original, no un conflicto

Ante una clave ya usada con **los mismos datos**, el sistema SHALL devolver el recurso creado por la request original con `200 OK` y el header `Idempotent-Replay: true`, y SHALL NOT crear nada.

El status es `200` y no `201` porque esta request no creó nada. El header es lo único que distingue una repetición de una creación, ya que el cuerpo es idéntico; sin él el cliente no puede decirle a la persona que la operación **ya estaba** registrada.

Un conflicto sería la respuesta equivocada: obligaría al cliente a traducir "conflicto" a "en realidad salió bien", y cualquier error en esa traducción le muestra un fallo a alguien cuya operación sí se guardó.

#### Scenario: el reintento devuelve el mismo recurso

- **WHEN** se repite la request con la misma clave y los mismos datos
- **THEN** la respuesta es `200` con el header `Idempotent-Replay: true` y el cuerpo es el recurso creado por la primera request, con el mismo `id`

#### Scenario: la repetición no crea una segunda fila

- **WHEN** se repite la request cinco veces con la misma clave
- **THEN** existe exactamente un recurso con esa clave

#### Scenario: la primera request no se marca como repetición

- **WHEN** se postea por primera vez con una clave nueva
- **THEN** la respuesta es `201` y no lleva el header `Idempotent-Replay`

### Requirement: Una clave reutilizada con datos distintos es un conflicto

Ante una clave ya usada con datos **distintos** de los guardados, el sistema SHALL responder `409` incluyendo el recurso existente en el `detail`, y SHALL NOT crear nada ni devolver el recurso viejo como si fuera el nuevo.

Devolver el recurso original le diría "guardado" a alguien que corrigió un dato y cuya corrección se descartó en silencio. El recurso existente viaja en el `detail` —misma forma que `cliente_existente` en C-32— para que la interfaz pueda mostrarlo en lugar de un error seco.

El mensaje SHALL ser neutro respecto de quién cambió qué: el recurso pudo haber sido editado después de crearse, en cuyo caso la diferencia no la introdujo esta request.

Si el recurso asociado a la clave fue eliminado, la respuesta SHALL ser `409` y no una repetición: devolverlo lo haría pasar por vigente.

#### Scenario: misma clave, monto distinto

- **WHEN** se repite la request con la misma clave y un monto diferente
- **THEN** la respuesta es `409`, el `detail` incluye el recurso existente, y no se crea nada

#### Scenario: la clave de un recurso eliminado no se recicla

- **WHEN** el recurso creado con una clave se elimina y después llega un reintento con esa misma clave
- **THEN** la respuesta es `409` y no se crea un segundo recurso

### Requirement: La clave está aislada por negocio y no vence

La búsqueda de una operación por su clave de idempotencia SHALL filtrar por `negocio_id` en el service layer, y la unicidad SHALL ser de `(negocio_id, idempotency_key)`, nunca de la clave sola.

Sin ese filtro, una clave adivinada devolvería el recurso de otra cuenta: sería una fuga de datos entre negocios disfrazada de mecanismo de resiliencia (Regla Dura #3, D-06).

La clave SHALL NOT tener vencimiento. Un vencimiento parece prolijo y su modo de falla es exactamente el bug que este mecanismo evita: pasada la ventana, la misma clave vuelve a crear filas y lo hace en silencio.

#### Scenario: la misma clave en dos negocios crea dos recursos

- **WHEN** dos negocios distintos postean con la misma clave de idempotencia
- **THEN** cada uno obtiene su propio recurso creado, y ninguno ve el del otro

#### Scenario: una clave de otro negocio no devuelve nada ajeno

- **WHEN** un negocio postea con una clave que ya usó otro negocio
- **THEN** la respuesta es la creación de su propio recurso, nunca el recurso ajeno

### Requirement: El cliente reutiliza la clave al reintentar el mismo intento de guardado

El cliente SHALL acuñar una clave de idempotencia en el primer envío de un conjunto de datos y SHALL reutilizar **esa misma clave** mientras se reintente ese mismo conjunto de datos. Si el usuario modifica cualquier campo antes de reintentar, el cliente SHALL acuñar una clave nueva.

Esta es la mitad del mecanismo que vive en el navegador, y sin ella el header es decorativo: un reintento con clave nueva es un duplicado con pasos de más. La clave SHALL descartarse cuando el resultado quede confirmado —creado, ya registrado, o rechazado con conflicto—, nunca ante un resultado desconocido.

La clave SHALL sobrevivir a una recarga de la pestaña; si el almacenamiento del navegador no está disponible, el cliente SHALL degradar a memoria sin romper el guardado.

#### Scenario: el reintento manda la misma clave

- **WHEN** un envío falla sin respuesta y la persona vuelve a apretar guardar sin cambiar nada
- **THEN** el segundo request lleva exactamente la misma clave que el primero

#### Scenario: editar un campo acuña una clave nueva

- **WHEN** un envío falla, la persona corrige el monto y vuelve a guardar
- **THEN** el request lleva una clave distinta de la del intento anterior

#### Scenario: la clave se descarta al confirmarse el resultado

- **WHEN** un guardado se confirma y después se abre el formulario para cargar otra operación
- **THEN** el nuevo envío lleva una clave distinta de la del guardado anterior

#### Scenario: el almacenamiento no disponible no rompe el guardado

- **WHEN** el almacenamiento del navegador lanza una excepción al leer o escribir
- **THEN** el guardado procede igual, con la clave mantenida solo en memoria

### Requirement: El cliente acota cuánto espera una request

El cliente HTTP compartido SHALL definir un `timeout` por defecto de **20 segundos**, y SHALL permitir que una request individual lo aumente cuando su duración legítima es mayor.

Sin techo, una request puede colgarse indefinidamente sobre datos móviles y la persona concluye que la app está rota. Un techo demasiado agresivo es peor que ninguno: aborta requests que iban a salir bien y **fabrica** la misma ambigüedad que la idempotencia vino a eliminar.

Las llamadas de extracción por IA SHALL usar un `timeout` explícito y mayor, porque esperan a un modelo de visión y decenas de segundos son su comportamiento normal.

Este requisito agrega una propiedad al cliente Axios compartido y SHALL NOT alterar su contrato existente de credenciales ni su interceptor de `401`.

#### Scenario: una request estancada se corta

- **WHEN** una request no recibe respuesta dentro del `timeout` por defecto
- **THEN** se aborta y se reporta como resultado desconocido, no como rechazo

#### Scenario: la extracción por IA no se corta a los 20 segundos

- **WHEN** se envía una imagen a un endpoint de extracción por IA y el modelo tarda más que el `timeout` por defecto
- **THEN** la request sigue viva hasta su propio `timeout`, mayor y explícito

#### Scenario: el timeout no interfiere con el refresh de sesión

- **WHEN** una request falla por `timeout`
- **THEN** no se dispara el flujo de refresh de sesión, porque no hubo respuesta `401`

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

