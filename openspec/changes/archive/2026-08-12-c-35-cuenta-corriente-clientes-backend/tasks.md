> **El TDD estricto está activo.** Toda task de abajo que nombra un comportamiento arranca en RED: escribir el test que falla, hacerlo pasar con lo mínimo, triangular con un segundo caso, y después refactorizar. Comando de test: `cd facturas-proveedores-api && .venv/Scripts/python.exe -m pytest`. Los tests corren contra Postgres real en un contenedor — nunca SQLite. Cloudinary y el modelo de visión quedan mockeados.
>
> **Gobernanza ALTO.** El grupo 2 refactoriza un motor de proveedores que corre en producción hace meses. No arrancarlo antes de que el humano haya aprobado D1.

## 1. Red de seguridad

- [x] 1.1 Correr el suite completo de backend y registrar en este archivo la baseline **medida** — la línea exacta `N passed`, copiada de la corrida, no de memoria ni del número de un change anterior. Este es el número contra el que se compara cada grupo posterior. Cualquier test que falle acá es **preexistente**: reportarlo y NO arreglarlo en este change.

  **Baseline medida: `1086 passed, 2 warnings in 695.55s (0:11:35)`.** Ningún test preexistente falló.
- [x] 1.2 Registrar qué archivos va a tocar el grupo 2 y correr sus tests puntualmente, para que la extracción tenga un antes/después acotado además de uno global: `tests/test_fifo_algorithm.py`, `tests/test_cuenta_corriente_historial_helper.py`, `tests/test_cuenta_corriente_service.py`. Anotar la cantidad de cada uno.

  **Conteo medido**: `test_fifo_algorithm.py` = 10, `test_cuenta_corriente_historial_helper.py` = 16, `test_cuenta_corriente_service.py` = 17 (43 en total).

## 2. Motor de asignación compartido (D1) — extraer, y después probar que nada se movió

> Ordenado a propósito: el motor se escribe y el lado de proveedores se re-apunta y se verifica **antes** de que exista código de clientes. Si la extracción rompió algo, tiene que ser visible mientras el diff todavía no contiene nada más.

- [x] 2.1 Test: `asignar_fifo` asigna un pool sobre cargos en el orden dado — cargo completo, parcial y sin tocar en una sola pasada. Función pura, sin DB.
- [x] 2.2 Test (triangular): límites — pool exactamente igual a un cargo, pool en cero, lista de cargos vacía, pool más grande que todos los cargos (sobrante reportado, no tragado).
- [x] 2.3 Test: `asignar_fifo` devuelve **montos** asignados y no referencia ningún enum de dominio — el libro de clientes tiene que poder llamarlo sin importar `EstadoFactura` (D2).
- [x] 2.4 Test: `construir_historial` mezcla cargos y créditos en orden `(fecha ASC, created_at ASC, id ASC)` con un total corriente con signo, tomando las etiquetas de `tipo` como argumentos.
- [x] 2.5 Test (triangular): las filas de la misma fecha se desempatan por `created_at` y después por `id`; quien llama pasando cualquiera de las dos listas en el orden equivocado obtiene igual el mismo resultado.
- [x] 2.6 Escribir `app/services/cuenta_corriente_engine.py` — `Movimiento`, `asignar_fifo`, `construir_historial`. Sin acceso a DB, sin efectos secundarios, sin enums de dominio.
- [x] 2.7 Re-apuntar `factura_service._compute_estado_fifo` para adaptar filas de `Factura` a `Movimiento`, llamar a `asignar_fifo`, y mapear los montos asignados a `EstadoFactura`. **Firma, nombre y tipo de retorno sin cambios.**
- [x] 2.8 Re-apuntar `proveedor_service._build_historial` para llamar a `construir_historial` con `tipo_cargo="FACTURA"`, `tipo_abono="PAGO"`, pasando `archivo_url` / `comprobante_url` igual que hoy. **Firma, nombre y tipo de retorno sin cambios.**
- [x] 2.9 **Gate de verificación.** Correr `tests/test_fifo_algorithm.py`, `tests/test_cuenta_corriente_historial_helper.py` y `tests/test_cuenta_corriente_service.py` **sin editar ni uno solo de ellos**, y confirmar los conteos de 1.2. Después correr el suite completo y comparar contra 1.1. Si alguno de esos tests necesitó una edición para pasar, la extracción cambió comportamiento — parar y reportar, no ajustar el test.

  **Resultado**: los tres archivos corrieron sin editar y dieron 43 passed (10+16+17), igual que 1.2. El suite completo dio 1086 passed — igual que la baseline de 1.1. La extracción no cambió comportamiento observable.

