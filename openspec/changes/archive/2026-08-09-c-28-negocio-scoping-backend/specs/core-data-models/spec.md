## MODIFIED Requirements

### Requirement: Modelo Usuario

El sistema SHALL definir un modelo SQLModel `Usuario` con tabla `usuario` y los campos: `negocio_id` (FK → `negocio`, **obligatorio**), `es_admin` (bool, default `false`), `desactivado` (bool, default `false`), `email` (string, único, obligatorio), `nombre` (string, obligatorio), `password_hash` (string, obligatorio), `telefono` (string, nullable), `avatar_url` (string, nullable), `nombre_negocio` (string, nullable, **obsoleto** — el nombre del local vive en `Negocio.nombre`) y `tema_preferido` (enum `TemaPreferido`, default `CLARO`), además de `id`, `created_at` y `updated_at` del mixin base. `Usuario` SHALL NOT tener `deleted_at`: la baja de un miembro se representa con `desactivado`, que revoca el acceso sin borrar la fila ni desatribuir los registros que creó.

#### Scenario: email único

- **WHEN** se intenta persistir un segundo `Usuario` con un `email` ya existente
- **THEN** la base de datos rechaza la inserción por la restricción de unicidad de `email`

#### Scenario: campos opcionales nullable

- **WHEN** se crea un `Usuario` sin `telefono`, `avatar_url` ni `nombre_negocio`
- **THEN** la entidad se persiste con esos campos en `null`

#### Scenario: tema por defecto

- **WHEN** se crea un `Usuario` sin especificar `tema_preferido`
- **THEN** el valor persistido es `CLARO`

#### Scenario: negocio_id obligatorio

- **WHEN** se intenta persistir un `Usuario` sin `negocio_id`
- **THEN** la base de datos rechaza la inserción por la restricción `NOT NULL`

#### Scenario: defaults de es_admin y desactivado

- **WHEN** se crea un `Usuario` sin especificar `es_admin` ni `desactivado`
- **THEN** ambos se persisten en `false`

#### Scenario: sigue sin existir deleted_at

- **WHEN** se inspecciona la tabla `usuario`
- **THEN** no existe columna `deleted_at`, y sí existe `desactivado`

### Requirement: Modelo Proveedor

El sistema SHALL definir un modelo SQLModel `Proveedor` con tabla `proveedor` y los campos: `negocio_id` (FK → `negocio`, obligatorio), `creado_por_usuario_id` (FK → `usuario`, nullable, informativo), `nombre` (string de longitud máxima 120, obligatorio, **no único**), `cuit` (string, nullable), `telefono` (string, nullable), `categoria` (enum `CategoriaProveedor`, default `OTRO`), `notas` (text, nullable) y `deleted_at` (timestamp, nullable, soft delete), además de los campos del mixin base. La validación del formato de `cuit` SHALL quedar diferida a la capa de servicio (no se valida en el modelo). El campo `usuario_id` SHALL ser reemplazado por `negocio_id` como eje de pertenencia.

#### Scenario: nombre no único

- **WHEN** se persisten dos proveedores del mismo negocio con idéntico `nombre`
- **THEN** ambos se guardan sin error de unicidad

#### Scenario: pertenencia por negocio

- **WHEN** se inspecciona el modelo `Proveedor`
- **THEN** existe `negocio_id` obligatorio y no existe `usuario_id` como campo de pertenencia

### Requirement: Modelo Factura

El sistema SHALL definir un modelo SQLModel `Factura` con tabla `factura` y los campos: `negocio_id` (FK → `negocio`, obligatorio, **denormalizado**), `creado_por_usuario_id` (FK → `usuario`, nullable, informativo), `proveedor_id` (FK → `proveedor`, obligatorio), `numero` (string, nullable, **no único**), `fecha_emision` (date, obligatorio), `fecha_vencimiento` (date, nullable), `monto_total` (numeric(12,2)), `archivo_url` (string, nullable), `origen` (enum `OrigenDocumento`), y `deleted_at` (timestamp, nullable, soft delete), además del mixin base. `Factura` SHALL NOT tener columna `estado` (el estado PENDIENTE/PARCIAL/PAGADA es derivado por FIFO en la capa de servicio — D-01, RN-FIFO).

#### Scenario: negocio_id denormalizado presente

- **WHEN** se inspecciona el modelo `Factura`
- **THEN** existe `negocio_id` además de `proveedor_id`, y no existe `usuario_id` como campo de pertenencia

#### Scenario: sin columna estado

- **WHEN** se inspecciona la tabla `factura`
- **THEN** no existe ninguna columna `estado`

### Requirement: Modelo Pago

El sistema SHALL definir un modelo SQLModel `Pago` con tabla `pago` y los campos: `negocio_id` (FK → `negocio`, obligatorio, **denormalizado**), `creado_por_usuario_id` (FK → `usuario`, nullable, informativo), `proveedor_id` (FK → `proveedor`, obligatorio), `monto` (numeric(12,2)), `fecha` (date, obligatorio), `metodo` (enum `MetodoPago`), `comprobante_url` (string, nullable), `origen` (enum `OrigenDocumento`) y `deleted_at` (timestamp, nullable, soft delete), además del mixin base. `Pago` SHALL NOT tener `factura_id` — un pago se asocia únicamente al proveedor (RN-PAG-01, D-02).

#### Scenario: pago válido se persiste

- **WHEN** se crea un `Pago` con `proveedor_id` y `negocio_id` válidos
- **THEN** la entidad se persiste correctamente

#### Scenario: sigue sin existir factura_id

- **WHEN** se inspecciona la tabla `pago`
- **THEN** no existe ninguna columna `factura_id`

## ADDED Requirements

### Requirement: Modelo Negocio

El sistema SHALL definir un modelo SQLModel `Negocio` con tabla `negocio` y el campo `nombre` (string de longitud máxima 120, obligatorio), además de `id`, `created_at` y `updated_at` del mixin base. `Negocio` SHALL NOT tener `deleted_at`.

#### Scenario: negocio se persiste con el mixin base

- **WHEN** se crea un `Negocio` con un `nombre`
- **THEN** se persiste con `id` UUIDv7, `created_at` y `updated_at`, y sin `deleted_at`

### Requirement: Invariantes de pertenencia por negocio

Las invariantes de pertenencia validadas en la capa de servicio SHALL compararse por `negocio_id`: `Factura.negocio_id == Proveedor(de esa factura).negocio_id` y `Pago.negocio_id == Proveedor(de ese pago).negocio_id`.

#### Scenario: factura contra proveedor de otro negocio

- **WHEN** se intenta crear una factura cuyo `proveedor_id` pertenece a otro negocio
- **THEN** la operación responde 404 y no se persiste ninguna factura

#### Scenario: pago contra proveedor de otro negocio

- **WHEN** se intenta crear un pago cuyo `proveedor_id` pertenece a otro negocio
- **THEN** la operación responde 404 y no se persiste ningún pago
