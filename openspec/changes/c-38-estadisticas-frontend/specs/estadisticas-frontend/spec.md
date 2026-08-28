## ADDED Requirements

### Requirement: Selector compartido de rango y granularidad

Las tres vistas de estadísticas SHALL compartir un único control de rango (`desde`/`hasta`) y granularidad (`dia` | `semana` | `mes`). El estado del selector SHALL vivir en los search params de la URL, de modo que una vista de estadísticas sea enlazable y sobreviva a un refresh.

Al cambiar cualquiera de los tres valores, la vista SHALL volver a pedir los datos al backend. El frontend NO SHALL recalcular, reagrupar ni reinterpretar una serie ya recibida para servir otra granularidad.

#### Scenario: Cambiar la granularidad dispara un refetch

- **WHEN** el usuario tiene una serie cargada en granularidad `mes` y selecciona `semana`
- **THEN** se emite una nueva request al endpoint correspondiente con `granularidad=semana`
- **AND** la serie mostrada es la que devolvió esa respuesta, no una reagrupación local de la anterior

#### Scenario: El rango y la granularidad se reflejan en la URL

- **WHEN** el usuario fija un rango y una granularidad
- **THEN** los search params de la URL contienen `desde`, `hasta` y `granularidad`
- **AND** al recargar la página con esa URL se muestra la misma selección sin pasar por valores por defecto

#### Scenario: El selector arranca con un rango por defecto válido

- **WHEN** el usuario entra a una vista de estadísticas sin search params
- **THEN** el selector se inicializa con un rango y una granularidad que el backend acepta
- **AND** se emite la request inicial con esos valores

### Requirement: Total comprado por proveedor en su ficha

La ficha de proveedor SHALL mostrar el total comprado a ESE proveedor por período, pidiéndolo a `GET /api/estadisticas/compras` con el `proveedor_id` de la ficha.

La vista SHALL mostrar exactamente los períodos que devolvió el backend, en el orden recibido, sin omitir los que vienen en cero.

#### Scenario: La ficha pide las compras acotadas a su proveedor

- **WHEN** se abre la ficha del proveedor `P`
- **THEN** la request a `/api/estadisticas/compras` incluye `proveedor_id=P`

#### Scenario: Un período sin compras se muestra en cero, no se saltea

- **WHEN** el backend devuelve una serie donde un período intermedio tiene `total: 0`
- **THEN** ese período aparece en la vista con valor cero
- **AND** la cantidad de períodos mostrados es igual a la cantidad de períodos recibidos

### Requirement: Ventas por período con desglose por forma de pago

La pantalla de estadísticas de ventas SHALL mostrar, por cada período, el total vendido y su desglose por forma de pago, tomados de `GET /api/estadisticas/ventas`.

El desglose SHALL mostrarse con las etiquetas legibles ya existentes en el proyecto (`FORMA_PAGO_LABELS`), nunca con el valor crudo del enum.

Los montos del desglose SHALL ser los que devolvió el backend. El frontend NO SHALL sumarlos para derivar el total mostrado ni ajustarlos para que cierren.

#### Scenario: El desglose suma el total mostrado

- **WHEN** el backend devuelve un período con `total` y su `desglose`
- **THEN** la suma de los montos del desglose mostrados es igual al total mostrado para ese período

#### Scenario: Una forma de pago sin movimiento se muestra en cero

- **WHEN** el backend devuelve un `desglose` con una forma de pago en `0.00`
- **THEN** esa forma de pago aparece en la vista con valor cero, con su etiqueta legible

#### Scenario: El desglose usa etiquetas legibles

- **WHEN** un período incluye `CUENTA_CORRIENTE` en su desglose
- **THEN** la vista muestra "Cuenta corriente"
- **AND** no muestra la cadena `CUENTA_CORRIENTE`

### Requirement: Contraste de compras contra ventas del período

La vista de contraste SHALL mostrar compras, ventas y su diferencia para el mismo rango, tomados de `GET /api/estadisticas/resumen`.

La diferencia SHALL presentarse con ese nombre. La vista NO SHALL rotularla como margen, ganancia ni rentabilidad, porque el sistema no conoce el costo de la mercadería vendida.

#### Scenario: Se muestran los tres valores del resumen

- **WHEN** el backend devuelve `compras`, `ventas` y `diferencia` para el rango
- **THEN** la vista muestra los tres valores tal como llegaron

#### Scenario: La diferencia no se rotula como margen

