## ADDED Requirements

### Requirement: Token de reset de un solo uso y vida corta

El sistema SHALL definir un modelo `TokenReset` (tabla `token_reset`) con `usuario_id` (FK, obligatorio), `token_hash` (string único e indexado), `expira_en` (timestamp), `usado_en` (timestamp, nullable) y el mixin base. SHALL persistirse **únicamente el hash**; el valor crudo viaja al usuario por email y no se guarda en ninguna parte.

Un token SHALL considerarse válido **si y solo si** `usado_en IS NULL AND expira_en > now()`. La vida del token SHALL ser de **una hora**, sensiblemente más corta que la de una invitación: este toma control de una cuenta existente, mientras que aquella solo crea una nueva.

#### Scenario: solo se persiste el hash

- **WHEN** se genera un token de reset
- **THEN** la fila guardada contiene un hash y en ningún campo aparece el valor crudo

#### Scenario: el token nace válido y con vencimiento

- **WHEN** se genera un token
- **THEN** se persiste con `usado_en = NULL` y `expira_en` una hora posterior al momento de creación

#### Scenario: un token vencido no sirve

- **WHEN** se intenta usar un token cuyo `expira_en` ya pasó
- **THEN** la operación es rechazada y la contraseña no cambia

#### Scenario: un token no se puede usar dos veces

- **WHEN** se intenta reutilizar un token ya consumido
- **THEN** la operación es rechazada y la contraseña no cambia

### Requirement: El pedido de recuperación no revela si la cuenta existe

El sistema SHALL exponer `POST /api/auth/recuperar` como ruta pública que recibe un email. Cuando el email corresponde a una cuenta activa, SHALL generar un token y enviar el enlace. Cuando no corresponde a ninguna cuenta, SHALL **no hacer nada observable**.

En ambos casos la respuesta SHALL ser **idéntica**: mismo código de estado y mismo cuerpo. El sistema SHALL además ejecutar un trabajo equivalente en las dos ramas, de modo que **el tiempo de respuesta tampoco distinga** una de otra — igualar solo el texto dejaría un canal lateral abierto (mismo criterio que `dummy_verify` en login, D-C03-5).

El endpoint SHALL tener rate limiting.

#### Scenario: email existente y email inexistente responden igual

- **WHEN** se pide recuperación para una cuenta que existe y para una que no
- **THEN** ambas respuestas tienen el mismo código de estado y el mismo cuerpo

#### Scenario: solo se envía correo cuando la cuenta existe

- **WHEN** se pide recuperación para un email sin cuenta
- **THEN** no se envía ningún correo y no se persiste ningún token

#### Scenario: un usuario desactivado no recibe enlace

- **WHEN** se pide recuperación para una cuenta con `desactivado = true`
- **THEN** la respuesta es la misma de siempre y no se envía correo: recuperar la contraseña no puede ser una forma de esquivar una baja

#### Scenario: rate limiting en el pedido

- **WHEN** se superan los intentos permitidos desde el mismo origen
- **THEN** la API responde 429

### Requirement: Aplicar la contraseña nueva

El sistema SHALL exponer `POST /api/auth/reset` como ruta pública que recibe el token y la contraseña nueva. Cuando el token es válido, SHALL hashear la contraseña con argon2id, actualizar el usuario, marcar el token como usado, y responder éxito.

La contraseña nueva SHALL validarse con las mismas reglas que el registro (mínimo 8 caracteres). Un token inválido, vencido o ya usado SHALL producir **el mismo error** en los tres casos.

El endpoint SHALL NOT iniciar sesión automáticamente: tras el cambio, el usuario ingresa por el login normal.

#### Scenario: reset exitoso

- **WHEN** se envía un token válido y una contraseña de al menos 8 caracteres
- **THEN** la contraseña queda cambiada, el token queda marcado como usado, y el usuario puede loguearse con la nueva

#### Scenario: la contraseña anterior deja de servir

- **WHEN** se completa un reset
- **THEN** un intento de login con la contraseña anterior es rechazado

#### Scenario: contraseña nueva demasiado corta

- **WHEN** se envía un token válido con una contraseña de menos de 8 caracteres
- **THEN** la API responde 422, la contraseña no cambia y **el token NO se consume**

#### Scenario: los tres modos de fallo del token son indistinguibles

- **WHEN** se intenta resetear con un token inexistente, con uno vencido y con uno ya usado
- **THEN** las tres respuestas tienen el mismo código de estado y el mismo mensaje

### Requirement: Un reset cierra todo lo que estaba abierto

Al aplicar una contraseña nueva, el sistema SHALL **revocar todos los refresh tokens activos** del usuario y SHALL **invalidar los demás tokens de reset pendientes** de esa misma cuenta.

Quien resetea su contraseña suele hacerlo porque sospecha que perdió el control. Si las sesiones abiertas del intruso sobreviven, el reset no sirvió de nada; y si un token de reset viejo sigue vivo, alcanza para volver a entrar.

#### Scenario: las sesiones abiertas se caen

- **WHEN** un usuario con una sesión activa completa un reset desde otro dispositivo
- **THEN** la sesión anterior deja de poder renovarse

#### Scenario: los demás tokens de reset mueren

- **WHEN** un usuario pidió recuperación dos veces y consume uno de los tokens
- **THEN** el otro token queda inutilizable

#### Scenario: las sesiones de otros usuarios no se tocan

- **WHEN** un usuario completa un reset
- **THEN** las sesiones de sus compañeros de negocio siguen funcionando

### Requirement: Envío de email desacoplado y nunca real en tests

El sistema SHALL definir una abstracción de envío de correo seleccionable por variable de entorno, con al menos una implementación de **consola** para desarrollo, que escribe el mensaje en el log en lugar de enviarlo. Mismo patrón que la abstracción de visión (D-07).

Los tests SHALL usar **siempre** una implementación mockeada: **ninguna corrida de tests SHALL contactar un servicio de correo real** (regla dura #9).

El enlace enviado SHALL construirse sobre `FRONTEND_ORIGIN` y SHALL contener el token crudo, que no existe en ningún otro lado.

#### Scenario: el proveedor se elige por entorno

- **WHEN** se configura el proveedor de correo por variable de entorno
- **THEN** el sistema usa esa implementación sin cambios de código

#### Scenario: en desarrollo el correo va al log

- **WHEN** el proveedor configurado es el de consola y se dispara una recuperación
- **THEN** el mensaje y el enlace quedan en el log y no se envía nada por red

#### Scenario: el enlace apunta al frontend configurado

- **WHEN** se genera el mensaje de recuperación
- **THEN** el enlace comienza con el `FRONTEND_ORIGIN` configurado e incluye el token

### Requirement: Límite de resets pendientes por cuenta

El sistema SHALL limitar la cantidad de tokens de reset **pendientes** que una misma cuenta puede acumular. Superado el límite, un pedido nuevo SHALL invalidar el más viejo en lugar de acumularlo.

El rate limiting existente es por IP y no frena a alguien que rote direcciones para llenarle la casilla a otra persona. Acotar por cuenta reduce el daño de ese abuso y, de paso, achica la ventana de tokens vivos.

#### Scenario: los pedidos repetidos no acumulan tokens vivos

- **WHEN** una misma cuenta pide recuperación muchas veces seguidas
- **THEN** la cantidad de tokens pendientes de esa cuenta no supera el límite

#### Scenario: el token más reciente siempre sirve

- **WHEN** una cuenta pide recuperación varias veces y usa el enlace del último correo
- **THEN** el reset se completa correctamente
