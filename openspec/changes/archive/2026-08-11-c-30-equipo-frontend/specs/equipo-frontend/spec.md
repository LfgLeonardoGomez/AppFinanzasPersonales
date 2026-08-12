## ADDED Requirements

### Requirement: Registro con dos caminos explícitos

La pantalla de registro SHALL ofrecer dos caminos claramente distinguibles: **crear un negocio nuevo** y **sumarse a un negocio existente** con un código de invitación. El segundo camino SHALL pedir el código además de email, nombre y contraseña, y SHALL enviar la petición a `POST /api/auth/registro-empleado`.

El usuario SHALL poder ver cuál de los dos caminos está usando antes de enviar el formulario. Confundirlos tiene consecuencias opuestas: uno crea un local nuevo y el otro entra a uno existente.

#### Scenario: crear un negocio

- **WHEN** el usuario elige "Crear mi negocio" y completa email, nombre y contraseña
- **THEN** la petición va a `/api/auth/registro` y, al volver bien, queda dentro de su negocio nuevo

#### Scenario: sumarse con un código

- **WHEN** el usuario elige "Sumarme a un negocio", completa sus datos y un código válido
- **THEN** la petición va a `/api/auth/registro-empleado` y queda dentro del negocio de la invitación

#### Scenario: el código es obligatorio en el segundo camino

- **WHEN** el usuario elige sumarse y deja el código vacío
- **THEN** el formulario no se envía y se le indica que el código es requerido

#### Scenario: código inválido muestra un mensaje único

- **WHEN** el backend rechaza el código (inexistente, vencido o ya usado)
- **THEN** la pantalla muestra un único mensaje que no distingue el motivo, e invita a pedirle otro código al administrador

### Requirement: Pantalla de equipo restringida a administradores

El sistema SHALL exponer una pantalla de equipo accesible solo a usuarios con `es_admin`. La entrada de navegación SHALL NOT renderizarse para quien no lo sea, y el acceso directo por URL SHALL resolverse sin exponer datos.

Esto no reemplaza al control del backend (403), que sigue siendo la autoridad: la UI evita ofrecer algo que va a fallar.

#### Scenario: el admin ve la sección

- **WHEN** un usuario con `es_admin` navega la aplicación
- **THEN** la entrada de equipo está disponible y la pantalla lista a los miembros

#### Scenario: un miembro común no ve la sección

- **WHEN** un usuario sin `es_admin` navega la aplicación
- **THEN** no se le ofrece ninguna entrada a la pantalla de equipo

#### Scenario: acceso directo por URL sin privilegio

- **WHEN** un usuario sin `es_admin` navega directo a la ruta de equipo
- **THEN** no se muestran datos del equipo y se le comunica que no tiene permiso

### Requirement: Listado de miembros con su estado

La pantalla de equipo SHALL listar los miembros del negocio mostrando nombre, email y si están activos o desactivados, incluyendo a los desactivados. SHALL distinguir visualmente a los administradores.

Los desactivados tienen que estar: un admin no puede reactivar a quien no ve.

#### Scenario: los desactivados aparecen marcados

- **WHEN** el negocio tiene miembros activos y desactivados
- **THEN** todos aparecen y los desactivados se distinguen de los activos

#### Scenario: estado vacío

- **WHEN** el negocio tiene un solo miembro (el propio admin)
- **THEN** la pantalla lo muestra sin errores y ofrece invitar a alguien

### Requirement: El código de invitación se entrega una sola vez

Al generar una invitación, la pantalla SHALL mostrar el código en texto legible, SHALL ofrecer copiarlo al portapapeles, y SHALL advertir de forma explícita que **no podrá volver a verse**. El código SHALL NOT volver a mostrarse en ninguna pantalla posterior.

Solo se persiste el hash, así que este momento es la única oportunidad real de leerlo.

#### Scenario: el código se muestra con su advertencia

- **WHEN** el admin genera una invitación
- **THEN** ve el código, un control para copiarlo, y un aviso de que no podrá recuperarlo

#### Scenario: el código no reaparece

- **WHEN** el admin cierra el diálogo del código y vuelve a la pantalla de equipo
- **THEN** el código no se muestra en ningún lado

#### Scenario: se puede generar otro

- **WHEN** el admin perdió un código
- **THEN** puede generar uno nuevo sin ningún bloqueo

### Requirement: Desactivar y reactivar con sus consecuencias visibles

La pantalla SHALL permitir desactivar y reactivar miembros. Desactivar SHALL pedir confirmación y SHALL explicar que la persona pierde el acceso pero **sus registros se conservan**. Un rechazo por último administrador (409) SHALL mostrarse con su motivo, diferenciado de un error genérico.

#### Scenario: desactivar pide confirmación

- **WHEN** el admin elige desactivar a un miembro
- **THEN** se le pide confirmar y se le aclara que los registros cargados por esa persona se conservan

#### Scenario: el listado refleja el cambio

- **WHEN** la desactivación se completa
- **THEN** el miembro aparece como desactivado sin necesidad de recargar la página

#### Scenario: el último admin recibe una explicación, no un error genérico

- **WHEN** el admin intenta desactivarse siendo el único administrador activo y el backend responde 409
- **THEN** la pantalla explica que el negocio quedaría sin administración, en lugar de mostrar un error sin contexto

#### Scenario: reactivar devuelve el acceso

- **WHEN** el admin reactiva a un miembro desactivado
- **THEN** el listado lo muestra activo nuevamente