- **WHEN** se muestra el resultado del contraste
- **THEN** el rótulo del tercer valor no contiene "margen", "ganancia" ni "rentabilidad"

#### Scenario: Una diferencia negativa se muestra como negativa

- **WHEN** el backend devuelve una `diferencia` menor a cero
- **THEN** la vista la muestra como un valor negativo, sin convertirla a positivo ni ocultarla

### Requirement: Estados de carga, vacío y error de las vistas de estadísticas

Mientras una vista de estadísticas está cargando, SHALL mostrar una indicación de carga y NO SHALL mostrar ceros. Un cero mostrado durante la carga es indistinguible de un cero que significa "no hubo movimiento", y solo el segundo es un dato real.

Cuando el backend devuelve una serie cuyos períodos son todos cero, la vista SHALL comunicar explícitamente que no hubo movimiento en el rango, en lugar de mostrar un gráfico vacío sin explicación.

#### Scenario: Durante la carga no se muestran ceros

- **WHEN** la request de una vista de estadísticas está en vuelo
- **THEN** la vista muestra una indicación de carga accesible
- **AND** no muestra ningún total en cero

#### Scenario: Un rango sin movimiento se comunica como tal

- **WHEN** el backend devuelve una serie con todos los períodos en cero
- **THEN** la vista informa que no hubo movimiento en el rango seleccionado

### Requirement: El tope de períodos del backend se comunica como algo accionable

Ante el **422** con el que el backend rechaza un rango que supera su tope de períodos (`MAX_PERIODOS`), la vista SHALL explicarle al usuario que el rango es demasiado grande para esa granularidad y SHALL indicarle la acción correctiva — achicar el rango o subir la granularidad. NO SHALL presentarlo como un error inesperado ni como una falla de la aplicación.

El backend informa en ese 422 el conteo estimado de períodos, y rechaza con **422** también el rango invertido.

#### Scenario: Rango demasiado grande para la granularidad elegida

- **WHEN** el usuario pide un rango que el backend rechaza con 422 por exceder el tope de períodos
- **THEN** la vista muestra un mensaje que explica que el rango es demasiado grande para esa granularidad
- **AND** el mensaje indica achicar el rango o elegir una granularidad mayor
- **AND** la vista no muestra una serie parcial ni truncada

#### Scenario: Rango invertido

- **WHEN** el usuario deja `hasta` anterior a `desde` y el backend responde 422
- **THEN** la vista informa que el rango es inválido, sin presentarlo como error inesperado

#### Scenario: Proveedor ajeno al negocio

- **WHEN** la request de compras se hace con un `proveedor_id` que el backend responde con 404
- **THEN** la vista informa que el proveedor no existe, sin exponer que pertenece a otro negocio

### Requirement: Los gráficos se renderizan en SVG y su información es legible sin el gráfico

Los gráficos de estadísticas SHALL renderizarse como SVG en el DOM. NO SHALL usarse una librería que dibuje sobre canvas: bajo el entorno de tests del proyecto (`jsdom`, sin el paquete `canvas`) un canvas no produce nada afirmable, y el proyecto no tiene un tier e2e con navegador donde compensarlo.

Todo valor que el gráfico represente SHALL estar disponible como texto accesible, de modo que la información no dependa exclusivamente de la forma dibujada.

#### Scenario: Los valores del gráfico son afirmables sin leer píxeles

- **WHEN** una vista de estadísticas termina de cargar una serie
- **THEN** los totales de los períodos están presentes como texto accesible en el DOM

#### Scenario: El gráfico tiene una descripción accesible

- **WHEN** se renderiza un gráfico de estadísticas
- **THEN** el SVG expone un nombre accesible que describe qué serie representa

### Requirement: La feature de estadísticas queda cubierta por el guard de design system

El guard `tests/design-system-guard.test.ts` SHALL incluir el directorio de la feature de estadísticas en su lista de directorios escaneados, de modo que la feature nueva nazca cubierta y no fuera del control.

Ese guard verifica que las pantallas nuevas reutilicen los tokens del design system en lugar de introducir colores hardcodeados, pero solo escanea los directorios que tiene listados: una feature que no esté en la lista queda sin control, en silencio.

#### Scenario: El guard escanea la feature de estadísticas

- **WHEN** se ejecuta el guard de design system
- **THEN** los archivos de la feature de estadísticas están entre los archivos escaneados

#### Scenario: Un color hardcodeado en estadísticas hace fallar el guard

- **WHEN** un archivo de la feature de estadísticas introduce un color hexadecimal literal
- **THEN** el guard falla e identifica ese archivo
