## ADDED Requirements

### Requirement: El Negocio es la unidad de aislamiento

El sistema SHALL definir un modelo SQLModel `Negocio` con tabla `negocio` y los campos `nombre` (string de longitud máxima 120, obligatorio) más `id`, `created_at` y `updated_at` del mixin base. El `Negocio` SHALL ser la unidad de aislamiento de todos los datos de negocio: `Proveedor`, `Factura` y `Pago` SHALL llevar `negocio_id` denormalizado y obligatorio. `Negocio` SHALL NOT tener `deleted_at`.

#### Scenario: el negocio se persiste con su nombre

- **WHEN** se crea un `Negocio` con un `nombre`
- **THEN** la entidad se persiste con `id` UUIDv7, `created_at` y `updated_at`, y sin columna `deleted_at`

#### Scenario: las entidades de negocio llevan negocio_id obligatorio

- **WHEN** se inspeccionan los modelos `Proveedor`, `Factura` y `Pago`
- **THEN** los tres tienen una columna `negocio_id` no nullable con FK a `negocio`

### Requirement: Un usuario pertenece a exactamente un negocio

El modelo `Usuario` SHALL tener `negocio_id` (FK → `negocio`, **obligatorio**, no nullable), sin tabla de membresía intermedia. El sistema SHALL NOT permitir que un `Usuario` exista sin `Negocio`. La unicidad global de `email` SHALL mantenerse: una persona que opere dos negocios usa dos cuentas distintas.

#### Scenario: no se puede persistir un usuario sin negocio

- **WHEN** se intenta persistir un `Usuario` con `negocio_id` nulo
- **THEN** la base de datos rechaza la inserción por la restricción `NOT NULL`

#### Scenario: varios usuarios comparten un mismo negocio

- **WHEN** dos `Usuario` distintos tienen el mismo `negocio_id`
- **THEN** ambos se persisten sin error y quedan asociados al mismo `Negocio`

### Requirement: El negocio_id del request se resuelve desde el usuario autenticado

El `negocio_id` usado para el scoping SHALL resolverse como `get_current_user(...).negocio_id`, NO desde un claim del access token. El access token SHALL seguir transportando únicamente `sub` (= `usuario_id`), `iat`, `exp` y `type`, sin cambios respecto de C-03.

**Razón**: `get_current_user` ya realiza un `SELECT` del `Usuario` en cada request por diseño (D-C03-6), de modo que el `negocio_id` está disponible sin costo adicional. Incluirlo en el token no ahorraría consultas y crearía una ventana en la que un token emitido antes de un cambio de estado del usuario seguiría siendo válido hasta expirar. Esto **corrige RN-NEG-09**, cuya premisa ("evitar una consulta a la base por request") es falsa contra el código actual.

#### Scenario: el token no cambia de forma

- **WHEN** se emite un access token para un usuario y se decodifica
- **THEN** el payload contiene `sub`, `iat`, `exp` y `type="access"`, y NO contiene `negocio_id`

#### Scenario: el scoping usa el negocio del usuario autenticado

- **WHEN** un usuario autenticado invoca cualquier endpoint de negocio
- **THEN** el filtro aplicado corresponde al `negocio_id` de su propio `Usuario` hidratado en el request

### Requirement: Aislamiento entre negocios con 404

Toda consulta o mutación de `Proveedor`, `Factura` y `Pago` SHALL filtrarse por el `negocio_id` del usuario autenticado, en el **service layer** (nunca en el router ni en el repository). El acceso a un recurso perteneciente a otro negocio SHALL responder **404 (no 403)**, para no revelar su existencia. El `negocio_id` SHALL tomarse siempre de la sesión y SHALL NOT poder fijarse desde el payload.

#### Scenario: recurso de otro negocio devuelve 404

- **WHEN** un usuario del negocio A intenta leer, modificar o eliminar un proveedor, factura o pago del negocio B
- **THEN** cada operación responde 404 y el recurso del negocio B queda sin modificar

#### Scenario: dos usuarios del mismo negocio ven los mismos datos

- **WHEN** dos usuarios distintos del mismo negocio listan proveedores, facturas o pagos
- **THEN** ambos obtienen exactamente el mismo conjunto de recursos

#### Scenario: el payload no puede fijar el negocio_id

- **WHEN** se envía un payload de creación que incluye un `negocio_id` distinto del de la sesión
- **THEN** el recurso se persiste con el `negocio_id` de la sesión, ignorando el del payload

#### Scenario: un solo eje de aislamiento

- **WHEN** se inspeccionan los services y repositories de proveedores, facturas y pagos
- **THEN** ninguno filtra recursos de negocio por `usuario_id`; el filtro de pertenencia es siempre `negocio_id`

### Requirement: Usuario desactivado no autentica

El modelo `Usuario` SHALL tener `desactivado` (bool, default `false`) y `es_admin` (bool, default `false`). `get_current_user` SHALL rechazar con **401** a todo usuario con `desactivado = true`, aunque su access token siga siendo criptográficamente válido. `desactivado` SHALL NOT ser `deleted_at`: la fila y los registros creados por ese usuario permanecen intactos y accesibles para el resto del negocio.

#### Scenario: usuario desactivado recibe 401

