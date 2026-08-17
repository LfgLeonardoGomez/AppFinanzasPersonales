> **TDD estricto activo.** Toda task que nombra un comportamiento arranca en RED: escribir el test que falla, hacerlo pasar con lo mínimo, triangular con un segundo caso de entradas distintas, y recién ahí refactorizar. Los tests corren contra **Postgres real en contenedor**, nunca SQLite (Regla Dura #12); Cloudinary y el modelo de visión quedan mockeados.
>
> Comando de test backend: `cd facturas-proveedores-api && .venv/Scripts/python.exe -m pytest`
> Comando de test frontend: `cd facturas-proveedores-web && npm test`
>
> **Gobernanza ALTO.** No arrancar el grupo 2 antes de que un humano haya aprobado `design.md`. La migración toca las tres tablas que registran la plata del negocio.
>
> **NO correr `npm run generate-types`.** `src/shared/api/api.d.ts` está escrito a mano; regenerarlo rompe 262 imports (C-41). En este change no hace falta tocarlo: la clave no se expone en ninguna respuesta.
>
> ---
>
> ## El límite entre fases es duro
>
> **Fase A (grupos 1-9) es backend puro.** No toca **un solo archivo** de `facturas-proveedores-web`. Se verifica con la suite de backend sola, se deploya sola y se revierte sola. Es lo que se implementa **ahora**, en un worktree aislado, en paralelo con C-36.
>
> **Fase B (grupos 10-13) está BLOQUEADA.** Dos condiciones, las dos necesarias:
> 1. Fase A tiene que estar deployada (el orden backend → frontend es seguro y el inverso no).
> 2. El tramo de **cobros** (grupo 12) depende de que **C-36 (`c-36-cuenta-corriente-clientes-frontend`) haya archivado**, porque es C-36 quien crea el formulario de cobro. **Hoy ese formulario no existe** — `src/features/cuenta-corriente/` es la cuenta corriente de **proveedores** (C-13), no la de clientes.
>
> No arrancar ninguna task de Fase B durante la implementación de Fase A. Si al llegar a Fase B C-36 todavía no archivó, hacer los grupos 10, 11 y 13 y dejar el 12 abierto.
>
> **El change no se archiva con Fase B pendiente.** Fase A sola es infraestructura sin usuario: los tres endpoints desduplican pero ningún formulario manda la clave, así que para la persona no cambió nada.

---

# FASE A — Backend (`facturas-proveedores-api`)

Ejecutable ya. Cero archivos de frontend. Cero dependencia de C-36.

## 1. Red de seguridad

- [x] 1.1 Correr el suite completo de backend y anotar acá la línea `N passed` **copiada de la corrida**, no de memoria ni del número de un change anterior. Cualquier fallo es **preexistente**: reportarlo y NO arreglarlo en este change.
      **Medido:** `1241 passed, 2 warnings in 767.84s (0:12:47)` — corrido sobre el árbol principal, cuyo backend está intacto (C-36 fue frontend puro), así que equivale al estado pre-C-43. Cero fallos preexistentes.
- [x] 1.2 Anotar el conteo puntual de los arneses directos de los tres endpoints que se modifican (`tests/` de pagos, de facturas y de cobros). Tienen que seguir en verde **sin editarse**, porque todos postean **sin** header y prueban que el comportamiento sin clave no cambió.
      **Medido:** `242 passed` sobre los 12 archivos (`test_pago_*`, `test_factura_*`, `test_cobro_cliente_*`). `git status` confirma que **ninguno fue editado** por este change.
- [x] 1.3 Anotar el conteo de `tests/test_c28_scoping_axis_guard.py`. Es paramétrico sobre los archivos de `services/` y `repositories/`: este change **no agrega archivos** a esos directorios, así que el conteo no debería moverse. Si se mueve, es una señal, no ruido.
      **Medido:** `40 passed` en el árbol principal.

## 2. Migración 0013 y modelos

- [x] 2.1 Test de migración `0013` con revisiones fijas (`revision="0013"`, `down_revision="0012"`), nunca `head` ni `-1` (D-21): agrega `idempotency_key` (uuid, nullable) a `pago`, `factura` y `cobro_cliente`, y los tres índices únicos parciales `uq_<tabla>_negocio_idempotency_key` sobre `(negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. `downgrade` limpio y ciclo upgrade → downgrade → upgrade.
- [x] 2.2 **Test que importa (design.md D5):** insertar **directo en cada tabla**, sin pasar por la aplicación, dos filas del mismo negocio con la misma `idempotency_key` — la base SHALL rechazar la segunda. Es la mitad que ninguna validación de aplicación puede dar. Un caso por tabla, las tres.
- [x] 2.3 Test (triangulación): insertar directo varias filas del mismo negocio con `idempotency_key` **nula** — la base SHALL aceptarlas todas. Y la misma clave en **dos negocios distintos** SHALL ser aceptada. Las tres tablas.
- [x] 2.4 Test: ningún índice excluye filas con soft delete — una fila borrada sigue reteniendo su clave. Verificable por mutación: agregar `AND deleted_at IS NULL` a cualquiera de los tres predicados hace fallar el test de repetición-sobre-borrado del grupo correspondiente (4.6 / 6.7 / 8.7).
- [x] 2.5 Test: `factura_item` **no** gana columna de clave. La operación que se desduplica es "registrar una factura con su detalle", una intención, no una por línea.
- [x] 2.6 Escribir `alembic/versions/20240013_0013_idempotency_pago_factura_cobro.py`. Documentar en el docstring por qué los predicados son solo `IS NOT NULL` y no incluyen `deleted_at`, y por qué es una sola revisión y no tres (design.md D5).
- [x] 2.7 Test: `Pago`, `Factura` y `CobroCliente` persisten `idempotency_key` y **siguen sin** columnas de saldo ni estado (D-01), `pago` sigue sin `factura_id` (RN-PAG-01) y `cobro_cliente` sigue sin `venta_id` (RN-CCC-03).
- [x] 2.8 Sumar el campo a los tres modelos con el comentario de por qué es nullable y por qué no participa de ningún cálculo (FIFO ni saldo).

## 3. `app/services/idempotencia.py`

- [x] 3.1 Test: `es_violacion_de(err, "uq_x")` devuelve `True` cuando la constraint violada es esa, y `False` cuando es otra o cuando no se puede determinar el nombre.
- [x] 3.2 Test (triangulación): el predicado nunca lanza — un `IntegrityError` sin `orig`, sin `diag`, o sin `constraint_name` devuelve `False` en vez de explotar.
- [x] 3.3 Implementar `es_violacion_de` sobre el `nombre_constraint_violada` que ya existe. Es azúcar, no arquitectura (design.md D1): existe para que la comparación no se escriba invertida por accidente en ninguno de los cuatro services.

## 4. `PagoService.crear` con clave de idempotencia

- [x] 4.1 Test: `crear` sin clave se comporta **exactamente** como hoy — se persiste, `idempotency_key` queda en `None`, y dos llamadas iguales sin clave producen **dos** pagos. Un `IntegrityError` sin clave sigue propagándose sin tocar.
- [x] 4.2 Test: `crear` con una clave nueva persiste el pago con esa clave y lo reporta como **creado** (no como repetición).
- [x] 4.3 Test: `crear` con una clave ya usada y **los mismos datos** devuelve el pago original —mismo `id`— marcado como repetición, y en la base sigue habiendo **uno solo** con esa clave. Triangular repitiendo cinco veces: sigue habiendo uno.
- [x] 4.4 Test: `crear` con una clave ya usada y **monto distinto** levanta `409` con el pago existente en el `detail`, y el pago guardado conserva su monto. Triangular con `fecha`, `metodo` y `proveedor_id` distintos.
- [x] 4.5 Test: la comparación usa `origen` **resuelto**, no el crudo — repetir un payload que omite `origen` contra un pago guardado con `origen = MANUAL` SHALL ser una repetición, no un conflicto. Es el borde que rompe si se compara `datos.origen` directo.
- [x] 4.6 Test: un pago creado con clave y luego eliminado, reintentado con la misma clave, levanta `409` y **no** aparece un segundo pago en el listado.
- [x] 4.7 Test: la misma clave usada por **dos negocios distintos** crea un pago en cada uno, y el listado de cada negocio muestra solo el suyo (Regla Dura #3). Verificable por mutación: al quitar el filtro por `negocio_id` de la lectura por clave, este test falla mostrando el pago ajeno.
- [x] 4.8 Test: las validaciones de negocio corren **antes** de tocar la idempotencia — un `proveedor_id` de otro negocio con clave nueva sigue dando `404`, no persiste nada, y esa clave sigue disponible para un envío corregido.
- [x] 4.9 Test de carrera (Postgres real, dos sesiones, dos hilos): dos `crear` con la misma clave desde conexiones distintas producen **un** pago; el segundo recibe el original. Sin `SELECT` previo — el test debe fallar si se reemplaza el `INSERT` + captura por un "consultar y después insertar".
- [x] 4.10 Test: tras la violación de unicidad la sesión queda **usable** — la relectura posterior funciona porque hubo `rollback()` antes. Verificable por mutación: al quitar el `rollback()`, el test falla con `PendingRollbackError`.
- [x] 4.11 Test: un `IntegrityError` por una constraint **distinta** de la de idempotencia se propaga y no se responde como repetición.
- [x] 4.12 Implementar en `app/services/pago_service.py` siguiendo el patrón de `venta_service`: validar → `INSERT` → capturar `IntegrityError` → `es_violacion_de` → `rollback()` → relectura por `(negocio_id, idempotency_key)` → decidir repetición/conflicto. El repository suma la lectura por clave, siempre scopeada, **sin** filtrar `deleted_at`. El wrapper resultado + `es_repeticion` va en el service, no en el router (Reglas Duras #3 y #8).

## 5. Router de pagos

- [x] 5.1 Test: `PagoResponse` **no** expone `idempotency_key`. Es transporte, no dominio.
- [x] 5.2 Test: `POST /api/pagos` con `Idempotency-Key` malformada (no UUID) responde `422` y no persiste nada.
- [x] 5.3 Test end-to-end: primer POST con clave → `201` **sin** header `Idempotent-Replay`; segundo POST idéntico → `200` **con** `Idempotent-Replay: true` y el mismo `id` en el cuerpo, y `proveedor_nombre` resuelto igual que en la creación.
- [x] 5.4 Test end-to-end del daño que motiva el change: dos POST del mismo pago con la misma clave dejan el `estado` FIFO de las facturas de ese proveedor **igual** que si el pago se hubiera registrado una sola vez.
- [x] 5.5 Test: el POST sin sesión sigue dando `401` antes de mirar el header, y un usuario desactivado sigue rechazado (los requirements existentes de `pagos-backend` no se relajan).
- [x] 5.6 Implementar en `app/routers/pagos.py`: leer el header con `Header(None)` tipado `Optional[uuid.UUID]`, pasarlo al service, e inyectar `Response` para bajar el status a `200` y setear `Idempotent-Replay` en la rama de réplica. **Ninguna lógica de decisión en el router.**

## 6. `FacturaService.crear` con clave de idempotencia

- [x] 6.1 Test: `crear` sin clave se comporta **exactamente** como hoy, incluidos `items_sum_mismatch` y el `estado` FIFO calculado.
- [x] 6.2 Test: `crear` con una clave nueva persiste la factura con esa clave y la reporta como **creada**.
- [x] 6.3 Test: `crear` con una clave ya usada y **los mismos datos e items** devuelve la factura original —mismo `id`— marcada como repetición, y hay **una sola** factura con esa clave. Triangular repitiendo cinco veces.
- [x] 6.4 Test: la repetición **no duplica los items** — una factura de tres items repetida sigue teniendo tres, no seis. Es el test que atrapa la implementación ingenua que re-corre `create_with_items` en la rama de réplica.
- [x] 6.5 Test: la comparación **incluye los items** — misma clave, mismo `monto_total`, pero un item con descripción o precio distinto SHALL ser `409`, y la factura guardada conserva sus items originales. Triangular con un item **agregado** y con los mismos items en **otro orden**.
- [x] 6.6 Test: `items_sum_mismatch` **no** participa de la comparación — es salida derivada, no entrada.
- [x] 6.7 Test: una factura creada con clave y luego eliminada, reintentada con la misma clave, levanta `409`.
- [x] 6.8 Test: la misma clave en **dos negocios distintos** crea una factura en cada uno, sin cruce (Regla Dura #3).
- [x] 6.9 Test: las validaciones corren antes de la idempotencia — proveedor ajeno con clave nueva da `404`, **no persiste ni la factura ni ningún item**, y la clave queda libre.
- [x] 6.10 **Test del riesgo de design.md D4:** crear una factura con clave (queda `PENDIENTE`), registrar después un pago al mismo proveedor, y recién entonces repetir el POST con la misma clave → la respuesta lleva el `estado` **recalculado** (`PARCIAL` o `PAGADA`), no el original, y sigue existiendo **una sola** factura con esa clave. Es la afirmación explícita de que la garantía es "no se creó una segunda fila", no "los mismos bytes".
- [x] 6.11 Test: la repetición devuelve los items **releídos de la base**, no reconstruidos desde el pedido. Verificable por mutación: devolver `datos.items` en vez de `list_by_factura` hace fallar el caso en que la factura fue editada después de crearse.
- [x] 6.12 Test de carrera (dos sesiones, dos hilos): dos `crear` con la misma clave producen **una** factura. Anotar que la colisión salta en el flush de `factura`, antes de que exista un solo item (`create_with_items` flushea la cabecera primero).
- [x] 6.13 Test: tras la violación la sesión queda usable, y un `IntegrityError` de otra constraint se propaga.
- [x] 6.14 Implementar en `app/services/factura_service.py`. La rama de réplica SHALL armar la respuesta por el **mismo camino** que la creación: recalcular el FIFO y releer los items al responder (design.md D4). El repository suma la lectura por clave, scopeada y sin filtrar `deleted_at`.

## 7. Router de facturas

- [x] 7.1 Test: ninguna respuesta de factura expone `idempotency_key`.
- [x] 7.2 Test: `Idempotency-Key` malformada responde `422` y no persiste nada.
- [x] 7.3 Test end-to-end: primer POST → `201` sin el header de réplica; segundo POST idéntico → `200` con `Idempotent-Replay: true`, mismo `id`, mismos items y `proveedor_nombre` resuelto.
- [x] 7.4 Test: sesión ausente sigue dando `401` antes de mirar el header.
- [x] 7.5 Implementar en `app/routers/facturas.py`, mismo patrón que 5.6. Ninguna lógica de decisión en el router.

## 8. `CobroClienteService.crear` — el caso que rompe si se copia la receta

- [x] 8.1 Test: `crear` sin clave se comporta **exactamente** como hoy, incluida la validación de saldo de RN-CCC-04.
- [x] 8.2 Test: `crear` con una clave nueva persiste el cobro con esa clave y lo reporta como **creado**.
- [x] 8.3 **Test central del change (design.md D2 / proposal §Why):** un cliente debe exactamente $1000, se registra un cobro de $1000 con una clave, y llega un reintento con la misma clave y los mismos datos → la respuesta es la **repetición** del cobro original, **no** un `422` por saldo insuficiente, y el cliente tiene un solo cobro. Este test SHALL fallar contra una implementación que copie el orden de C-42 al pie de la letra. Escribirlo **antes** de tocar el service.
- [x] 8.4 Test (triangulación de 8.3): el mismo escenario con un cobro **parcial** —$400 sobre $1000— también devuelve la repetición. Cubre que el arreglo no dependa de que el saldo quede exactamente en cero.
- [x] 8.5 Test: **la regla de saldo sigue viva para escrituras nuevas** — un cobro con clave **nueva** cuyo monto supera el saldo pendiente sigue dando `422` (D-37, sin saldo a favor), no persiste nada, y esa clave queda libre para un envío corregido. Es la mitad que impide que el arreglo de 8.3 se convierta en un agujero.
- [x] 8.6 Test: clave ya usada con **monto distinto** → `409` con el cobro existente en el `detail`. Triangular con `fecha`, `metodo` y `cliente_id` distintos.
- [x] 8.7 Test: un cobro creado con clave y luego eliminado, reintentado con la misma clave, levanta `409`.
- [x] 8.8 Test: la misma clave en **dos negocios distintos** crea un cobro en cada uno, y la lectura por clave nunca devuelve el ajeno (Regla Dura #3).
- [x] 8.9 **Test de que la resolución anticipada no mata el camino de la violación:** carrera real (Postgres, dos sesiones, dos hilos) con la misma clave donde **ninguna** de las dos encuentra la clave en su lectura previa → se crea **un** cobro y la segunda recibe el original por la rama del `IntegrityError`. Verificable por mutación: al borrar la rama de `IntegrityError` creyendo que el fast path la reemplaza, este test falla.
- [x] 8.10 Test: tras la violación la sesión queda usable, y un `IntegrityError` de otra constraint se propaga.
- [x] 8.11 Test: la validación de cliente ajeno sigue corriendo — cliente de otro negocio con clave nueva da `404` y no persiste nada.
- [x] 8.12 Implementar en `app/services/cobro_cliente_service.py` con el orden **invertido** respecto de los otros dos: si viene clave, lectura por clave scopeada **antes** de la validación de saldo; si encuentra, decide repetición/conflicto y sale; si no, sigue el camino normal (validar → `INSERT` → `IntegrityError` → relectura). Documentar en el código, junto a la lectura previa, que decide *si validar* y no *si la clave está libre*, y que borrar la rama del `IntegrityError` degrada el caso concurrente a un `500`. El repository suma la lectura por clave, scopeada y sin filtrar `deleted_at`.

## 9. Router de cobros, `cliente_service` y cierre de Fase A

- [x] 9.1 Test: `CobroClienteResponse` no expone `idempotency_key`; `Idempotency-Key` malformada da `422`; sin sesión sigue dando `401` antes de mirar el header.
- [x] 9.2 Test end-to-end: primer POST → `201`; segundo idéntico → `200` con `Idempotent-Replay: true` y el mismo `id`. Y el saldo del cliente descuenta el monto **una sola vez**, verificado contra `GET /api/clientes/{id}/cuenta-corriente`.
- [x] 9.3 Implementar en `app/routers/cobros.py`, mismo patrón que 5.6.
- [x] 9.4 Test: un `IntegrityError` de una constraint **distinta** de `uq_cliente_negocio_nombre_normalizado_activo` en el alta de cliente **no** se reporta como nombre duplicado — se propaga. Mismo test para la edición. Se inyecta el error con `monkeypatch` sobre el repository, misma técnica documentada que usó C-42 en su task 4.13: disparar la violación con una fila real no es reproducible a pedido.
- [x] 9.5 Test (triangulación de 9.4): la violación de la constraint del nombre **sí** sigue dando `409` con el cliente existente, en alta y en edición. Los tests existentes de C-32 tienen que seguir en verde sin editarse.
- [x] 9.6 Arreglar `cliente_service.crear` y `cliente_service.actualizar` usando `es_violacion_de` contra `uq_cliente_negocio_nombre_normalizado_activo`, y re-elevar si no coincide (design.md D6). Actualizar el docstring de `idempotencia.py`, que hoy dice que C-43 iba a agregarle idempotencia a `cliente`: no se la agrega, solo se cierra el `except`.
- [x] 9.7 Correr el suite completo de backend y comparar contra el baseline de 1.1. Los arneses de pagos, facturas y cobros de 1.2 tienen que seguir en verde **sin editarse**. Anotar el número medido.
      **Medido:** `1346 passed, 2 warnings in 738.67s (0:12:18)`, cero fallos. Delta contra el baseline de 1.1: **+105**, que se descompone exacto — 99 tests colectados en los cinco archivos nuevos (`test_c43_idempotencia_{pago,factura,cobro}.py`, `test_c43_cliente_constraint_fix.py`, `test_alembic_migration_0013.py`) más 6 sumados a los dos archivos existentes que sí se modificaron (`test_idempotencia_service.py`, `test_alembic_migration_0011.py`). Nada se perdió por el camino. Los 12 arneses de 1.2 siguen en `242 passed` sin editarse.
- [x] 9.8 Verificar que `tests/test_c28_scoping_axis_guard.py` sigue en verde y que su conteo no se movió respecto de 1.3. Ninguna lectura por clave puede usar `usuario_id`.
      **Medido:** `40 passed`, idéntico a 1.3. El conteo no se movió: este change modifica archivos de `services/` y `repositories/` pero no agrega ninguno.
- [x] 9.9 **Gate de Fase A:** confirmar con `git diff --stat` que **ningún archivo de `facturas-proveedores-web/` fue tocado**. Si aparece uno, Fase A dejó de ser independientemente entregable y hay que sacarlo.
      **Verificado:** cero archivos bajo `facturas-proveedores-web/` en el árbol de trabajo. Fase A es backend puro y entregable por sí sola.

---

# FASE B — Frontend (`facturas-proveedores-web`)

> ## 🚫 BLOQUEADA — no arrancar durante la implementación de Fase A
>
> **Condición 1 (todos los grupos):** Fase A deployada. El backend sin header se comporta como hoy, así que el orden backend → frontend es seguro y el inverso no.
>
> **Condición 2 (solo el grupo 12):** **C-36 (`c-36-cuenta-corriente-clientes-frontend`) archivado.** C-36 es quien crea el `cobrosApi` y el formulario de cobro. Hoy **no existen**: `src/features/cuenta-corriente/` es la cuenta corriente de **proveedores** (C-13). Sin C-36 no hay dónde cablear la clave.
>
> Si al llegar acá C-36 no archivó: hacer 10, 11 y 13, y dejar el grupo 12 abierto con la razón anotada.

## 10. Red de seguridad y `createPago`

- [ ] 10.1 Correr el suite completo de frontend y anotar la línea medida de tests y archivos. Cualquier fallo es preexistente: reportarlo, no arreglarlo acá.
- [ ] 10.2 Test: `createPago` incluye **siempre** el header `Idempotency-Key`. Es el guard del mecanismo: como un POST sin clave **no** da error, este test es la única señal de que un call site nuevo se la olvidó. Anotarlo así en el código.
- [ ] 10.3 Test: dos llamadas de `createPago` con el mismo payload tras un fallo sin respuesta mandan **la misma** clave.
- [ ] 10.4 Test (triangulación): si entre los dos envíos cambia el monto, la clave es distinta.
- [ ] 10.5 Test: `updatePago` y `deletePago` **no** mandan clave — no están protegidos y mandarla sugeriría una garantía inexistente.
- [ ] 10.6 Test: el namespace de la clave de pagos es **propio** — confirmar el guardado de un pago no descarta la clave pendiente de una venta ni de una factura.
- [ ] 10.7 Implementar en `pagosApi.ts` reutilizando `getIdempotencyKey` / `confirmIdempotencyKey` (ya genéricos por namespace desde C-42) y `classifySuccess`. **No modificar `src/shared/api/idempotency.ts` ni `submitOutcome.ts` ni `client.ts`** — ya sirven tal cual.
- [ ] 10.8 Test (`PagoForm`): ante `200` + `Idempotent-Replay: true` informa éxito diciendo que el pago **ya estaba** registrado, navega como en un guardado normal, y no muestra ningún error. Triangular con un `201` normal.
- [ ] 10.9 Test (`PagoForm`): ante un error sin respuesta conserva proveedor, monto, fecha y método; y apretar el reintento manda **la misma** clave que el intento fallido.
- [ ] 10.10 Test (`PagoForm`): el copy de resultado desconocido ofrece el reintento como acción principal, **ya no pide revisar el listado**, y conserva la salvedad de la página cerrada o recargada. Es el retiro del copy interino que dejó C-42 en `PagoForm.tsx:403`.
- [ ] 10.11 Implementar en `PagoForm.tsx`. El retiro del copy y el cableado de la clave van en el **mismo** entregable: retirarlo antes prometería seguridad inexistente, dejarlo después pediría trabajo manual que el sistema ya hace (design.md D8).

## 11. `createFactura` y `FacturaForm`

- [ ] 11.1 Test: `createFactura` incluye **siempre** el header `Idempotency-Key`. Mismo guard que 10.2.
- [ ] 11.2 Test: dos llamadas con el mismo payload tras un fallo sin respuesta mandan la misma clave.
- [ ] 11.3 Test: el payload que determina la identidad del intento **incluye los items** — corregir la descripción o el precio de un item acuña una clave **nueva**. Sin esto la corrección chocaría contra el `409` del backend en vez de guardarse.
- [ ] 11.4 Test (triangulación): agregar un item también acuña clave nueva; reenviar exactamente lo mismo reutiliza la clave.
- [ ] 11.5 Test: `updateFactura` y `deleteFactura` no mandan clave.
- [ ] 11.6 Implementar en `facturasApi.ts`, con namespace propio.
- [ ] 11.7 Test (`FacturaForm`): ante `200` + `Idempotent-Replay: true` informa éxito diciendo que la factura **ya estaba** registrada, sin error.
- [ ] 11.8 Test (`FacturaForm`): el `estado` de la respuesta de una repetición se muestra **verbatim** aun si difiere del que devolvió el intento original — nunca se recalcula en el cliente (RN-FAC-09).
- [ ] 11.9 Test (`FacturaForm`): el copy de resultado desconocido ofrece el reintento como acción principal, ya no pide revisar el listado, y conserva la salvedad de la página cerrada o recargada. Retiro del copy interino de `FacturaForm.tsx:407`.
- [ ] 11.10 Implementar en `FacturaForm.tsx`, con el retiro del copy en el mismo entregable.

## 12. `createCobro` — 🚫 BLOQUEADO POR C-36

- [ ] 12.1 **Verificar que C-36 archivó** y que existen el `cobrosApi` y el formulario de cobro. Si no, detenerse acá y anotar la razón: sin C-36 no hay dónde cablear la clave. No inventar el formulario en este change.
- [ ] 12.2 Test: la creación de cobro incluye **siempre** el header `Idempotency-Key`, con namespace propio. Mismo guard que 10.2.
- [ ] 12.3 Test: dos envíos del mismo cobro tras un fallo sin respuesta mandan la misma clave; cambiar el monto acuña una nueva.
- [ ] 12.4 Test: ante `200` + `Idempotent-Replay: true` el formulario informa éxito diciendo que el cobro **ya estaba** registrado, sin error.
- [ ] 12.5 Test del escenario que motivó design.md D2, extremo a extremo desde el formulario: saldar la cuenta entera, perder la respuesta, reintentar → éxito informado como "ya estaba registrado", y el saldo del cliente descuenta el monto una sola vez. Nunca un `422` por saldo insuficiente.
- [ ] 12.6 Implementar el cableado sobre lo que entregó C-36, sin modificar `src/shared/api/`.

## 13. Cierre y documentación

- [ ] 13.1 Correr los dos suites completos y anotar los números finales medidos. Verificar `npx tsc --noEmit` y `npx eslint src --ext .ts,.tsx --max-warnings 0` limpios.
- [ ] 13.2 Verificar que **no se tocó** `src/shared/api/api.d.ts`: la clave no se expone en ninguna respuesta, así que no hay tipo de wire nuevo. Y que **no se corrió** `npm run generate-types`.
- [ ] 13.3 Documentar en `knowledge-base/09_decisiones_y_supuestos.md`, continuando la numeración desde donde la dejó C-42: que la receta se repite por entidad en vez de abstraerse; que en cobros la lectura por clave va antes de la validación de saldo porque ésa es una validación con estado; que la respuesta de una repetición se arma al responder y puede diferir de la original en un valor derivado; que la migración 0013 es una sola revisión para las tres tablas; y que `cliente_service` dejó de adivinar cuál constraint se violó.
- [ ] 13.4 Sumar a `knowledge-base/05_reglas_de_negocio.md` la regla de que reintentar un pago, una factura o un cobro no crea una segunda operación, en los dominios correspondientes. En Cuenta Corriente de Clientes, dejar explícito que la regla de RN-CCC-04 no aplica a una repetición.
- [ ] 13.5 Actualizar la nota de `CLAUDE.md` que hoy dice "**Pendiente de C-43**: `pagos`, `facturas` y `cobros` **no** deduplican" — dejó de ser cierto.
- [ ] 13.6 Marcar C-43 en `CHANGES.md` con la fecha de archive **solo** cuando el archive real se ejecute (`/opsx:archive`), no antes. Si el grupo 12 quedó abierto por C-36, anotarlo explícitamente como deuda residual en vez de cerrarlo en silencio.
