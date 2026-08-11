# Auth Backend Specification

## Purpose

Establish a secure, multi-user authentication system for the backend API using:
- Password hashing with argon2id
- Stateless JWT access tokens
- Opaque refresh tokens with rotation and revocation
- Cookie-based session management with HttpOnly/Secure flags
- Rate limiting on auth endpoints
- User isolation via `usuario_id` throughout the system

## Requirements

### Requirement: Hashing de contraseñas con argon2id

El sistema SHALL hashear toda contraseña con **argon2id** vía `passlib` antes de persistirla, exponiendo `hash_password(plain) -> str` y `verify_password(plain, hash) -> bool` en `app/core/security.py`. La contraseña en claro SHALL NOT persistirse, loguearse ni ser recuperable desde el hash. `verify_password` SHALL devolver `False` ante una contraseña incorrecta sin lanzar excepción.

#### Scenario: la contraseña se persiste hasheada, no en claro

- **WHEN** se registra un usuario con una contraseña en claro
- **THEN** el `password_hash` persistido es un hash argon2id distinto de la contraseña en claro y la contraseña en claro no aparece en ninguna columna

#### Scenario: verificación correcta

- **WHEN** se invoca `verify_password` con la contraseña correcta y su hash
- **THEN** devuelve `True`

#### Scenario: verificación incorrecta

- **WHEN** se invoca `verify_password` con una contraseña incorrecta y un hash válido
- **THEN** devuelve `False` sin lanzar excepción

### Requirement: Access token JWT stateless

El sistema SHALL emitir el access token como un **JWT firmado** con `SECRET_KEY` (HS256), con claims `sub` (=`usuario_id`), `exp`, `iat` y `type="access"`, mediante `create_access_token(sub, exp)`. `decode_token(token)` SHALL validar firma y expiración **sin consultar la base de datos** y devolver el payload, o rechazar el token si la firma es inválida o expiró. La expiración SHALL derivarse de `ACCESS_TOKEN_TTL_MIN`.

#### Scenario: token válido se decodifica sin tocar la DB

- **WHEN** se crea un access token para un `usuario_id` y luego se decodifica con `decode_token`
- **THEN** el payload devuelto contiene `sub` igual al `usuario_id` y `type="access"`, sin haber consultado la base de datos

#### Scenario: firma inválida es rechazada

- **WHEN** se decodifica un token firmado con una clave distinta de `SECRET_KEY`
- **THEN** `decode_token` rechaza el token (lanza/señala error de credenciales) y no devuelve payload

#### Scenario: token expirado es rechazado

- **WHEN** se decodifica un access token cuyo `exp` ya pasó
- **THEN** `decode_token` rechaza el token por expiración

### Requirement: Modelo y persistencia de refresh token opaco

El sistema SHALL definir un modelo `RefreshToken` (tabla `refresh_token`) con `usuario_id` (FK → `usuario`, obligatorio), `token_hash` (string, único, indexado), `expires_at` (timestamp), `revoked_at` (timestamp, nullable) más `id` (UUIDv7), `created_at` y `updated_at` del mixin base. El refresh token SHALL ser un valor opaco de alta entropía; en la tabla SHALL persistirse únicamente su **hash**, nunca el valor crudo. Un refresh token SHALL considerarse válido solo si `revoked_at IS NULL` y `expires_at > now()`. La migración Alembic que crea la tabla SHALL ser reversible.

#### Scenario: solo se guarda el hash del refresh

- **WHEN** se emite un refresh token y se persiste su fila
- **THEN** la columna `token_hash` contiene un hash y el valor crudo del token no está almacenado en ninguna columna

#### Scenario: token revocado deja de ser válido

- **WHEN** una fila de `refresh_token` tiene `revoked_at` poblado
- **THEN** ese token no se considera válido para renovar la sesión

#### Scenario: migración reversible de la tabla

- **WHEN** se ejecuta `alembic upgrade head` y luego `alembic downgrade` de la migración de refresh token
- **THEN** la tabla `refresh_token` queda creada y luego eliminada, sin afectar las tablas de C-02

### Requirement: Registro de usuario

El sistema SHALL exponer `POST /api/auth/registro` que recibe `email`, `nombre`, `password` y `nombre_negocio` (opcional) validados con **Pydantic** (formato de email, password de longitud mínima 8). El servicio SHALL rechazar un email ya existente con un error explícito de email en uso, y en alta exitosa SHALL crear un `Negocio` y persistir el usuario asociado a él **en una única transacción**, con la contraseña hasheada (argon2id), `es_admin = true` y `desactivado = false`. Cuando `nombre_negocio` no se provea, el nombre del negocio SHALL derivarse del nombre del usuario. Si cualquiera de las dos inserciones falla, SHALL NOT persistirse ninguna de las dos. El endpoint SHALL NOT devolver el `password_hash` en la respuesta.

