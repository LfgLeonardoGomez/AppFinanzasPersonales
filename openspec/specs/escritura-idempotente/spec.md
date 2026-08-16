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