## 3. Enums

- [x] 3.1 Test: `MetodoCobro` tiene exactamente `EFECTIVO`, `TRANSFERENCIA`, `TARJETA`, `OTRO` — sin `MERCADOPAGO`, sin `CUENTA_CORRIENTE` (la deuda no se cancela con deuda).
- [x] 3.2 Test: `EstadoVentaFiada` tiene exactamente `PENDIENTE`, `PARCIAL`, `COBRADA`, y es un enum solo de Python — sin tipo de Postgres y sin columna en ningún lado (D-01).
- [x] 3.3 Agregar ambos a `app/models/enums.py` y exportarlos.

## 4. Modelo y migración 0011

- [x] 4.1 Test: `CobroCliente` persiste con `negocio_id`, `cliente_id` (**requerido**), `monto` numeric(12,2), `fecha` (date), `metodo`, `comprobante_url?`, `creado_por_usuario_id?` y `deleted_at`.
- [x] 4.2 Test (el que fija RN-CCC-03): el modelo y la tabla **no** tienen `venta_id` ni FK a `venta`, ni columna `saldo` / `estado`.
- [x] 4.3 Escribir `app/models/cobro_cliente.py`; registrarlo en `app/models/__init__.py`.
- [x] 4.4 Test para la migración `0011`: crea la tabla, el tipo `metodocobro` y los tres índices (`negocio_id`; `(negocio_id, cliente_id, deleted_at)`; `(negocio_id, fecha)`); `downgrade` tira tabla, índices **y** tipo; el ciclo completo upgrade → downgrade → upgrade funciona. Revisiones pasadas como literales explícitos `"0011"` / `"0010"`, nunca `head` ni `-1` (D-21).
- [x] 4.5 Escribir `alembic/versions/20240011_0011_cobro_cliente.py` con `revision = "0011"`, `down_revision = "0010"`. Crear el enum **una sola vez** — `sa.Enum(...).create(op.get_bind(), checkfirst=True)`, y después `postgresql.ENUM(..., name="metodocobro", create_type=False)` en `create_table`. Un `sa.Enum` a secas en la columna haría `CREATE TYPE` una segunda vez sin `checkfirst` y rompería toda migración que corra después, con la falla apareciendo en un archivo de test sin relación (D-56).
- [x] 4.6 Correr el módulo completo de tests de migración para confirmar que la cadena desde `0001` sigue aplicando de punta a punta — el modo de falla de D-56 es invisible en el test de la propia migración nueva.

  **Resultado**: `tests/test_alembic_migration_0011.py` — 10 passed, incluyendo el ciclo upgrade → downgrade → upgrade y la limpieza del tipo `metodocobro`.

## 5. Repositorio

- [x] 5.1 Test: `listar_de_cliente` devuelve solo los pagos vivos de ese cliente, ordenados `(fecha ASC, created_at ASC, id ASC)`.
- [x] 5.2 Test: los pagos con soft-delete quedan excluidos, y los pagos de otro negocio nunca aparecen.
- [x] 5.3 Test: `sumar_cobros_de_cliente` (o el agregado que alimenta el pool) suma solo pagos vivos, y devuelve `0.00` — no `None` — para un cliente sin ninguno.
- [x] 5.4 Test: el `listar` paginado del negocio ordena del más nuevo primero y respeta el filtro opcional por `cliente_id`.
- [x] 5.5 Escribir `app/repositories/cobro_cliente_repository.py`. Puro acceso a datos — sin autorización, sin reglas de negocio.

## 6. Servicio — CRUD de pagos y la regla de no-saldo-negativo

