## 1. Red de seguridad y línea de base

- [x] 1.1 Correr la suite completa del backend y registrar el baseline (`N passed`). Cualquier test que ya falle se reporta como fallo preexistente y NO se arregla en este change.
- [x] 1.2 Inventariar los tests de aislamiento existentes (los que hoy afirman "usuario A no ve el recurso de usuario B") y anotar cuáles pasarán a expresar "negocio A no ve el de negocio B". Esta lista es la que se audita en la tarea 8.2.

## 2. Modelos

- [x] 2.1 Test: `Negocio` se persiste con `nombre`, `id` UUIDv7, `created_at`/`updated_at` y sin `deleted_at`.
- [x] 2.2 Crear `app/models/negocio.py` con el modelo `Negocio` (tabla `negocio`).
- [x] 2.3 Test: `Usuario` sin `negocio_id` es rechazado por `NOT NULL`; `es_admin` y `desactivado` default `false`; sigue sin existir `deleted_at`.
- [x] 2.4 Agregar `negocio_id` (FK, not null), `es_admin` y `desactivado` a `app/models/usuario.py`. Actualizar el docstring: la nota "No soft delete (D-C02-2)" pasa a explicar que la baja se representa con `desactivado` (D-32).
- [x] 2.5 Test: `Proveedor`, `Factura` y `Pago` tienen `negocio_id` obligatorio y `creado_por_usuario_id` nullable, y ya no tienen `usuario_id`.
- [x] 2.6 Reemplazar `usuario_id` por `negocio_id` y agregar `creado_por_usuario_id` en `proveedor.py`, `factura.py` y `pago.py`.

## 3. Migración Alembic 0006

- [x] 3.1 Test de migración: sembrar dos usuarios con proveedores, facturas y pagos propios en la revisión `0005`; correr `upgrade head`; afirmar que toda fila quedó con `negocio_id` no nulo y que los dos conjuntos siguen disjuntos (ninguna fila cambió de dueño efectivo).
- [x] 3.2 Test de migración: N usuarios preexistentes producen N negocios, cada uno con `es_admin = true` y `desactivado = false`; el `nombre` del negocio sale de `nombre_negocio` y cae al nombre del usuario cuando es nulo o vacío.
- [x] 3.3 Test de migración: ciclo `upgrade` → `downgrade 0005` → `upgrade head` sin pérdida de filas en `usuario`, `proveedor`, `factura` ni `pago`.
- [x] 3.4 Test de migración: el esquema resultante no contiene ninguna columna `saldo` ni `estado`.
- [x] 3.5 Escribir `alembic/versions/20240006_0006_negocio_scoping.py` siguiendo los seis pasos de D5, en una sola revisión (`revision="0006"`, `down_revision="0005"`).
- [x] 3.6 Reemplazar en la misma revisión los índices compuestos que lideran con `usuario_id` por su equivalente con `negocio_id` (proveedor `(negocio_id, LOWER(nombre))`, factura `(negocio_id, proveedor_id, deleted_at, fecha_emision)`, pago `(negocio_id, proveedor_id, deleted_at, fecha)`).
- [x] 3.7 Verificar que los tests de migración preexistentes (`test_alembic_migration*.py`) siguen verdes; si alguno apunta a `head` en vez de a una revisión fija, corregirlo según D-21 en lugar de relajar la aserción.

## 4. Auth: registro con negocio y rechazo de desactivados

- [x] 4.1 Test: `POST /api/auth/registro` crea `Negocio` + `Usuario` con `es_admin = true`, y la respuesta no incluye `password_hash`.
- [x] 4.2 Test: registro con email duplicado no deja negocio huérfano ni usuario sin negocio (transacción atómica).
- [x] 4.3 Test: registro sin `nombre_negocio` deriva un nombre de negocio no vacío del nombre del usuario.
- [x] 4.4 Extender `usuario_service.registrar(...)` y el schema de registro para crear el negocio en la misma transacción.
- [x] 4.5 Test: un usuario con `desactivado = true` y token válido no expirado recibe 401 en una ruta protegida.
- [x] 4.6 Agregar el rechazo de `desactivado` en `get_current_user` (`app/core/deps.py`).
- [x] 4.7 Test: el access token emitido sigue conteniendo `sub`, `iat`, `exp`, `type` y NO contiene `negocio_id` (D1).

## 5. Repositories

