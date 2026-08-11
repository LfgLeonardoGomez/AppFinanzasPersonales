## ADDED Requirements

### Requirement: Invitación de un solo uso con vencimiento

El sistema SHALL definir un modelo `InvitacionEmpleado` (tabla `invitacion_empleado`) con `negocio_id` (FK, obligatorio), `codigo_hash` (string único e indexado), `creado_por_usuario_id` (FK → `usuario`), `expira_en` (timestamp) y `usado_en` (timestamp, nullable), más el mixin base. SHALL persistirse **únicamente el hash** del código; el valor legible SHALL devolverse una sola vez en la respuesta de creación y SHALL NOT poder recuperarse después.

Una invitación SHALL considerarse válida **si y solo si** `usado_en IS NULL AND expira_en > now()`.

#### Scenario: el código legible se entrega una sola vez

- **WHEN** un admin genera una invitación
- **THEN** la respuesta incluye el código en texto plano y la fila persistida guarda solo su hash

#### Scenario: no hay forma de recuperar el código

- **WHEN** se consulta cualquier endpoint después de haber generado una invitación
- **THEN** ninguna respuesta expone el código en texto plano

#### Scenario: la invitación nace válida y con vencimiento

- **WHEN** se genera una invitación
- **THEN** se persiste con `usado_en = NULL` y un `expira_en` estrictamente posterior al momento de creación

### Requirement: Alta de empleado contra un código

El sistema SHALL exponer `POST /api/auth/registro-empleado` como **ruta pública** que recibe `email`, `nombre`, `password` y `codigo`. Cuando el código es válido, SHALL crear un `Usuario` con el `negocio_id` de la invitación, `es_admin = false` y `desactivado = false`, hashear la contraseña elegida por el propio empleado, y marcar la invitación como usada — todo en **una única transacción**.

El endpoint SHALL NOT crear un `Negocio` (eso es exclusivo del registro público de C-28).

#### Scenario: alta exitosa contra un código válido

- **WHEN** alguien se registra con un código válido, un email nuevo y una contraseña de al menos 8 caracteres
- **THEN** queda creado un `Usuario` en el negocio de la invitación con `es_admin = false`, la invitación queda marcada como usada, y no se crea ningún `Negocio` nuevo

#### Scenario: el empleado elige su propia contraseña

- **WHEN** el alta se completa
- **THEN** el usuario puede loguearse con la contraseña que él mismo eligió, sin ningún paso intermedio de cambio obligatorio

#### Scenario: un código no se puede usar dos veces

- **WHEN** se intenta registrar un segundo usuario con un código ya consumido
- **THEN** la operación es rechazada y no se crea el segundo usuario

#### Scenario: email duplicado no consume la invitación

- **WHEN** el alta falla porque el email ya existe
- **THEN** no se crea ningún usuario y la invitación sigue disponible para usarse

### Requirement: Error genérico ante código inválido

Un código inexistente, vencido o ya usado SHALL producir **la misma respuesta de error**, sin distinguir entre los tres casos y sin revelar la existencia del negocio. El endpoint SHALL tener rate limiting.

#### Scenario: los tres modos de fallo son indistinguibles

- **WHEN** se intenta el alta con un código inexistente, con uno vencido y con uno ya usado
- **THEN** las tres respuestas tienen el mismo código de estado y el mismo mensaje

#### Scenario: el rate limiting frena el sondeo

- **WHEN** se superan los intentos permitidos de alta por código desde el mismo origen
- **THEN** la API responde 429

### Requirement: Listado del equipo restringido a admin

El sistema SHALL exponer `GET /api/equipo` devolviendo los miembros del `negocio_id` del solicitante, cada uno con al menos `id`, `nombre`, `email`, `es_admin` y `desactivado`. El endpoint SHALL requerir `es_admin`; un miembro sin ese privilegio SHALL ser rechazado. La respuesta SHALL NOT incluir `password_hash`.

#### Scenario: el admin ve a todo su equipo

- **WHEN** un admin consulta `GET /api/equipo` en un negocio con varios miembros
- **THEN** la respuesta los lista a todos, incluidos los desactivados, con su estado

#### Scenario: un miembro común no accede

- **WHEN** un usuario con `es_admin = false` consulta `GET /api/equipo`
- **THEN** la operación es rechazada y no se filtra ningún dato del equipo

#### Scenario: el listado no cruza negocios

