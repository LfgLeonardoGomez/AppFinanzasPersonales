## Why

Hoy el sistema asume un dueño único: cada recurso pertenece a un `usuario_id` y solo esa persona lo ve. Eso impide lo que un negocio real necesita — que el dueño y sus empleados trabajen sobre el mismo local desde dispositivos distintos, cada uno con su cuenta. La decisión D-27 reemplaza el eje de aislamiento por `negocio_id`.

Este change va **antes** de Clientes y Ventas a propósito: la migración toca hoy 4 tablas y después de la FASE 11 tocaría 8. Y sobre todo, convivir con dos ejes de aislamiento a la vez —unas tablas por `usuario_id`, otras por `negocio_id`— es exactamente el escenario en el que se filtran datos entre cuentas. Se hace de una sola vez o no se hace.

## What Changes

- **BREAKING (interno)**: `Proveedor`, `Factura` y `Pago` dejan de filtrarse por `usuario_id` y pasan a filtrarse por `negocio_id`. La firma de todos los métodos públicos de los services de negocio cambia su primer argumento.
- **BREAKING (respuestas HTTP)** — *corregido tras el apply; la redacción original decía "no cambia ningún contrato HTTP" y era demasiado amplia*: las **rutas, los payloads de entrada y los códigos de estado no cambian**, pero los **schemas de respuesta sí**: `usuario_id` desaparece de `ProveedorResponse`, `FacturaResponse` y `PagoResponse`, reemplazado por `negocio_id`. `UsuarioResponse` suma `negocio_id` y `es_admin` (aditivo).
  - **Impacto medido en el frontend**: `facturas-proveedores-web` referencia `usuario_id` en 44 archivos, pero **43 son fixtures de test**; el único uso de producción es `FacturaFormPage.tsx:55`, que lo copia a un objeto de display cuyo campo nunca se renderiza. Verificado: `tsc --noEmit` pasa hoy (los tipos generados desde OpenAPI todavía son los viejos) y en runtime el campo queda `undefined` sin efecto visible. **Es una rotura latente, no actual**: se materializa al correr `npm run generate-types`. Corregirlo pertenece al primer change de frontend de la etapa (C-30), no a este.
- Entidad nueva **`Negocio`** (id, nombre, timestamps).
- `Usuario` gana **`negocio_id`** (FK, not null), **`es_admin`** (bool) y **`desactivado`** (bool).
- Migración Alembic con **backfill**: un `Negocio` por cada `Usuario` existente, poblado de `usuario.nombre_negocio`; recién después se aplica el `NOT NULL`. Reversible.
- `Proveedor`, `Factura` y `Pago` ganan **`negocio_id`** denormalizado, backfilleado desde su `usuario_id` actual, y **`creado_por_usuario_id`** como autoría.
- **El registro público pasa a crear `Negocio` + `Usuario` en una sola transacción**, con `es_admin = true`. No es alcance opcional: con `negocio_id` NOT NULL, el registro actual dejaría de funcionar. Ver "Impact".
- **`get_current_user` rechaza usuarios con `desactivado = true`** (401). Sin esto la columna existe pero no significa nada.
- Aislamiento verificado: un recurso de otro negocio sigue devolviendo **404**, nunca 403 (D-06 intacto).

**Fuera de alcance, explícitamente** (van en C-29): invitaciones de un solo uso, registro de empleado, endpoints de equipo, desactivar/reactivar miembros y la guarda de último admin. Este change deja los **campos y el eje**; C-29 construye la gestión encima.

## Capabilities

### New Capabilities
- `negocio-scoping`: el `Negocio` como unidad de aislamiento; qué se filtra por `negocio_id`, cómo se resuelve el `negocio_id` del request, y la garantía de que ningún recurso cruza de un negocio a otro.

### Modified Capabilities
- `core-data-models`: entidad `Negocio` nueva; `Usuario` suma `negocio_id`/`es_admin`/`desactivado`; `Proveedor`/`Factura`/`Pago` suman `negocio_id` y `creado_por_usuario_id`. Las invariantes de pertenencia pasan a compararse por `negocio_id`.
- `auth-backend`: el registro crea el `Negocio` junto al `Usuario`; `get_current_user` rechaza usuarios desactivados.
- `proveedores-api`: el aislamiento del CRUD y del listado con saldo pasa a `negocio_id`.
- `facturas-api`: idem, incluido el cálculo de estado FIFO por proveedor.
- `pagos-backend`: idem.
- `cuenta-corriente-backend`: saldo, estado FIFO e historial se resuelven dentro del negocio.

## Impact

**Superficie medida**: 186 referencias a `usuario_id` en `app/` y 172 en `tests/` (32 archivos de test). El grueso se concentra en `services/` (`proveedor_service` 30, `factura_service` 31, `pago_service` 26, `ia_extraccion_service` 12, `actividad_service` 7) y `repositories/` (`proveedor_repository` 15, `factura_repository` 8, `pago_repository` 6).

**El patrón actual es uniforme y eso baja el riesgo**: los routers pasan `current_user.id` como primer argumento del service, los services validan pertenencia en `_get_owned(...)` y los repositories filtran por la columna. El cambio es sustituir qué identificador viaja por ese carril ya existente, no reescribir el carril.

**Lo que NO se toca — `usuario_id` sigue siendo correcto donde significa identidad, no pertenencia:**
- `RefreshToken.usuario_id` (sesión) y `usuario_repository` / `usuario_service` (auth y perfil).
- `security.py`: el `sub` del JWT sigue siendo el `usuario_id`.
- `rate_limit_ia`: el límite de IA es **por usuario** (RN-IA-07), no por negocio. Dos empleados no comparten cupo.

**Hallazgo de diseño que corrige RN-NEG-09**: la regla escrita en la KB dice que el token debe transportar `negocio_id` "para que el service layer no consulte la base en cada request". La premisa es falsa — `get_current_user` (`deps.py:113-114`) **ya hace un SELECT del `Usuario` en cada request** por diseño (D-C03-6). El `negocio_id` sale gratis de `usuario.negocio_id`. Meterlo en el token no ahorra nada y agrega un token stale cuando el usuario se desactiva. Se resuelve en `design.md` y se corrige RN-NEG-09 en la KB.

**Migración de datos**: hay datos reales en producción. El backfill debe ser idempotente y reversible, y el `NOT NULL` aplicarse recién después de poblar. Un `downgrade` que pierda datos es inaceptable.

**Governance: CRITICO.** Toca autenticación y el aislamiento multi-tenant. Un error acá no rompe una pantalla: expone las facturas de un negocio a otro.
