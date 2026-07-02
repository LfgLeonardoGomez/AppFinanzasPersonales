## ADDED Requirements

### Requirement: Mixin base de entidad con UUID y timestamps

Toda entidad de dominio SHALL heredar de un mixin base que aporte un campo `id` de tipo UUID generado por defecto mediante `new_uuid` de `app/core/uuid_utils.py` (UUIDv7, con fallback a UUIDv4 — convención D-16), más `created_at` y `updated_at` de tipo timestamp poblados automáticamente. El `id` SHALL ser la clave primaria. El mixin SHALL NOT incluir `saldo` ni `estado` ni ningún valor derivado.

#### Scenario: id UUID generado por defecto

- **WHEN** se instancia una entidad sin asignar `id` explícitamente
- **THEN** el `id` queda poblado con un UUID producido por `new_uuid` (UUIDv7 cuando la librería está disponible)

#### Scenario: timestamps poblados automáticamente

- **WHEN** se persiste una entidad nueva
- **THEN** `created_at` y `updated_at` quedan con valores de timestamp no nulos

#### Scenario: el mixin no introduce columnas derivadas

- **WHEN** se inspeccionan los campos del mixin base
- **THEN** no existen campos `saldo` ni `estado`

### Requirement: Modelo Usuario

El sistema SHALL definir un modelo SQLModel `Usuario` con tabla `usuario` y los campos: `email` (string, único, obligatorio), `nombre` (string, obligatorio), `password_hash` (string, obligatorio), `telefono` (string, nullable), `avatar_url` (string, nullable), `nombre_negocio` (string, nullable) y `tema_preferido` (enum `TemaPreferido`, default `CLARO`), además de `id`, `created_at` y `updated_at` del mixin base. `Usuario` SHALL NOT tener `deleted_at`.

#### Scenario: email único

- **WHEN** se intenta persistir un segundo `Usuario` con un `email` ya existente
- **THEN** la base de datos rechaza la inserción por la restricción de unicidad de `email`

#### Scenario: campos opcionales nullable

- **WHEN** se crea un `Usuario` sin `telefono`, `avatar_url` ni `nombre_negocio`
- **THEN** la entidad se persiste con esos campos en `null`

#### Scenario: tema por defecto

- **WHEN** se crea un `Usuario` sin especificar `tema_preferido`
- **THEN** el valor persistido es `CLARO`

### Requirement: Modelo Proveedor

El sistema SHALL definir un modelo SQLModel `Proveedor` con tabla `proveedor` y los campos: `usuario_id` (FK → `usuario`, obligatorio), `nombre` (string de longitud máxima 120, obligatorio, **no único**), `cuit` (string, nullable), `telefono` (string, nullable), `categoria` (enum `CategoriaProveedor`, default `OTRO`), `notas` (text, nullable) y `deleted_at` (timestamp, nullable, soft delete), además de los campos del mixin base. La validación del formato de `cuit` SHALL quedar diferida a la capa de servicio (no se valida en el modelo).

#### Scenario: nombre no único

- **WHEN** se persisten dos proveedores del mismo usuario con idéntico `nombre`
- **THEN** ambos se guardan sin error de unicidad

#### Scenario: categoría por defecto

- **WHEN** se crea un `Proveedor` sin especificar `categoria`
- **THEN** el valor persistido es `OTRO`

#### Scenario: soft delete disponible

- **WHEN** se crea un `Proveedor`
- **THEN** la entidad tiene un campo `deleted_at` nullable cuyo valor inicial es `null` (activo)

### Requirement: Modelo Factura

El sistema SHALL definir un modelo SQLModel `Factura` con tabla `factura` y los campos: `usuario_id` (FK → `usuario`, obligatorio, **denormalizado**), `proveedor_id` (FK → `proveedor`, obligatorio), `numero` (string, nullable, **no único**), `fecha_emision` (date, obligatorio), `fecha_vencimiento` (date, nullable), `monto_total` (numeric(12,2)), `archivo_url` (string, nullable), `origen` (enum `OrigenDocumento`), y `deleted_at` (timestamp, nullable, soft delete), además del mixin base. `Factura` SHALL NOT tener columna `estado` (el estado PENDIENTE/PARCIAL/PAGADA es derivado por FIFO en la capa de servicio — D-01, RN-FIFO).

