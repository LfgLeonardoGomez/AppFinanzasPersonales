## 1. Red de seguridad

- [x] 1.1 Correr la suite del backend y registrar el baseline (esperado: 1038 passed). Un fallo previo se reporta como preexistente y NO se arregla acá.

## 2. Modelo y migración 0010

- [x] 2.1 Test: enum `FormaPago` tiene exactamente `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `CUENTA_CORRIENTE`, `OTRO`.
- [x] 2.2 Test: `Venta` se persiste con `negocio_id`, `cliente_id` nullable, `fecha` (date), `monto` numeric(12,2), `forma_pago`, `notas?`, `creado_por_usuario_id?` y `deleted_at`. **Sin** `origen` (D6) y sin columnas derivadas.
- [x] 2.3 Crear `app/models/venta.py`, sumar `FormaPago` a `app/models/enums.py`, registrar en `app/models/__init__.py`.
- [x] 2.4 Test de migración `0010`: crea la tabla, el **CHECK** de la invariante y los tres índices; `downgrade` limpio; ciclo upgrade→downgrade→upgrade. Revisión fijada (`revision="0010"`, `down_revision="0009"`), nunca `head` (D-21).
- [x] 2.5 Test de migración (el que importa, D1): **insertar directo** en la tabla un fiado sin cliente y una venta al contado con cliente — la base SHALL rechazar ambos. Es la mitad que la validación de aplicación no da.
- [x] 2.6 Escribir `alembic/versions/20240010_0010_venta.py`.

## 3. Repository

- [x] 3.1 Test: `listar` devuelve solo activas del negocio, ordenadas por `fecha DESC, created_at DESC, id DESC`.
- [x] 3.2 Test: filtros por rango de fechas (extremos **incluidos**), por `forma_pago` y por `cliente_id`.
- [x] 3.3 Test: los filtros combinan entre sí y no cruzan negocios.
- [x] 3.4 Test: `listar_fiadas_de_cliente` devuelve solo `CUENTA_CORRIENTE` activas de ese cliente — es lo que C-35 va a consumir.
- [x] 3.5 Implementar `app/repositories/venta_repository.py`.

## 4. Service

- [x] 4.1 Test: `crear` al contado persiste con `cliente_id` en null y la autoría de la sesión.
- [x] 4.2 Test: `crear` fiado exige cliente; sin cliente levanta un error **que explica** que un fiado necesita cliente.
- [x] 4.3 Test: `crear` al contado **con** cliente es rechazado (la otra dirección de la invariante).
- [x] 4.4 Test: cliente de otro negocio → 404.
- [x] 4.5 Test: `monto <= 0` y `fecha` futura (UTC-3) rechazados.
- [x] 4.6 Test (D2): `actualizar` valida el par **resultante** — cambiar `forma_pago` a EFECTIVO sin tocar `cliente_id` debe limpiar el cliente, no dejar una venta al contado con cliente colgado.
- [x] 4.7 Test (D2): pasar a `CUENTA_CORRIENTE` sin indicar cliente es rechazado.
- [x] 4.8 Test: editar solo el `monto` de una venta fiada la deja fiada, con el mismo cliente.
- [x] 4.9 Test: `eliminar` es soft delete; la venta fiada eliminada deja de figurar entre las activas de ese cliente.
- [x] 4.10 Test: venta de otro negocio → 404 en get, actualizar y eliminar.
- [x] 4.11 Implementar `app/services/venta_service.py`.

## 5. Schemas y router

- [x] 5.1 Test: `VentaCreate` no acepta `negocio_id`, `id` ni `creado_por_usuario_id`.
- [x] 5.2 Test de integración: alta al contado y alta fiada; el payload no puede fijar `negocio_id`.
- [x] 5.3 Test de integración: los cuatro rechazos de la invariante y de las validaciones dan códigos claros y distinguibles entre sí.
- [x] 5.4 Test de integración: filtros por fecha, forma de pago y cliente; `cliente_id` ajeno → 404.
- [x] 5.5 Test de integración: sin sesión → 401; `desactivado` → 401.
- [x] 5.6 Test de integración: `/api/ventas` y `/api/ventas/` responden igual, sin 307.
- [x] 5.7 Test: dos miembros del mismo negocio ven las ventas del otro.
- [x] 5.8 Implementar `app/schemas/venta.py` y `app/routers/ventas.py`; registrar el router en `app/main.py`.

## 6. Cierre

- [x] 6.1 Verificar que el guard de eje siga verde con los módulos nuevos. Si señala algo: **renombrar** si el nombre es ambiguo; ampliar la lista blanca **solo** si es identidad genuina, con el motivo escrito (criterio de C-29 vs C-31).
- [x] 6.2 Verificación por mutación de lo que este change promete: quitar el CHECK de la migración y quitar la validación del par en `actualizar`. **Cada mutación debe hacer caer al menos un test**, y hay que verificar con un `assert` que la mutación se aplicó antes de leer el resultado.
- [x] 6.3 Correr la suite completa y comparar contra el baseline de 1.1; reportar cualquier aserción debilitada.
- [x] 6.4 Probar el flujo real contra la app: cargar una venta al contado y una fiada, verificar los rechazos de la invariante, y que la fiada aparezca filtrando por `CUENTA_CORRIENTE`. Recordar que la base de dev puede estar atrás: correr `alembic upgrade head` en el contenedor antes.
- [x] 6.5 Actualizar `knowledge-base/04_modelo_de_datos.md` (§Venta) y `03_actores_y_roles.md` (rutas) si el resultado se apartó de lo documentado.
- [x] 6.6 Registrar en `09_decisiones_y_supuestos.md`: la invariante garantizada por CHECK y no solo por Pydantic, la validación del par resultante en PATCH, y por qué no hay endpoint de totales todavía.
- [x] 6.7 Marcar C-33 en `CHANGES.md` y anotar para C-34 que **borrar o despagar una venta fiada modifica el saldo del cliente** y necesita aviso en la UI.