- [x] 6.1 Test: `crear` persiste con el `negocio_id` y la autoría de la sesión; un `cliente_id` de otro negocio → 404.
- [x] 6.2 Test: `monto <= 0` y una `fecha` posterior a hoy en `America/Argentina/Buenos_Aires` se rechazan en el servicio, no solo por Pydantic.
- [x] 6.3 Test (RN-CCC-04, la regla principal): un cliente que debe $1.000 acepta un pago de $1.000 y rechaza uno de $1.500. El mensaje de rechazo dice el saldo pendiente, en español, para que el monto se pueda corregir en vez de adivinar.
- [x] 6.4 Test (triangular): un pago para un cliente **sin** fiados vivos se rechaza; un segundo pago que excedería lo que queda del saldo se rechaza aunque el primero haya estado bien.
- [x] 6.5 Test (D3, la cláusula que hace posible editar): con $1.000 cargados y un pago de $400, editar ese pago a $600 es **aceptado** — el saldo disponible excluye la fila que se está editando. Editarlo a $1.200 se rechaza y el monto guardado no cambia.
- [x] 6.6 Test (D8): una edición parcial que intenta cambiar `cliente_id` se rechaza; cualquier otro campo se actualiza normalmente.
- [x] 6.7 Test: `eliminar` es un soft delete, y el pago eliminado deja de contar de inmediato para el saldo, el pool y el historial.
- [x] 6.8 Test: un pago de otro negocio → 404 en get, update y delete — nunca 403 (D-06).
- [x] 6.9 Escribir `app/services/cobro_cliente_service.py`. Toda la autorización acá, acotada por `negocio_id`. Nunca `usuario_id` como filtro; `creado_por_usuario_id` es solo autoría.

## 7. La lectura de la cuenta corriente

- [x] 7.1 Test (RN-CCC-01, datos mixtos): un cliente con fiados vivos, un fiado eliminado, pagos vivos y un pago eliminado reporta el saldo solo sobre las filas vivas. Las ventas al contado no aparecen.
- [x] 7.2 Test: un cliente sin movimientos reporta `0.00` con dos listas vacías.
- [x] 7.3 Test (RN-CCC-02, FIFO determinístico): $500 + $500 + $500 en orden cronológico contra un pool de $700 → `COBRADA`, `PARCIAL`, `PENDIENTE`.
- [x] 7.4 Test (triangular, RN-FIFO-01): dos fiados que comparten `fecha` se desempatan por `created_at` y después por `id`, de forma idéntica en lecturas repetidas.
- [x] 7.5 Test (RN-FIFO-02): un pago de marzo salda un fiado de enero — la asignación es por monto del pool, no por fecha.
- [x] 7.6 Test (RN-FIFO-03): un pago nuevo que cubre los primeros dos de tres fiados cambia los dos estados en una sola lectura, sin nada guardado.
- [x] 7.7 Test (RN-CCC-05, historial corriente): fiado $1.000 → pago $400 → fiado $500 da `saldo_acumulado` de `1000.00`, `600.00`, `1100.00`; `monto` siempre es positivo y el signo vive en `tipo` (`VENTA` / `COBRO`).
- [x] 7.8 Test: el `comprobante_url` de un pago es alcanzable como `archivo_url` en su fila de historial; una fila `VENTA` reporta `null` en ese mismo campo plano.
- [x] 7.9 Test (D4, el número honesto): el único fiado de $1.000 de un cliente se paga entero y después se elimina con soft-delete → el saldo reportado es `-1000.00`, no recortado a `0.00`.
- [x] 7.10 Test (aislamiento): la cuenta corriente de un cliente de otro negocio → 404, y un cliente con el mismo nombre en otro negocio nunca aporta una sola fila.
- [x] 7.11 Implementar la composición en `app/services/cliente_service.py` (o un servicio dedicado, siguiendo el precedente de C-12): chequeo de dueño → saldo → fiados vivos vía `VentaRepository.listar_fiadas_de_cliente` → pool → `asignar_fifo` → mapear a `EstadoVentaFiada` → `construir_historial(..., "VENTA", "COBRO")`. Solo lectura: sin `session.commit()`.

## 8. Schemas y routers

- [x] 8.1 Test: `CobroClienteCreate` rechaza `negocio_id`, `id` y `creado_por_usuario_id`; `CobroClienteUpdate` rechaza `cliente_id` (D8).
- [x] 8.2 Test de integración: crear, leer, listar, editar y eliminar un pago a través de `/api/cobros`; el payload no puede fijar el dueño.
- [x] 8.3 Test de integración: el rechazo de RN-CCC-04 devuelve 422 con un mensaje sobre el que se puede actuar, distinguible de los rechazos por monto y por fecha.
- [x] 8.4 Test de integración: `GET /api/clientes/{cliente_id}/cuenta-corriente` devuelve los cuatro campos; un cliente de otro negocio → 404 (D7 — replica la ruta de proveedores; `CHANGES.md` describe una URL distinta, ver el reporte).
- [x] 8.5 Test de integración: sin sesión → 401; un usuario desactivado → 401.
- [x] 8.6 Test de integración: `/api/cobros` y `/api/cobros/` responden las dos sin un 307 (C-27).
- [x] 8.7 Test de integración: dos miembros del mismo negocio ven los pagos del otro.
- [x] 8.8 Escribir `app/schemas/cobro_cliente.py` y `app/schemas/cuenta_corriente_cliente.py`, el router `app/routers/cobros.py`, la ruta de cuenta corriente en `app/routers/clientes.py` (declarada al lado de `/buscar`, antes de `/{cliente_id}`), y registrar el router nuevo en `app/main.py`.

