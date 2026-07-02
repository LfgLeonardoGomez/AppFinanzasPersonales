## 1. Enums y mixin base

- [x] 1.1 Crear `app/models/enums.py` con `TemaPreferido` (CLARO/OSCURO), `CategoriaProveedor` (INSUMO/SERVICIO/OTRO), `OrigenDocumento` (MANUAL/IA) y `MetodoPago` (EFECTIVO/TRANSFERENCIA/TARJETA/MERCADOPAGO/OTRO) como `str, Enum`
- [x] 1.2 Crear `app/models/base.py` con el mixin de `id` (UUID, `default_factory=new_uuid` importado de `app/core/uuid_utils.py`, primary_key), `created_at` y `updated_at` (auto, `onupdate`)
- [x] 1.3 Añadir el soft delete (`deleted_at` nullable) como mixin separado o campo reutilizable, NO incluido en el mixin base de timestamps
- [x] 1.4 Test: `new_uuid` genera el `id` por defecto; `created_at`/`updated_at` quedan poblados; `updated_at` cambia al actualizar; el mixin no expone `saldo` ni `estado`

## 2. Modelo Usuario

- [x] 2.1 Crear `app/models/usuario.py` con `Usuario` (tabla `usuario`): `email` (único), `nombre`, `password_hash`, `telefono?`, `avatar_url?`, `nombre_negocio?`, `tema_preferido` (default CLARO) + mixin base; SIN `deleted_at`
- [x] 2.2 Test: email único rechaza duplicado; campos opcionales aceptan `null`; `tema_preferido` por defecto = CLARO

## 3. Modelo Proveedor

- [x] 3.1 Crear `app/models/proveedor.py` con `Proveedor` (tabla `proveedor`): `usuario_id` (FK usuario), `nombre` (máx 120, no único), `cuit?`, `telefono?`, `categoria` (default OTRO), `notas?` (text), `deleted_at?` + mixin base
- [x] 3.2 Test: dos proveedores del mismo usuario con igual `nombre` se guardan sin error; `categoria` por defecto = OTRO; `deleted_at` inicial = null

## 4. Modelos Factura y FacturaItem

- [x] 4.1 Crear `app/models/factura.py` con `Factura` (tabla `factura`): `usuario_id` (FK, denormalizado), `proveedor_id` (FK), `numero?` (no único), `fecha_emision` (date), `fecha_vencimiento?` (date), `monto_total` (numeric(12,2), Decimal), `archivo_url?`, `origen` (OrigenDocumento), `deleted_at?` + mixin base; SIN columna `estado`
- [x] 4.2 Crear `FacturaItem` (tabla `factura_item`): `factura_id` (FK), `descripcion`, `cantidad` (numeric con decimales), `precio_unitario` (numeric(12,2)) + mixin base; SIN `deleted_at`
- [x] 4.3 Test: `Factura` tiene `usuario_id` y `proveedor_id`; el esquema no tiene columna `estado`; `monto_total` preserva dos decimales; `FacturaItem.cantidad` admite decimales

## 5. Modelo Pago

- [x] 5.1 Crear `app/models/pago.py` con `Pago` (tabla `pago`): `usuario_id` (FK, denormalizado), `proveedor_id` (FK), `monto` (numeric(12,2), Decimal), `fecha` (date), `metodo` (MetodoPago), `comprobante_url?`, `origen` (OrigenDocumento), `deleted_at?` + mixin base; SIN `factura_id`
- [x] 5.2 Test: el esquema de `pago` no tiene columna ni FK `factura_id`; un `Pago` se persiste vinculado solo a proveedor y usuario

## 6. Migración Alembic inicial

- [x] 6.1 Generar la migración inicial (autogenerate) que crea `usuario`, `proveedor`, `factura`, `factura_item`, `pago` con sus FKs; revisar a mano el resultado
- [x] 6.2 Añadir índices: `proveedor (usuario_id, deleted_at)`; `factura (usuario_id, proveedor_id, deleted_at, fecha_emision)`; `pago (usuario_id, proveedor_id, deleted_at)`; `factura_item (factura_id)`
- [x] 6.3 Verificar que `downgrade` elimina las cinco tablas y que ninguna tabla tiene columnas `saldo` ni `estado`
- [x] 6.4 Test: `alembic upgrade head` crea las tablas sobre Postgres descartable; `downgrade` revierte; inspección del esquema confirma ausencia de columnas derivadas

## 7. Repositorios (acceso a datos, sin lógica de negocio)

- [x] 7.1 Crear `app/repositories/base_repository.py` con `BaseRepository` genérico: `get`, `list` (filtra `deleted_at IS NULL` por defecto), `create`, `update`, `soft_delete`
- [x] 7.2 Crear repositorios concretos por entidad (`usuario_repository.py`, `proveedor_repository.py`, `factura_repository.py`, `pago_repository.py`) que extiendan `BaseRepository`
- [x] 7.3 Añadir al repositorio de proveedores la consulta agregada de saldo: un único SQL `GROUP BY` que calcula `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)` por proveedor, filtrando `deleted_at IS NULL`; NO persiste saldo
- [x] 7.4 Test: `create` persiste y `get` recupera; `soft_delete` marca `deleted_at` y la entidad desaparece de `list` por defecto; el listado excluye eliminados
- [x] 7.5 Test: la consulta de saldo agregado devuelve por proveedor el saldo correcto en un solo SQL (sin N+1) e ignora facturas/pagos eliminados

## 8. Verificación final

- [x] 8.1 Correr la suite completa de tests del backend sobre Postgres descartable (testcontainers) — todo verde, sin uso de SQLite
- [x] 8.2 Revisar que `app/repositories/` y `app/models/` no contienen validación de invariantes, validación de CUIT/fecha/monto, ni cálculo de FIFO/estado (eso es de C-03+)
- [x] 8.3 Confirmar que ningún modelo, tabla ni repositorio persiste `saldo`, `estado` ni `factura_id`