#### Scenario: registro exitoso

- **WHEN** se hace `POST /api/auth/registro` con email nuevo, nombre y password de ≥ 8 caracteres
- **THEN** se persisten un `Negocio` y un `Usuario` asociado a él con `es_admin = true` y `password_hash` argon2id, y la respuesta no incluye `password_hash`

#### Scenario: email duplicado

- **WHEN** se registra un email que ya existe
- **THEN** la respuesta indica que el email está en uso, no se crea un segundo usuario y no queda ningún negocio huérfano

#### Scenario: validación Pydantic de entrada

- **WHEN** se hace `POST /api/auth/registro` con email mal formado o password de menos de 8 caracteres
- **THEN** la API responde 422 sin crear el usuario ni el negocio

#### Scenario: nombre de negocio derivado

- **WHEN** se hace un registro exitoso sin enviar `nombre_negocio`
- **THEN** el `Negocio` creado tiene un `nombre` no vacío derivado del nombre del usuario

### Requirement: Login con cookie httpOnly y error genérico

El sistema SHALL exponer `POST /api/auth/login` que verifica las credenciales y, en éxito, emite un access token (JWT) y un refresh token (opaco, persistido hasheado) y los setea como cookies `HttpOnly; Secure; SameSite=Lax`. Ante credenciales inválidas el sistema SHALL responder con **un único mensaje genérico** que no revela si falló el email o la contraseña, y SHALL ejecutar la verificación de contraseña incluso cuando el email no existe para no exponer la diferencia por tiempo de respuesta.

#### Scenario: login exitoso setea cookies

- **WHEN** se hace `POST /api/auth/login` con credenciales correctas
- **THEN** la respuesta setea las cookies de sesión con flags `HttpOnly`, `Secure` y `SameSite=Lax`, y persiste una fila de refresh token hasheada

#### Scenario: credenciales inválidas con mensaje genérico

- **WHEN** se hace login con password incorrecta o con un email inexistente
- **THEN** la respuesta es el mismo mensaje genérico de credenciales inválidas en ambos casos, sin revelar cuál falló

### Requirement: Logout invalida el refresh token

El sistema SHALL exponer `POST /api/auth/logout` que revoca (marca `revoked_at` o elimina) la fila del refresh token de la sesión y borra las cookies de sesión del cliente (`max_age=0`). Tras el logout, el refresh token revocado SHALL NOT poder renovar la sesión.

#### Scenario: logout revoca el refresh

- **WHEN** un usuario autenticado hace `POST /api/auth/logout`
- **THEN** la fila de su refresh token queda revocada y las cookies de sesión se borran en la respuesta

#### Scenario: refresh revocado no renueva

- **WHEN** se intenta `POST /api/auth/refresh` con un refresh token ya revocado por logout
- **THEN** la API rechaza la renovación (401) y no emite nuevos tokens

### Requirement: Rotación del refresh token

El sistema SHALL exponer `POST /api/auth/refresh` que, dado un refresh token válido (no revocado y no expirado), emite un **nuevo** par de tokens, **revoca** el refresh token usado y persiste el nuevo hasheado. Un refresh token ya usado (rotado) SHALL NOT volver a ser válido.

#### Scenario: refresh rota el token

- **WHEN** se hace `POST /api/auth/refresh` con un refresh token válido
- **THEN** se emite un nuevo access y un nuevo refresh, y el refresh anterior queda revocado

#### Scenario: refresh viejo ya no sirve tras rotar

- **WHEN** se intenta `POST /api/auth/refresh` reutilizando un refresh token que ya fue rotado
- **THEN** la API rechaza la renovación (401)

### Requirement: Dependency get_current_user y rutas protegidas

El sistema SHALL proveer una dependency `get_current_user` que extrae el access token de la cookie, lo valida con `decode_token` (firma, expiración, `type="access"`) y devuelve el `Usuario` autenticado, sirviendo de única fuente del `usuario_id` **y del `negocio_id`** para el resto del backend. El acceso a una ruta protegida sin sesión válida (cookie ausente, token inválido o expirado) SHALL responder **401**. Un usuario con `desactivado = true` SHALL ser rechazado con **401** aunque su token sea válido y no haya expirado. El sistema SHALL exponer `GET /api/me` que devuelve el perfil del usuario autenticado sin el `password_hash`.

#### Scenario: GET /api/me con sesión válida

- **WHEN** un usuario autenticado hace `GET /api/me` con su cookie de access token válida
- **THEN** la respuesta contiene su perfil (email, nombre, etc.) sin el `password_hash`

#### Scenario: acceso sin sesión devuelve 401