## 9. Saldo en el listado de clientes (D6 — extensión de alcance, independientemente removible)

> Este grupo extiende el alcance escrito en `CHANGES.md`, que lo ubica en C-36. Está aislado acá a propósito: sacarlo elimina este grupo y nada más. No arrancarlo sin la aprobación señalada en design.md D6.

- [x] 9.1 Test: el listado reporta el saldo de cada cliente, `0.00` para uno sin movimientos.
- [x] 9.2 Test: con varios clientes y movimientos, los saldos se obtienen con **una sola** query agregada — verificar el conteo de queries, no solo los valores.
- [x] 9.3 Test: dos negocios con clientes de mismo nombre nunca se ven los movimientos del otro en el saldo.
- [x] 9.4 Implementar `ClienteRepository.get_saldo_por_cliente`, replicando `ProveedorRepository.get_saldo_por_proveedor` (subqueries pre-agregadas — sin fan-out de joins, sin N+1), y exponer `saldo` en el schema del listado.

## 10. Verificación por mutación

> Disciplina aprendida a las malas en C-31: una mutación que en silencio no llegó a aplicarse fue reportada como "el test la agarró". Cada mutación de abajo **verifica que el texto original está presente en el archivo antes de escribir el reemplazo**, y verifica que el reemplazo está presente después. Una mutación que no se aplicó es un chequeo fallido, no uno aprobado.

- [x] 10.1 Mutación — RN-CCC-04. Verificar que la guarda de saldo está presente en `app/services/cobro_cliente_service.py`, sacarla, confirmar que al menos un test de 6.3/6.4/6.5 falla, restaurar.

  **Aplicó**: sí, verificado en disco antes y después. **Cayeron**: los 14 tests de `test_cobro_cliente_service.py` (returncode=1). **CAPTURADA.**
- [x] 10.2 Mutación — la cláusula de exclusión de D3. Verificar que el término "excluir la fila que se está editando" está presente, sacarlo para que la edición se compare contra el saldo completo, confirmar que 6.5 falla, restaurar.

  **Aplicó**: sí. **Primer intento (con el valor original de 6.5, subir de $400 a $600) NO fue capturado** — $600 coincide justo con el límite que produce el mismo resultado con o sin exclusión ($1.000 fiado − $400 propio = $600 disponible sin exclusión, y $600 ≤ $600 sigue aceptándose). Se corrigió el test para subir a $900 en cambio (por encima de ese límite accidental), y con esa corrección la mutación **SÍ fue capturada** — `test_cobro_cliente_service.py` completo falla (returncode=1). Ver la nota en el test mismo.
- [x] 10.3 Mutación — determinismo FIFO. Verificar que el orden `(fecha, created_at, id)` está presente en `VentaRepository.listar_fiadas_de_cliente`, invertirlo, confirmar que 7.3/7.4 fallan, restaurar.

  **Aplicó**: sí. **Cayeron**: `test_c35_cuenta_corriente_cliente_service.py` completo (returncode=1). **CAPTURADA.**
- [x] 10.4 Mutación — el motor compartido es genuinamente compartido. Verificar que `factura_service._compute_estado_fifo` delega en `asignar_fifo`, romper la asignación del motor (`min` → el monto del cargo), confirmar que un test de proveedores Y uno de clientes fallan. Si solo cae uno de los dos lados, la extracción no está realmente compartida. Restaurar.

  **Aplicó**: sí. Se corrieron **por separado** para que cada lado sea visible de forma independiente: `tests/test_fifo_algorithm.py` → returncode=1 (falló). `tests/test_c35_cuenta_corriente_cliente_service.py` → returncode=1 (falló). **CAPTURADA EN AMBOS LADOS** — D1 está genuinamente logrado: una sola implementación, y romperla rompe a los dos libros.