#### Scenario: usuario_id denormalizado presente

- **WHEN** se inspeccionan los campos de `Factura`
- **THEN** existe `usuario_id` además de `proveedor_id`

#### Scenario: sin columna estado

- **WHEN** se inspecciona el esquema de la tabla `factura`
- **THEN** no existe ninguna columna `estado`

#### Scenario: monto con dos decimales

- **WHEN** se persiste una `Factura` con `monto_total` de dos decimales
- **THEN** el valor se almacena como numeric(12,2) preservando ambos decimales

### Requirement: Modelo FacturaItem

El sistema SHALL definir un modelo SQLModel `FacturaItem` con tabla `factura_item` y los campos: `factura_id` (FK → `factura`, obligatorio), `descripcion` (string), `cantidad` (numeric, admite decimales) y `precio_unitario` (numeric(12,2)), además de `id`, `created_at` y `updated_at` del mixin base. `FacturaItem` SHALL NOT tener `deleted_at` (su ciclo de vida sigue al de la factura).

#### Scenario: item asociado a una factura

- **WHEN** se crea un `FacturaItem` con un `factura_id` válido
- **THEN** la entidad se persiste referenciando esa factura

#### Scenario: cantidad admite decimales

- **WHEN** se crea un `FacturaItem` con `cantidad` decimal (por ejemplo 2.5)
- **THEN** el valor se almacena sin truncar a entero

### Requirement: Modelo Pago

El sistema SHALL definir un modelo SQLModel `Pago` con tabla `pago` y los campos: `usuario_id` (FK → `usuario`, obligatorio, **denormalizado**), `proveedor_id` (FK → `proveedor`, obligatorio), `monto` (numeric(12,2)), `fecha` (date, obligatorio), `metodo` (enum `MetodoPago`), `comprobante_url` (string, nullable), `origen` (enum `OrigenDocumento`) y `deleted_at` (timestamp, nullable, soft delete), además del mixin base. `Pago` SHALL NOT tener `factura_id` — un pago se asocia únicamente al proveedor (RN-PAG-01, D-02).

#### Scenario: pago sin vínculo a factura

- **WHEN** se inspecciona el esquema de la tabla `pago`
- **THEN** no existe ninguna columna ni FK `factura_id`

#### Scenario: pago asociado al proveedor

- **WHEN** se crea un `Pago` con `proveedor_id` y `usuario_id` válidos
- **THEN** la entidad se persiste vinculada al proveedor y al usuario, sin referencia a factura alguna

### Requirement: Enums de dominio