- **WHEN** se hace `GET /api/me` sin cookie de sesión o con un token inválido/expirado
- **THEN** la API responde 401

#### Scenario: usuario desactivado devuelve 401

- **WHEN** un usuario con `desactivado = true` hace un request con un access token válido y no expirado
- **THEN** la API responde 401 y no se ejecuta ninguna operación de negocio

#### Scenario: get_current_user expone el negocio_id

- **WHEN** un usuario autenticado alcanza una ruta protegida
- **THEN** el `Usuario` devuelto por `get_current_user` incluye su `negocio_id`, disponible para el scoping del service layer sin consultas adicionales

### Requirement: Aislamiento multi-usuario (404 ante recurso ajeno)

El `negocio_id` del `Usuario` provisto por `get_current_user` SHALL ser la única fuente de identidad para el scoping de recursos de negocio en el service layer. El acceso a un recurso de otro negocio SHALL responder **404 (no 403)** para no revelar la existencia del recurso. Esta capacidad de auth SHALL proveer el `Usuario` autenticado con su `negocio_id`; el enforcement del filtro por `negocio_id` vive en los services de las capacidades de negocio. El `usuario_id` SHALL seguir siendo la identidad de sesión (claim `sub`, `RefreshToken.usuario_id`, perfil y rate limit de IA), pero SHALL NOT usarse para decidir pertenencia de recursos de negocio.

#### Scenario: get_current_user provee el negocio_id correcto

- **WHEN** dos usuarios de negocios distintos están autenticados con sus respectivas cookies
- **THEN** `get_current_user` devuelve, para cada request, el `Usuario` con el `negocio_id` correspondiente a su propio token y no el del otro

#### Scenario: recurso ajeno devuelve 404, no 403

- **WHEN** un usuario autenticado intenta acceder a un recurso perteneciente a otro negocio (en un endpoint de negocio que use `get_current_user`)
- **THEN** la respuesta es 404, sin revelar que el recurso existe

#### Scenario: usuarios del mismo negocio comparten los recursos

- **WHEN** dos usuarios distintos del mismo negocio acceden al mismo proveedor, factura o pago por id
- **THEN** ambos obtienen el recurso correctamente, sin 404

#### Scenario: el token conserva usuario_id como sujeto

- **WHEN** se decodifica un access token emitido tras este change
- **THEN** el claim `sub` sigue siendo el `usuario_id` y el payload no incorpora `negocio_id`
### Requirement: Rate limiting de registro y login

El sistema SHALL limitar `POST /api/auth/registro` y `POST /api/auth/login` a **5 intentos por 60 segundos por IP** mediante una ventana deslizante. El intento que excede el límite dentro de la ventana SHALL responder **429**.

#### Scenario: el sexto intento se bloquea

- **WHEN** se hacen 5 intentos de login desde la misma IP dentro de 60 segundos y luego un sexto
- **THEN** los primeros 5 se procesan normalmente y el sexto responde 429

#### Scenario: el límite es por IP

- **WHEN** dos IPs distintas hacen intentos de login en la misma ventana de tiempo
- **THEN** el contador de una IP no afecta a la otra
### Requirement: Registro de empleado contra un negocio existente

El sistema SHALL exponer `POST /api/auth/registro-empleado` como ruta pública, junto a `POST /api/auth/registro`. Ambas crean un `Usuario`, pero son semánticamente distintas y SHALL permanecer separadas: el registro público crea un `Negocio` nuevo y su primer admin (C-28, RN-NEG-03), mientras que el registro de empleado suma un miembro a un negocio **ya existente** identificado por un código de invitación (RN-NEG-04).

El usuario creado por esta ruta SHALL tener `es_admin = false` y elegir su propia contraseña. El endpoint SHALL validar email y longitud mínima de contraseña con Pydantic, SHALL rechazar un email ya en uso, y SHALL tener rate limiting.

#### Scenario: el empleado entra al negocio de su código

- **WHEN** alguien se registra por esta ruta con un código válido
- **THEN** queda como miembro del negocio de esa invitación, con `es_admin = false`, y no se crea ningún `Negocio` nuevo

#### Scenario: las dos rutas de registro no se pisan

- **WHEN** se compara el resultado de `POST /api/auth/registro` con el de `POST /api/auth/registro-empleado`
- **THEN** la primera crea un negocio con su admin y la segunda no crea ningún negocio

#### Scenario: sin código no hay alta de empleado

- **WHEN** se llama a `POST /api/auth/registro-empleado` sin `codigo`
- **THEN** la API responde 422 y no se crea ningún usuario

#### Scenario: rate limiting en el alta por código

- **WHEN** se superan los intentos permitidos desde el mismo origen
- **THEN** la API responde 429