- **WHEN** un admin del negocio A consulta el equipo
- **THEN** ningún miembro del negocio B aparece en la respuesta

### Requirement: Generación de invitaciones restringida a admin

El sistema SHALL exponer `POST /api/equipo/invitaciones`, que crea una invitación para el `negocio_id` del solicitante y registra quién la generó. SHALL requerir `es_admin` y SHALL tener rate limiting.

#### Scenario: solo el admin genera invitaciones

- **WHEN** un usuario con `es_admin = false` intenta generar una invitación
- **THEN** la operación es rechazada y no se persiste ninguna invitación

#### Scenario: la invitación queda atada al negocio del admin

- **WHEN** un admin del negocio A genera una invitación
- **THEN** la invitación persiste con `negocio_id` = A y `creado_por_usuario_id` = ese admin

#### Scenario: un código de otro negocio no sirve

- **WHEN** alguien intenta registrarse usando un código generado en un negocio distinto del que cree estar entrando
- **THEN** el usuario queda creado en el negocio de la **invitación**, nunca en otro

### Requirement: Revocación y restauración del acceso

El sistema SHALL exponer `POST /api/equipo/{id}/desactivar` y `POST /api/equipo/{id}/reactivar`, ambos restringidos a `es_admin` y limitados a miembros del propio negocio. Desactivar SHALL setear `desactivado = true` y **revocar todos los refresh tokens activos** del usuario. Reactivar SHALL setear `desactivado = false`.

Desactivar SHALL NOT borrar la fila ni desatribuir los registros que ese usuario creó.

#### Scenario: el desactivado pierde el acceso de inmediato

- **WHEN** un admin desactiva a un miembro que tiene una sesión abierta
- **THEN** el siguiente request de ese miembro responde 401

#### Scenario: el desactivado no puede renovar la sesión

- **WHEN** un miembro desactivado intenta refrescar su sesión con un refresh token que era válido
- **THEN** la renovación es rechazada

#### Scenario: los datos del desactivado sobreviven

- **WHEN** se desactiva a un miembro que había cargado facturas y pagos
- **THEN** esos registros siguen visibles para el resto del negocio y conservan su `creado_por_usuario_id`

#### Scenario: reactivar devuelve el acceso

- **WHEN** un admin reactiva a un miembro previamente desactivado
- **THEN** ese miembro puede volver a loguearse y operar

#### Scenario: no se puede desactivar a alguien de otro negocio

- **WHEN** un admin del negocio A intenta desactivar a un usuario del negocio B
- **THEN** la respuesta es 404 y el usuario de B queda sin modificar

### Requirement: Un negocio nunca queda sin admin activo

El sistema SHALL rechazar toda operación que dejaría al negocio sin ningún `Usuario` con `es_admin = true AND desactivado = false` (RN-NEG-08). El rechazo SHALL ser explícito, distinguible de un 404, para que el admin entienda por qué no se puede.

#### Scenario: el último admin no puede desactivarse a sí mismo

- **WHEN** el único admin activo del negocio intenta desactivarse
- **THEN** la operación es rechazada con un error explícito y sigue activo

#### Scenario: el último admin no puede ser desactivado por otra vía

- **WHEN** se intenta desactivar al único admin activo mediante el endpoint de desactivación
- **THEN** la operación es rechazada, cualquiera sea quien la solicite

#### Scenario: con dos admins activos sí se puede desactivar a uno

- **WHEN** un negocio tiene dos admins activos y se desactiva a uno
- **THEN** la operación se acepta y el negocio conserva un admin activo

### Requirement: El privilegio de admin no se otorga desde la API

En este change el sistema SHALL NOT exponer ningún endpoint que otorgue o quite `es_admin`. El único admin de un negocio es quien lo creó en el registro público (C-28). Los empleados dados de alta por invitación SHALL nacer siempre con `es_admin = false`.

**Decisión explícita del usuario (2026-08-09)**, con su riesgo asumido: si el fundador pierde el acceso, el negocio no tiene otro admin y la única salida es la recuperación de contraseña (C-31).

#### Scenario: no hay ruta de promoción

- **WHEN** se inspeccionan las rutas expuestas bajo `/api/equipo`
- **THEN** ninguna permite modificar `es_admin`

#### Scenario: el payload de alta no puede pedir admin

- **WHEN** un alta por invitación incluye `es_admin = true` en el payload
- **THEN** el usuario se crea igualmente con `es_admin = false`