- [x] 10.5 Mutación — aislamiento por negocio. Verificar que el filtro `negocio_id` está presente en `CobroClienteRepository`, sacarlo, confirmar que los tests de aislamiento de 5.2/6.8/7.10 fallan, restaurar.

  **Aplicó**: sí, pero el primer intento apuntó al filtro `negocio_id` de `listar_de_cliente` y **NO fue capturado**. Hallazgo real, no un test flojo: en `listar_de_cliente(negocio_id, cliente_id)`, `cliente_id` ya identifica un único negocio vía su FK, así que ese filtro de `negocio_id` ahí es estructuralmente redundante — el verdadero gate de autorización para ese camino es el chequeo `_get_owned_cliente` / `_get_owned_cobro` en el service layer, que corre ANTES y ya usa `negocio_id` correctamente. Se agregó un test nuevo (`test_listar_sin_filtro_de_cliente_no_mezcla_otro_negocio`) apuntando al `negocio_id` de `CobroClienteRepository.listar()` — el listado general SIN filtro de `cliente_id`, donde `negocio_id` es el ÚNICO filtro de alcance y sí es una fuga observable si falta. Con ese blanco correcto, la mutación (sacar `CobroCliente.negocio_id == negocio_id` de `base_filters`) **SÍ fue capturada** — `test_cobro_cliente_repository.py` completo falla (returncode=1).
- [x] 10.6 Mutación — el procedimiento de enum de D-56. Verificar que `create_type=False` está presente en la migración `0011`, reemplazar la columna con un `sa.Enum` a secas, confirmar que el test de la cadena de migración de 4.6 falla, restaurar.

  **Aplicó**: sí. **Cayó**: `test_alembic_migration_0011.py` completo (returncode=1). **CAPTURADA.**

## 11. Cierre

- [x] 11.1 Correr el axis guard (`tests/test_c28_scoping_axis_guard.py`) contra los módulos nuevos. Si señala algo: **renombrar** cuando el nombre sea ambiguo; extender la whitelist **solo** para identidad genuina, con la razón escrita en el test (el criterio C-29 vs C-31).

  **Resultado**: 38 passed, nada señalado. Ningún módulo nuevo usa `usuario_id` como filtro de alcance; no hizo falta tocar la whitelist.
- [x] 11.2 Correr el suite completo y comparar contra la baseline de 1.1. Reportar el total nuevo, cualquier test que haya tenido que debilitarse, y cualquier falla preexistente arrastrada de 1.1.

  **Resultado**: `1166 passed, 0 failed` (de una baseline de 1086 — 80 tests nuevos, todos en verde). Ningún test se debilitó para pasar; los dos ajustes de la task 10 (6.5 y el nuevo test de `listar()`) fortalecieron la cobertura, no la relajaron. Ninguna falla preexistente.
- [x] 11.3 Ejercitar el flujo real contra la app corriendo: registrar un fiado, cobrar parte, ver el estado pasar a `PARCIAL`, intentar cobrar más que el saldo y leer el mensaje, y después revisar los totales del historial. Correr `alembic upgrade head` en el contenedor primero — la base de dev puede estar atrasada.

  **Resultado**: ejecutado end-to-end contra `http://localhost:8000` tras `alembic upgrade head` (0010→0011) y `docker compose restart api`. Cliente creado (201), fiado de $1.000 (201), cobro parcial de $300 (201) → `estado: PARCIAL`, `saldo: 700.00`. Cobro de $800 (> disponible) → **422**, `{"detail":"El pago supera el saldo pendiente del cliente. Saldo disponible: 700.00."}`. Cobro de $700 (exacto al disponible) → 201, `estado: COBRADA`, `saldo: 0.00`. Historial con `saldo_acumulado` 1000.00 → 700.00 → 0.00. Sin sesión → 401.
- [x] 11.4 Reportar al orquestador, para la KB y `CHANGES.md` (que este change no edita): la forma de endpoint efectivamente entregada (D7), si D6 se entregó, que `saldo` tiene signo y es alcanzable en un valor negativo (D4), y la pregunta abierta sobre si `VentaService` debería rechazar una edición que rompe RN-CCC-04.

  Reportado en la respuesta final de esta sesión de apply.
- [x] 11.5 Nota para C-36: el saldo puede ser negativo; la acción de "registrar pago" tiene que limitar al saldo pendiente en la UI **y** confiar en el rechazo del backend; eliminar un fiado o sacarlo de `CUENTA_CORRIENTE` cambia la cuenta del cliente y necesita una advertencia visible.
