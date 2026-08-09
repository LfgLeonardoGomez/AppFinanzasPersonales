## MODIFIED Requirements

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