- [x] 5.1 Test: cada repository filtra por `negocio_id` y devuelve vacío / `None` ante recursos de otro negocio.
- [x] 5.2 Migrar `proveedor_repository.py` (15 referencias), incluida `get_saldo_por_proveedor` y el listado con `GROUP BY`.
- [x] 5.3 Migrar `factura_repository.py` (8 referencias).
- [x] 5.4 Migrar `pago_repository.py` (6 referencias).
- [x] 5.5 Actualizar el docstring de `base_repository.py` que ejemplifica el filtro con `usuario_id`.

## 6. Services

- [x] 6.1 Test: `_get_owned*` levanta 404 ante recurso de otro negocio y devuelve el recurso ante uno del propio negocio creado por otro usuario del equipo.
- [x] 6.2 Migrar `proveedor_service.py` (30 referencias): renombrar el primer parámetro a `negocio_id` (D7), incluida `get_cuenta_corriente`.
- [x] 6.3 Migrar `factura_service.py` (31 referencias), preservando intacto el algoritmo FIFO y la invariante `Factura.negocio_id == Proveedor.negocio_id`.
- [x] 6.4 Migrar `pago_service.py` (26 referencias), preservando la prohibición de `factura_id` (RN-PAG-01).
- [x] 6.5 Migrar `actividad_service.py` (7 referencias): la actividad pasa a ser la del negocio (D8).
- [x] 6.6 Migrar `ia_extraccion_service.py` (12 referencias) en lo que sea pertenencia de recursos. NO tocar el cupo de `rate_limit_ia`, que sigue siendo por usuario (RN-IA-07, D8).
- [x] 6.7 Setear `creado_por_usuario_id` en los tres `crear(...)` (proveedor, factura, pago) con el id del usuario que llama.

## 7. Routers y schemas

- [x] 7.1 Test: el payload no puede fijar `negocio_id`; el recurso se persiste con el de la sesión.
- [x] 7.2 Migrar `routers/proveedores.py`, `facturas.py`, `pagos.py` y `actividad.py` para pasar `current_user.negocio_id` en lugar de `current_user.id`, y `current_user.id` donde corresponda la autoría.
- [x] 7.3 Actualizar `schemas/` (`proveedor.py`, `factura.py`, `pago.py`, `cuenta_corriente.py`): ningún schema de entrada acepta `usuario_id` ni `negocio_id`; los de respuesta exponen `negocio_id` solo si ya exponían `usuario_id`.
- [x] 7.4 Verificar que no cambió ningún contrato HTTP: mismas rutas, mismos códigos, mismos nombres de campo de negocio.

## 8. Aislamiento verificado y regresión estructural

- [x] 8.1 Test de aislamiento extremo a extremo: dos negocios con datos propios; para proveedores, facturas, pagos y cuenta corriente, cada operación cruzada (GET, PATCH, DELETE) responde 404 y no modifica nada.
- [x] 8.2 Test de equipo: dos usuarios del **mismo** negocio ven y operan exactamente el mismo conjunto de recursos, incluido el creado por el otro.
- [x] 8.3 Test de regresión estructural (patrón AST de D-22): recorrer `app/services/` y `app/repositories/` y fallar si `usuario_id` aparece como filtro de pertenencia fuera de la lista blanca de D8 (`usuario_service`, `usuario_repository`, `refresh_token*`, `rate_limit_ia`, `security`).
- [x] 8.4 Migrar los 32 archivos de test que referencian `usuario_id`. Regla: un test de aislamiento que falla es una fuga, no un test viejo — se reescribe para expresar dos negocios, nunca se debilita la aserción.
- [x] 8.5 Correr la suite completa y comparar contra el baseline de 1.1. Reportar cualquier aserción que haya tenido que debilitarse, con su justificación.

## 9. Documentación y cierre

- [x] 9.1 Corregir **RN-NEG-09** en `knowledge-base/05_reglas_de_negocio.md`: el `negocio_id` se resuelve desde el `Usuario` hidratado, no desde un claim del token (D1, con la evidencia de `deps.py:113-114`).
- [x] 9.2 Actualizar `CHANGES.md`: mover el registro con creación de negocio de C-29 a C-28 (D6) y ajustar el scope de ambos.
- [x] 9.3 Actualizar la regla dura #3 de `CLAUDE.md`: el eje ya es `negocio_id`, la nota de transición deja de aplicar.
- [x] 9.4 Actualizar `knowledge-base/04_modelo_de_datos.md` si la migración se apartó en algo del modelo documentado.
- [x] 9.5 Documentar en el reporte del apply que el deploy a producción requiere dump previo de la base (riesgo aceptado en design).
