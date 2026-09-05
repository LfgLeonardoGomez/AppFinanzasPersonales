## ADDED Requirements

### Requirement: La pantalla de proveedores aloja los proveedores frecuentes

La pantalla `/proveedores` SHALL mostrar un panel de proveedores frecuentes: los proveedores con mayor saldo, con su nombre, su saldo y la fecha de su última factura cuando exista, más accesos directos para cargarles una factura o un pago.

El panel SHALL obtener sus datos del listado de proveedores ordenado por saldo, a través del cliente de API del propio feature. NO SHALL existir un segundo cliente HTTP que consulte ese mismo endpoint por su cuenta.

Este panel vivía antes en la pantalla de inicio. Ahí era ruido: se mostraba a quien acababa de abrir la app para hacer otra cosa. En la pantalla de proveedores tiene contexto, porque el usuario ya está mirando proveedores.

#### Scenario: El panel de frecuentes aparece en la pantalla de proveedores

- **WHEN** un usuario autenticado abre `/proveedores` y el backend devuelve proveedores
- **THEN** se muestra el panel de proveedores frecuentes con el nombre y el saldo de cada uno

#### Scenario: Sin proveedores, el panel comunica el vacío

- **WHEN** el backend devuelve una lista vacía de proveedores
- **THEN** el panel de frecuentes muestra un estado vacío explícito
- **AND** no muestra tarjetas ni saldos

#### Scenario: Los accesos directos llevan a la carga con el proveedor ya elegido

- **WHEN** el usuario activa el acceso directo de factura o de pago de un proveedor frecuente
- **THEN** la aplicación navega al formulario correspondiente
- **AND** el proveedor llega identificado, sin que el usuario tenga que volver a buscarlo

### Requirement: La pantalla de proveedores aloja la actividad reciente

La pantalla `/proveedores` SHALL mostrar un panel de actividad reciente: la mezcla cronológica de las últimas facturas y pagos, cada una con su tipo, el nombre del proveedor cuando el backend lo informe, su monto y cuánto hace que ocurrió.

El panel SHALL tomar los datos de `GET /api/actividad-reciente` tal como el backend los devuelve, en el orden en que los devuelve. NO SHALL reordenarlos, filtrarlos ni recomponerlos a partir de otras fuentes.

Cuando el backend informe el nombre del proveedor como ausente —cosa que ocurre si el proveedor fue dado de baja— la fila SHALL mostrarse igual, sin ese nombre. Un movimiento real no desaparece de la vista porque su proveedor ya no esté.

#### Scenario: El panel de actividad aparece en la pantalla de proveedores

- **WHEN** un usuario autenticado abre `/proveedores` y el backend devuelve movimientos
- **THEN** se muestra el panel de actividad reciente con una fila por movimiento
- **AND** cada fila distingue si el movimiento es una factura o un pago

#### Scenario: Sin movimientos, el panel comunica el vacío

- **WHEN** el backend devuelve una lista vacía de actividad reciente
- **THEN** el panel muestra un estado vacío explícito

#### Scenario: Una fila sin nombre de proveedor se muestra igual

- **WHEN** el backend devuelve un movimiento cuyo nombre de proveedor viene ausente
- **THEN** la fila se muestra con su tipo, su monto y su antigüedad
- **AND** no se omite la fila ni se inventa un nombre

### Requirement: El saldo se presenta con una única convención de signo en toda la pantalla

Todo saldo mostrado en `/proveedores` SHALL usar la misma convención de signo y el mismo criterio de color, sea cual sea el panel que lo muestre.

Dos paneles de la misma pantalla que muestran el saldo del mismo proveedor con signos opuestos no son una inconsistencia estética: son dos lecturas contradictorias del mismo dato, y el usuario no tiene forma de saber cuál rige.

#### Scenario: El mismo proveedor muestra el mismo saldo en los dos lugares

- **WHEN** un proveedor aparece a la vez en el listado y en el panel de frecuentes
- **THEN** su saldo se muestra con el mismo signo y el mismo criterio de color en ambos

### Requirement: Los datos de los paneles cruzan el borde de parseo del feature

El cliente de API que alimenta la actividad reciente SHALL convertir a número los valores decimales que el backend serializa como cadena, en el borde del cliente, antes de entregarlos a cualquier componente.

Un valor decimal que no se pueda convertir SHALL interrumpir de forma explícita. NO SHALL sustituirse por cero ni por ningún otro valor por defecto: en una lista de movimientos, un cero fabricado es indistinguible de un movimiento real de monto cero.

El tipo público de esos datos SHALL derivarse del esquema OpenAPI del backend, como todo tipo de contrato.

#### Scenario: El monto llega como cadena y el componente lo recibe como número

- **WHEN** el backend responde la actividad reciente con montos serializados como cadena
- **THEN** el cliente los convierte a número antes de entregarlos
- **AND** el componente los recibe ya convertidos, sin convertirlos por su cuenta

#### Scenario: Un monto malformado interrumpe en vez de mostrar cero

- **WHEN** una respuesta de actividad reciente trae un monto que no se puede convertir
- **THEN** la conversión falla de forma explícita
- **AND** el panel queda en estado de error
- **AND** no se muestra un cero ni ningún otro valor sustituto
