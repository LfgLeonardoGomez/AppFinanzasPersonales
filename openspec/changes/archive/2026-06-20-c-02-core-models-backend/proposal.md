## Why

La fundación (C-01) dejó el repositorio backend `facturas-proveedores-api` con la estructura en capas vacía y la convención de identificadores UUIDv7 sembrada (D-16), pero sin ningún modelo de dominio. Antes de poder construir autenticación, proveedores, facturas, pagos o cuenta corriente (C-03 en adelante), el sistema necesita la capa de datos: las entidades persistidas, su esquema en PostgreSQL y el acceso a datos. Este change provee esa base — el resto del backend depende de ella.

## What Changes

- Se introducen los modelos SQLModel de las cinco entidades de dominio: `Usuario`, `Proveedor`, `Factura`, `FacturaItem` y `Pago`, según `knowledge-base/04_modelo_de_datos.md`.
- Se añade un mixin base con `id` (UUID, default vía `new_uuid` de `app/core/uuid_utils.py` — UUIDv7, fallback v4 por D-16), `created_at` y `updated_at` (auto), reutilizado por todas las entidades.
- Soft delete (`deleted_at` nullable) en `Proveedor`, `Factura` y `Pago`. `Usuario` y `FacturaItem` no lo llevan.
- `usuario_id` **denormalizado** en `Factura` y `Pago` (además de `proveedor_id`) para aislamiento multi-usuario barato y a prueba de fugas (D-05).
- Enums acotados: `TemaPreferido` (CLARO/OSCURO), `CategoriaProveedor` (INSUMO/SERVICIO/OTRO), `OrigenDocumento` (MANUAL/IA), `MetodoPago` (EFECTIVO/TRANSFERENCIA/TARJETA/MERCADOPAGO/OTRO).
- Montos en `numeric(12,2)` (ARS, sin campo de moneda); fechas como `date`; timestamps en UTC.
- Migración Alembic inicial que crea las tablas `usuario`, `proveedor`, `factura`, `factura_item` y `pago` con sus FKs e índices (por `usuario_id`, `proveedor_id`, `deleted_at`, y compuesto para el listado de proveedores y el cálculo FIFO).
- Repositorios de acceso a datos (capa `repositories/`): un `BaseRepository` genérico (`get`, `list`, `create`, `update`, `soft_delete`) y repositorios concretos por entidad. **Sin lógica de negocio** — solo consultas. Se incluye una consulta agregada GROUP BY de saldo (sin persistir saldo ni estado).
- Tests unitarios de la capa de modelos y repositorios sobre PostgreSQL descartable (testcontainers, arnés de C-01).

**Explícitamente fuera de alcance** (corresponden a C-03+): servicios / lógica de negocio, validación de invariantes, autenticación, routers/endpoints, cálculo de saldo/FIFO/historial y schemas Pydantic de request/response. **NUNCA** se persisten columnas `saldo` ni `estado` (D-01): son derivados on-demand.

## Capabilities

### New Capabilities
- `core-data-models`: capa de datos del backend — modelos SQLModel de las entidades de dominio (Usuario, Proveedor, Factura, FacturaItem, Pago), mixin base con UUID y timestamps, soft delete, enums de dominio, migración Alembic inicial y repositorios de acceso a datos (sin lógica de negocio).

### Modified Capabilities
<!-- Ninguna. project-foundation (C-01) ya está archivada y no cambian sus requisitos. -->

## Impact

- **Repositorio afectado**: `facturas-proveedores-api` (hermano del hub, en `C:/Users/pocho/Desktop/ProyectosPersonales/facturas-proveedores-api`).
- **Código nuevo**: `app/models/` (`base.py`, `usuario.py`, `proveedor.py`, `factura.py`, `pago.py`, `enums.py`), `app/repositories/` (`base_repository.py` y repositorios por entidad), una migración bajo `alembic/versions/`, y tests en `tests/`.
- **Dependencias**: reutiliza `app/core/uuid_utils.py` y el arnés de tests con testcontainers Postgres de C-01. No agrega dependencias nuevas más allá de las ya declaradas en C-01 (SQLModel, alembic).
- **Consumidores aguas abajo**: C-03 (auth-backend) y C-06 (proveedores-backend) construyen servicios y routers sobre estos modelos y repositorios. Este change no expone ningún endpoint HTTP.
- **Dependencia previa**: C-01 (aplicada y archivada). No hay bloqueos.
