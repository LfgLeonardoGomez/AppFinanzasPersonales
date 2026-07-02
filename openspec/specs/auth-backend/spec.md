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

El sistema SHALL exponer `POST /api/auth/registro` que recibe `email`, `nombre` y `password` validados con **Pydantic** (formato de email, password de longitud mínima 8). El servicio SHALL rechazar un email ya existente con un error explícito de email en uso, y en alta exitosa SHALL persistir el usuario con la contraseña hasheada (argon2id). El endpoint SHALL NOT devolver el `password_hash` en la respuesta.

#### Scenario: registro exitoso

- **WHEN** se hace `POST /api/auth/registro` con email nuevo, nombre y password de ≥ 8 caracteres
- **THEN** el usuario queda persistido con `password_hash` argon2id y la respuesta no incluye `password_hash`

#### Scenario: email duplicado

- **WHEN** se registra un email que ya existe
- **THEN** la respuesta indica que el email está en uso y no se crea un segundo usuario

#### Scenario: validación Pydantic de entrada

- **WHEN** se hace `POST /api/auth/registro` con email mal formado o password de menos de 8 caracteres
- **THEN** la API responde 422 sin crear el usuario

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

El sistema SHALL proveer una dependency `get_current_user` que extrae el access token de la cookie, lo valida con `decode_token` (firma, expiración, `type="access"`) y devuelve el `Usuario` autenticado, sirviendo de única fuente del `usuario_id` para el resto del backend. El acceso a una ruta protegida sin sesión válida (cookie ausente, token inválido o expirado) SHALL responder **401**. El sistema SHALL exponer `GET /api/me` que devuelve el perfil del usuario autenticado sin el `password_hash`.

#### Scenario: GET /api/me con sesión válida

- **WHEN** un usuario autenticado hace `GET /api/me` con su cookie de access token válida
- **THEN** la respuesta contiene su perfil (email, nombre, etc.) sin el `password_hash`

#### Scenario: acceso sin sesión devuelve 401

- **WHEN** se hace `GET /api/me` sin cookie de sesión o con un token inválido/expirado
- **THEN** la API responde 401

### Requirement: Aislamiento multi-usuario (404 ante recurso ajeno)

El `usuario_id` provisto por `get_current_user` SHALL ser la única fuente de identidad para el scoping de recursos en el service layer. El acceso a un recurso de otro usuario SHALL responder **404 (no 403)** para no revelar la existencia del recurso. Esta capacidad de auth SHALL proveer el `usuario_id` autenticado; el enforcement del filtro por `usuario_id` vive en los services de las capacidades de negocio (C-06+).

#### Scenario: get_current_user provee el usuario_id correcto

- **WHEN** dos usuarios distintos están autenticados con sus respectivas cookies
- **THEN** `get_current_user` devuelve, para cada request, el `Usuario` correspondiente a su propio token y no del otro

#### Scenario: recurso ajeno devuelve 404, no 403

- **WHEN** un usuario autenticado intenta acceder a un recurso perteneciente a otro usuario (en un endpoint de negocio que use `get_current_user`)
- **THEN** la respuesta es 404, sin revelar que el recurso existe

### Requirement: Rate limiting de registro y login

El sistema SHALL limitar `POST /api/auth/registro` y `POST /api/auth/login` a **5 intentos por 60 segundos por IP** mediante una ventana deslizante. El intento que excede el límite dentro de la ventana SHALL responder **429**.

#### Scenario: el sexto intento se bloquea

- **WHEN** se hacen 5 intentos de login desde la misma IP dentro de 60 segundos y luego un sexto
- **THEN** los primeros 5 se procesan normalmente y el sexto responde 429

#### Scenario: el límite es por IP

- **WHEN** dos IPs distintas hacen intentos de login en la misma ventana de tiempo
- **THEN** el contador de una IP no afecta a la otra