El sistema SHALL definir enums acotados reutilizables por los modelos: `TemaPreferido` (`CLARO`, `OSCURO`), `CategoriaProveedor` (`INSUMO`, `SERVICIO`, `OTRO`), `OrigenDocumento` (`MANUAL`, `IA`) y `MetodoPago` (`EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `MERCADOPAGO`, `OTRO`). Los campos enum de los modelos SHALL aceptar únicamente valores de su enum correspondiente.

#### Scenario: valor de enum válido aceptado

- **WHEN** se asigna `metodo = MetodoPago.TRANSFERENCIA` a un `Pago`
- **THEN** el valor se persiste correctamente

#### Scenario: enums con los valores esperados

- **WHEN** se enumeran los miembros de cada enum de dominio
- **THEN** `MetodoPago` contiene exactamente EFECTIVO, TRANSFERENCIA, TARJETA, MERCADOPAGO y OTRO; `CategoriaProveedor` contiene INSUMO, SERVICIO y OTRO; `OrigenDocumento` contiene MANUAL e IA; `TemaPreferido` contiene CLARO y OSCURO

### Requirement: Soft delete por defecto en lecturas

Las entidades que llevan `deleted_at` (`Proveedor`, `Factura`, `Pago`) SHALL representar el estado activo con `deleted_at = null`. Las consultas de listado de los repositorios SHALL filtrar por defecto `deleted_at IS NULL`, devolviendo solo entidades activas salvo que se solicite explícitamente lo contrario.

#### Scenario: listado excluye eliminados

- **WHEN** una entidad tiene `deleted_at` con valor (eliminada) y se invoca el listado por defecto del repositorio
- **THEN** esa entidad no aparece en el resultado

#### Scenario: soft delete preserva la fila

- **WHEN** el repositorio aplica `soft_delete` a una entidad
- **THEN** la fila permanece en la base de datos con `deleted_at` poblado y las FKs intactas

### Requirement: Migración Alembic inicial del esquema

El change SHALL incluir una migración Alembic que cree las tablas `usuario`, `proveedor`, `factura`, `factura_item` y `pago` con sus claves foráneas e índices, incluyendo índices por `usuario_id`, `proveedor_id` y `deleted_at`, y un índice compuesto que soporte el listado de proveedores por usuario y el cálculo FIFO de facturas. La migración SHALL ser reversible (`downgrade` elimina las tablas creadas) y SHALL NOT crear columnas `saldo` ni `estado`.

#### Scenario: upgrade crea las tablas

- **WHEN** se ejecuta `alembic upgrade head` sobre una base de datos vacía
- **THEN** quedan creadas las tablas `usuario`, `proveedor`, `factura`, `factura_item` y `pago` con sus FKs e índices

#### Scenario: downgrade revierte el esquema

- **WHEN** se ejecuta `alembic downgrade` de la migración inicial
- **THEN** las cinco tablas de dominio quedan eliminadas

#### Scenario: sin columnas derivadas en el esquema

- **WHEN** se inspeccionan las tablas creadas por la migración
- **THEN** ninguna tabla contiene columnas `saldo` ni `estado`

### Requirement: Repositorio base genérico

El sistema SHALL definir un `BaseRepository` genérico en `app/repositories/` que exponga los métodos `get`, `list`, `create`, `update` y `soft_delete` sobre el modelo parametrizado, operando solo como acceso a datos. El `BaseRepository` SHALL NOT contener lógica de negocio, validación de invariantes ni cálculo de valores derivados.

#### Scenario: create persiste y devuelve la entidad

- **WHEN** se invoca `create` con datos válidos
- **THEN** la entidad queda persistida y es recuperable por `get` con su `id`

#### Scenario: soft_delete marca como eliminado

- **WHEN** se invoca `soft_delete` sobre una entidad que soporta soft delete
- **THEN** la entidad queda con `deleted_at` poblado y deja de aparecer en `list` por defecto

#### Scenario: el repositorio no contiene lógica de negocio

- **WHEN** se revisa el `BaseRepository` y los repositorios concretos
- **THEN** no implementan validación de invariantes ni cálculo de saldo/estado (solo consultas y persistencia)

### Requirement: Consulta agregada de saldo por proveedor

El repositorio de proveedores SHALL exponer un método de consulta que, mediante un único SQL con `GROUP BY`, calcule el saldo agregado por proveedor del usuario como `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)` (RN-SALDO), sin persistir el resultado en ninguna columna. La consulta SHALL considerar únicamente filas con `deleted_at IS NULL`.

#### Scenario: saldo agregado en una sola consulta

- **WHEN** un usuario tiene proveedores con facturas y pagos activos y se invoca la consulta de saldo
- **THEN** el resultado incluye, por proveedor, el saldo igual a la suma de montos de facturas activas menos la suma de montos de pagos activos, calculado en un solo SQL (sin N+1)

#### Scenario: saldo ignora filas eliminadas

- **WHEN** existen facturas o pagos con `deleted_at` poblado
- **THEN** esos montos no se incluyen en el cálculo del saldo agregado