- **WHEN** un usuario con `desactivado = true` presenta un access token válido y no expirado
- **THEN** la respuesta es 401 y no se ejecuta ninguna operación de negocio

#### Scenario: los datos del usuario desactivado siguen disponibles para el negocio

- **WHEN** un usuario es desactivado y otro miembro activo del mismo negocio lista facturas
- **THEN** las facturas cargadas por el usuario desactivado siguen apareciendo en el listado

### Requirement: Autoría separada de la autorización

`Proveedor`, `Factura` y `Pago` SHALL llevar `creado_por_usuario_id` (FK → `usuario`, **nullable**) que registra qué usuario cargó el registro. Este campo SHALL ser exclusivamente informativo: el sistema SHALL NOT usarlo para filtrar acceso ni para decidir pertenencia.

#### Scenario: la autoría se registra al crear

- **WHEN** un usuario autenticado crea un proveedor, factura o pago
- **THEN** el registro persiste `creado_por_usuario_id` con el id de ese usuario y `negocio_id` con el de su negocio

#### Scenario: la autoría no restringe el acceso

- **WHEN** un usuario del negocio accede a un recurso creado por otro usuario del mismo negocio
- **THEN** la operación se permite normalmente, sin considerar `creado_por_usuario_id`

### Requirement: Migración reversible con backfill de datos existentes

El change SHALL incluir una migración Alembic `0006` (revision `"0006"`, `down_revision = "0005"`) que: (1) cree la tabla `negocio`; (2) cree un `Negocio` por cada `Usuario` existente, tomando el nombre de `usuario.nombre_negocio` y usando un valor por defecto derivado de `usuario.nombre` cuando sea nulo o vacío; (3) agregue `negocio_id`, `es_admin` y `desactivado` a `usuario`, agregue `negocio_id` y `creado_por_usuario_id` a `proveedor`, `factura` y `pago`; (4) **backfillee** `usuario.negocio_id` con el negocio recién creado, `<tabla>.negocio_id` a partir del `usuario_id` de cada fila, y `creado_por_usuario_id` con ese mismo `usuario_id`; (5) recién entonces aplique `NOT NULL` a las cuatro columnas `negocio_id`; (6) marque `es_admin = true` para todos los usuarios existentes, que son dueños de su propio negocio. La migración SHALL crear índices por `negocio_id` en `proveedor`, `factura` y `pago`. El `downgrade` SHALL revertir el esquema sin destruir `usuario`, `proveedor`, `factura` ni `pago`.

#### Scenario: upgrade sobre datos existentes no deja huérfanos

- **WHEN** se corre `alembic upgrade head` sobre una base con usuarios, proveedores, facturas y pagos preexistentes
- **THEN** toda fila de `usuario`, `proveedor`, `factura` y `pago` queda con `negocio_id` no nulo, y cada recurso conserva el mismo dueño efectivo que antes de la migración

#### Scenario: cada usuario preexistente queda como admin de su propio negocio

- **WHEN** la migración corre sobre N usuarios preexistentes
- **THEN** se crean N negocios, cada usuario queda asociado al suyo con `es_admin = true` y `desactivado = false`

#### Scenario: el downgrade no destruye datos de negocio

- **WHEN** se corre `alembic downgrade` desde `0006` hasta `0005`
- **THEN** las columnas agregadas y la tabla `negocio` desaparecen, y las filas de `usuario`, `proveedor`, `factura` y `pago` siguen existiendo con sus datos originales

#### Scenario: no se crean columnas derivadas

- **WHEN** se inspecciona el esquema resultante
- **THEN** no existe ninguna columna `saldo` ni `estado` (D-01 intacto)

### Requirement: El registro público crea el negocio junto al usuario

`POST /api/auth/registro` SHALL crear el `Negocio` y el `Usuario` en una **única transacción**, con `es_admin = true` y `desactivado = false` para el usuario creado. Si cualquiera de las dos inserciones falla, SHALL NOT persistirse ninguna de las dos. El endpoint SHALL aceptar un `nombre_negocio` opcional; cuando no se provea, el nombre del negocio SHALL derivarse del nombre del usuario.

**Nota de alcance**: esta capacidad entra en este change porque `usuario.negocio_id` es `NOT NULL`; sin ella el registro existente dejaría de funcionar. El alta de **empleados** contra un negocio ya existente queda fuera de alcance (C-29).

#### Scenario: registro exitoso crea usuario y negocio

- **WHEN** se hace `POST /api/auth/registro` con email nuevo, nombre y password válidos
- **THEN** se persisten un `Negocio` y un `Usuario` asociado a él, con `es_admin = true`, y la respuesta no incluye `password_hash`

#### Scenario: el fallo del registro no deja un negocio huérfano

- **WHEN** el registro falla después de crear el negocio (por ejemplo, por email duplicado detectado en la inserción)
- **THEN** no queda ningún `Negocio` sin usuarios ni ningún `Usuario` sin negocio

#### Scenario: negocios distintos quedan aislados desde el alta

- **WHEN** dos usuarios se registran por separado y cada uno crea un proveedor
- **THEN** ninguno de los dos ve el proveedor del otro en su listado, y acceder al ajeno por id responde 404
