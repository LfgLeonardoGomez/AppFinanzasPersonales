## Context

C-42 dejó el mecanismo entero construido y probado sobre una sola escritura. Lo que existe hoy y este change reutiliza sin rediseñar:

- `app/services/idempotencia.py` → `nombre_constraint_violada(err)`, que lee `err.orig.diag.constraint_name` de psycopg2 defensivamente. Es lo único genuinamente compartible del mecanismo.
- El patrón de `venta_service.crear`: validar → `INSERT` → capturar `IntegrityError` → si la constraint es la de idempotencia, `rollback()` → releer por `(negocio_id, idempotency_key)` → decidir repetición o conflicto.
- `venta_repository.get_by_idempotency_key`, que **no** filtra `deleted_at IS NULL` a propósito.
- La clase `VentaCreada` (recurso + `es_repeticion`), que le da al router lo único que necesita para bajar el `201` a `200` y agregar `Idempotent-Replay: true`.
- El índice único parcial de la migración 0012, sin `deleted_at` en el predicado.
- `Idempotency-Key` ya está en `allow_headers` del CORS de `app/main.py`. No hay que tocarlo.
- Del lado del cliente: `src/shared/api/idempotency.ts` ya es **genérico por namespace** (`getIdempotencyKey(namespace, payload)` / `confirmIdempotencyKey(namespace, key)`), `submitOutcome.ts` ya clasifica los cuatro estados, y `client.ts` ya tiene el `timeout` de 20s con override de 120s para IA.

Lo que **no** existe y este change agrega: la aplicación de todo eso a `pago`, `factura` y `cobro_cliente`.

Las tres escrituras destino no son la misma forma:

| | `PagoService.crear` | `FacturaService.crear` | `CobroClienteService.crear` |
|---|---|---|---|
| Validaciones previas | proveedor propio y activo, fecha no futura, monto > 0 | proveedor propio y activo, `fecha_emision` no futura, suma de items (warning, no bloquea) | cliente propio y activo, fecha no futura, monto > 0, **monto ≤ saldo disponible** |
| ¿Alguna validación depende del estado que la escritura modifica? | No | No | **Sí** |
| Filas escritas | 1 | 1 + N items (`create_with_items`, mismo flush) | 1 |
| Respuesta | `PagoResponse` + `proveedor_nombre` resuelto aparte | `FacturaConEstado`: estado FIFO derivado + items + `items_sum_mismatch` | `CobroClienteResponse` plano |

Esa última fila es la que hace que este change no sea un copy-paste x3.

Restricciones que condicionan todo lo de abajo, heredadas y vigentes:

- **VPS Oracle free tier, 1GB RAM.** Sin scheduler, sin cron, sin Redis. Cualquier diseño que necesite limpieza necesita antes infraestructura que no existe.
- **Postgres real en los tests, nunca SQLite** (Regla Dura #12). Un índice único parcial y un `IntegrityError` bajo concurrencia solo se testean contra Postgres.
- **La autorización y el scoping viven en el service layer** filtrando por `negocio_id` (Reglas Duras #3 y #8). El guard de AST `tests/test_c28_scoping_axis_guard.py` falla si `usuario_id` reaparece como filtro; ninguna lectura por clave puede usarlo.
- **`saldo` y `estado` nunca se persisten** (D-01). El `estado` de una factura se deriva en cada lectura, incluida la de una repetición.
- **El validador de openspec solo lee el primer párrafo de un requirement buscando `SHALL`** (D-59): la oración normativa va primera.
- **C-36 corre en paralelo.** Es frontend puro sobre la cuenta corriente de clientes y todavía no aterrizó.

## Goals / Non-Goals

**Goals:**

- Que reintentar un pago, una factura o un cobro **no pueda** crear una segunda fila, garantizado por la base de datos.
- Que el reintento sea transparente en los tres, con la misma semántica que ventas: `200` + `Idempotent-Replay: true`, o `409` si los datos cambiaron.
- Que la protección de cobros funcione en el caso más común de todos —saldar la cuenta entera— y no solo en los cobros parciales chicos.
- Que **Fase A sea entregable sola**: backend completo, verificable, deployable y reversible sin tocar una línea de frontend ni depender de C-36.
- Que el `except IntegrityError` pelado de `cliente_service` deje de ser una bomba de tiempo.
- Que ninguna invariante de negocio se toque, y que el camino sin header siga siendo byte por byte el de hoy.

**Non-Goals:**

- Que la repetición devuelva **bytes idénticos** a la respuesta original. Ver D4: para facturas es imposible sin mentir.
- Idempotencia en `PATCH`, `DELETE`, `POST /api/clientes` y los endpoints de extracción por IA.
- Una tabla genérica de idempotencia. Sigue rechazada (C-42 D2) y este change suma un argumento más en contra (D4).
- Una abstracción que unifique los cuatro services en una sola función. Ver D1.
- Reintento automático. `retry: 0` en mutaciones se mantiene: el mecanismo hace seguro el reintento **humano**.
- Cola de escrituras offline / outbox.

## Decisions

### D1 — Se repite la receta por entidad; lo único compartido sigue siendo el nombre de la constraint

La tentación con la cuarta repetición es abstraer: una `IdempotentCreateMixin`, o una función genérica `crear_idempotente(repo, comparar, datos, key)` que reciba callables. **Se descarta.**

Las cuatro instancias divergen justamente en lo que la abstracción tendría que esconder: el **orden** respecto de las validaciones difiere en cobros (D2), la **construcción de la respuesta** difiere en facturas (D4), y la **lista de campos a comparar** es distinta en las cuatro. Una firma genérica capaz de expresar esas tres diferencias tendría tantos parámetros como líneas ahorra, y —peor— haría que la inversión de orden de cobros se leyera como un flag más en vez de como la decisión de diseño que es. La repetición explícita hace visible la diferencia; la abstracción la escondería.

Lo que sí se comparte es lo que ya se comparte: `nombre_constraint_violada`. Se le agrega una única función hermana, `es_violacion_de(err, constraint)`, que es el predicado que los cuatro services escriben hoy a mano (`nombre_constraint_violada(err) != _UQ_...`). Es azúcar, no arquitectura, y existe para que la comparación no se escriba invertida por accidente en alguno de los cuatro.

C-42 D2 dijo que con ~diez repeticiones la tabla genérica se justifica. Con cuatro y sin lógica divergente que se pueda unificar, no. Queda anotado como el umbral.

### D2 — En cobros, la búsqueda por clave va **antes** de la validación de saldo

Ésta es la decisión que hace que este change necesite diseño.

C-42 fijó el orden **validar primero, insertar después** (task 4.10), con una razón buena: si la validación rechaza, no se persiste nada y la clave **queda libre** para un envío corregido. Para ventas eso es correcto porque sus validaciones son puras respecto de la propia venta: `monto > 0`, fecha no futura, y el par `(forma_pago, cliente_id)`. Ninguna cambia porque la venta se haya guardado.

`CobroClienteService._saldo_disponible` **no** es pura en ese sentido: lee `venta` y `cobro_cliente` y devuelve `SUM(fiados) - SUM(cobros)`. El cobro que se está creando entra en esa resta apenas se guarda.

El escenario concreto, con números:

1. Un cliente debe $1000. La persona registra un cobro de $1000 para saldar la cuenta.
2. El backend commitea. La respuesta se pierde (radio, `timeout` de 20s, `502` del proxy).
3. La persona reintenta el mismo cobro con la misma clave.
4. `_saldo_disponible` ahora devuelve **$0**, porque el cobro del paso 2 existe.
5. `datos.monto > disponible` → `422 "El pago supera el saldo pendiente. Saldo disponible: 0.00."`

El `INSERT` nunca ocurre, el `IntegrityError` nunca se dispara, y la rama de repetición es **inalcanzable**. A la persona se le rechaza una operación que sí se guardó, con un mensaje que la invita a corregir el monto — y corregirlo hacia abajo produce un cobro parcial que **sí** es un duplicado real.

No es un borde: la condición es `monto > saldo_restante`, o sea `monto > total/2`. Cualquier cobro que cancele más de la mitad de lo adeudado cae acá, y saldar la cuenta entera es el caso más frecuente que tiene la pantalla.

**Alternativa considerada y descartada — excluir la propia clave del cálculo del saldo.** `_saldo_disponible(..., excluir_idempotency_key=key)`, calcada de la `excluir_cobro_id` que ya existe para las ediciones. Mantiene el orden de C-42 idéntico en los cuatro services y no necesita tocar el contrato de `escritura-idempotente`. Se descarta por dos razones: mete una preocupación de transporte adentro de un cálculo de negocio —el saldo de un cliente pasaría a depender de un header HTTP, y quien lea `_saldo_disponible` en un año no va a entender por qué—, y solo arregla **esta** validación con estado: la próxima que aparezca vuelve a romper en silencio, sin que nada avise.

**Elegido — un `SELECT` por clave como *fast path*, antes de la validación con estado:**

```
si idempotency_key is not None:
    existente = repo.get_by_idempotency_key(negocio_id, key)   # scopeado por negocio_id
    si existente is not None:
        → decidir repetición / conflicto y salir, sin validar saldo

validaciones normales (incluye saldo)
INSERT
excepto IntegrityError de la constraint de idempotencia:
    rollback; releer por clave; decidir repetición / conflicto
```

Tres propiedades que hay que sostener explícitamente, porque son las que hacen que esto **no** debilite la garantía:

1. **La unicidad la sigue garantizando el índice, no el `SELECT`.** El fast path decide *si hace falta validar*, no *si la clave está libre*. La rama de `IntegrityError` no se elimina ni se vuelve muerta: dos requests concurrentes con la misma clave fallan las dos el fast path (ninguna commiteó todavía) y terminan las dos en el `INSERT`, donde la segunda bloquea en el índice y recibe la violación. Ese camino tiene test propio y **no** puede quedarse sin cobertura.
2. **La clave sigue quedando libre tras un rechazo.** La clave la consume un `INSERT` exitoso, no un intento. Un cobro rechazado por saldo con una clave nueva no escribió nada, así que un envío corregido con esa misma clave sigue funcionando.
3. **El fast path solo va en cobros.** Agregarlo a pagos y facturas sería complejidad sin causa y divergiría de ventas, que es la referencia. La asimetría se documenta en el código y se fija en la spec como "una escritura protegida cuya validación depende del estado que ella misma modifica" — la condición, no el nombre del endpoint.

### D3 — Qué significa "los mismos datos" en cada entidad

La comparación se hace **contra los campos de la fila guardada**, después de la normalización de Pydantic, sin guardar hash del request (C-42 D4).

- **Pago**: `proveedor_id`, `monto`, `fecha`, `metodo`, `comprobante_url`, `origen`. `origen` se compara contra el valor **resuelto** (`datos.origen or MANUAL`), no contra el crudo, o un payload que omite `origen` daría conflicto contra su propia fila.
- **Cobro**: `cliente_id`, `monto`, `fecha`, `metodo`, `comprobante_url`.
- **Factura**: `proveedor_id`, `fecha_emision`, `monto_total`, `numero`, `fecha_vencimiento`, `archivo_url`, `origen` (resuelto) **y los items**, comparados como lista ordenada de `(descripcion, cantidad, precio_unitario)`.

Incluir los items cuesta una query extra **solo en el camino de repetición** y compra lo que justifica todo el mecanismo del `409`: una línea corregida es exactamente la corrección que no puede descartarse en silencio. Dejarlos afuera sería decir "guardado" ante una factura cuyo detalle cambió.

`items_sum_mismatch` **no** entra en la comparación: es una salida derivada de `monto_total` y los items, no una entrada.

### D4 — La repetición se arma en el momento de responder, nunca se congela

`FacturaService.crear` devuelve `FacturaConEstado`, y el `estado` es FIFO derivado sobre **todas** las facturas y **todos** los pagos activos de ese proveedor (RN-FIFO, RN-FAC-09). En la rama de repetición ese estado se **recalcula**, y los items se **releen**, exactamente como en la creación.

Consecuencia que hay que aceptar en voz alta: **la respuesta de una repetición puede diferir de la respuesta original.** Si entre el intento y el reintento entró un pago al mismo proveedor, la factura pudo pasar de `PENDIENTE` a `PARCIAL`, y la repetición devuelve `PARCIAL`. Lo mismo con `proveedor_nombre` en pagos si al proveedor lo renombraron.

Eso es **correcto**, no un bug: `estado` es derivado y nunca persistido (D-01), así que la respuesta describe el mundo de ahora, no una foto del pasado. La alternativa —guardar el cuerpo de la respuesta original, estilo Stripe— devolvería un `estado` que ya es falso, y sería el sistema afirmando algo que sus propias reglas contradicen. Es el argumento nuevo, que C-42 no tenía, a favor de haber rechazado la tabla genérica con respuesta serializada.

La garantía de la idempotencia es **"no se creó una segunda fila"**, no **"recibís los mismos bytes"**. La spec lo dice con un escenario propio para que nadie lo lea como una regresión.

### D5 — Una sola migración 0013 para las tres tablas

La cabeza es `0012` (venta_idempotency_key, C-42). C-43 toma **0013** y lo reserva acá antes de codear (D-46). C-36 es frontend puro y no agrega migración, así que no hay colisión con el change que corre en paralelo.

Una revisión y no tres: las tres columnas se agregan por la misma razón, se deployan en la misma ventana y se revierten juntas. Tres revisiones sería tres ventanas de downtime para un cambio atómico, y un estado intermedio (pagos protegidos, cobros no) que nadie quiere poder alcanzar.

```sql
ALTER TABLE pago          ADD COLUMN idempotency_key uuid NULL;
ALTER TABLE factura       ADD COLUMN idempotency_key uuid NULL;
ALTER TABLE cobro_cliente ADD COLUMN idempotency_key uuid NULL;

CREATE UNIQUE INDEX uq_pago_negocio_idempotency_key
    ON pago (negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_factura_negocio_idempotency_key
    ON factura (negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE UNIQUE INDEX uq_cobro_cliente_negocio_idempotency_key
    ON cobro_cliente (negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
```

Predicado **solo** `IS NOT NULL`, sin `deleted_at`, por la misma razón que en 0012: liberar la clave al borrar el recurso haría que un reintento tardío creara una segunda fila. La clave la consume la operación, no el ciclo de vida de la fila.

Test de migración con revisiones fijas (`revision="0013"`, `down_revision="0012"`), nunca `head` ni `-1` (D-21), y ciclo upgrade → downgrade → upgrade. Sin enums nuevos, así que D-56 no aplica.

### D6 — `cliente_service` deja de adivinar cuál constraint se violó

`cliente_service.crear` captura un `IntegrityError` pelado y responde `409 "nombre duplicado"`. Hoy acierta por accidente: `cliente` tiene un único índice único, `uq_cliente_negocio_nombre_normalizado_activo`. El día que tenga dos, cualquier otra violación se reporta como nombre duplicado — un `500` disfrazado de error de usuario, sobre el que nadie va a investigar porque el mensaje suena razonable.

Se arregla ahora aunque este change **no** le agregue idempotencia a `cliente`, por dos razones: `idempotencia.py` existe justamente para esto y su docstring ya nombra a C-43 como quien lo iba a cerrar; y el arreglo es de tres líneas contra un bug cuyo síntoma futuro es indistinguible de un error legítimo.

Mismo tratamiento en `cliente_service.actualizar`, que tiene el mismo `except` pelado.

Alcance acotado a propósito: se compara el nombre de la constraint y se re-eleva si no coincide. No se le agrega idempotencia al alta de cliente — ya está desduplicada por su propio índice de nombre, y un doble submit devuelve `409` con el cliente existente, que es la respuesta correcta.

### D7 — El límite entre Fase A y Fase B, y por qué es duro

**Fase A no toca `facturas-proveedores-web`.** Ni un archivo. Se verifica con la suite de backend sola, se deploya sola, y se revierte sola (`alembic downgrade 0012` + revert del backend). Nada en ella depende de C-36 ni de que exista un formulario de cobro.

Eso es posible porque el header es **opcional en el contrato**: sin `Idempotency-Key`, los tres endpoints se comportan exactamente como hoy. El frontend viejo sigue funcionando contra el backend nuevo. El orden **backend → frontend es seguro y el inverso no**, igual que en C-42.

**Fase B** espera a que Fase A esté deployada, y su tramo de cobros espera además a **C-36**, que es quien crea el formulario. Dentro de Fase B:

- Pagos y facturas se pueden hacer apenas Fase A esté arriba. No dependen de C-36 en nada.
- Cobros necesita el `cobrosApi` / formulario de C-36. Si C-36 todavía no archivó, ese tramo queda pendiente y el resto de Fase B se entrega igual.

**Superficie de conflicto con C-36:** cero en Fase A (backend puro vs. frontend puro). En Fase B, solo los archivos que C-36 crea, tocados después de que los cree. `src/shared/api/idempotency.ts` y `submitOutcome.ts` no se modifican en ninguna de las dos fases —ya son genéricos— y `api.d.ts` tampoco, porque la clave no aparece en ninguna respuesta.

### D8 — El copy interino se retira solo cuando la protección es real

C-42 dejó en `PagoForm.tsx:403` y `FacturaForm.tsx:407` un copy que pide revisar el listado antes de reintentar y **no** ofrece el reintento como acción principal. Era la única cosa honesta que se podía decir sobre un endpoint que no desduplica.

Ese copy se retira en Fase B, **junto con** el cableado de la clave en el mismo formulario, nunca antes ni por separado. Retirarlo primero prometería seguridad que no existe; dejarlo después de cablear la clave le pediría a la persona un trabajo manual que el sistema ya está haciendo.

Se fija como requisito de la capability transversal y no como detalle de cada formulario, porque la regla es general: **la promesa de "reintentar es seguro" solo puede hacerla un formulario que efectivamente mande la clave.** Cualquier escritura futura que no la mande hereda el copy conservador sin que haya que acordarse.

## Risks / Trade-offs

- **Copiar el orden de C-42 al pie de la letra rompe cobros en su caso más común** (D2) → el fast path por clave antes de la validación de saldo, con test explícito del escenario "saldar la cuenta entera, perder la respuesta, reintentar", y test aparte de que la rama concurrente (`IntegrityError`) sigue siendo alcanzable y sigue siendo la que garantiza la unicidad.
- **El fast path puede leerse como el `SELECT`-antes-de-`INSERT` que la spec prohíbe** → la spec se modifica explícitamente para distinguir los dos: decidir *si validar* está permitido, decidir *si la clave está libre* no. Si alguien borra la rama de `IntegrityError` creyendo que el fast path la reemplaza, el caso concurrente degrada a `500`, no a duplicado — el índice sigue ahí. Malo, pero no silencioso.
- **Fase A sin Fase B no entrega valor** (los endpoints desduplican pero ningún formulario manda la clave) → declarado en el proposal y en tasks.md; el change no se archiva con Fase B pendiente.
- **La repetición de una factura puede devolver un `estado` distinto** (D4) → escenario de spec propio para que se lea como comportamiento definido y no como bug; y ninguna respuesta se congela, así que no hay una segunda fuente de verdad que pueda desincronizarse.
- **Cuatro copias del mismo bloque de idempotencia** (D1) → aceptado a cambio de que las diferencias reales queden visibles. El umbral para reconsiderar (tabla genérica) está anotado: ~diez escrituras protegidas.
- **`create_with_items` flushea la factura antes de los items**, así que la violación de idempotencia salta antes de que exista un solo item → correcto (el `rollback` no deja huérfanos), pero hay que tenerlo presente al escribir el test: la fila que colisiona es la de `factura`, no la de `factura_item`.
- **Tres columnas nuevas sobre las tres tablas de plata** → migración aditiva, sin backfill, con índices que al crearse indexan cero filas; aun así se corre con la app detenida y con `downgrade` probado en el ciclo completo.
- **Un header opcional se puede olvidar en un call site nuevo** → en Fase B, un test guard por API (`createPago`, `createFactura`, el de cobros) que afirme que la clave siempre viaja, en el espíritu del guard de `createVenta` de C-42. Como un POST sin clave **no** da error, el guard es la única señal.
- **`cliente_service` arreglado sin que `cliente` tenga un segundo índice** (D6) → el arreglo no es verificable con una fila real hoy; el test inyecta un `IntegrityError` con otro nombre de constraint, misma técnica documentada que usó C-42 en su task 4.13.
- **C-36 corre en paralelo** → Fase A tiene superficie cero; el tramo de cobros de Fase B espera a que C-36 archive. El riesgo real no es de código sino de secuencia: si Fase B arranca antes de que C-36 archive, el formulario de cobro no existe y ese tramo queda a medio hacer.

## Migration Plan

1. Aprobación humana de este diseño (governance ALTO) antes de escribir código.
2. **Fase A** — backend con la app detenida: `alembic upgrade 0013`. Segundos, sin backfill. Deploy del backend. Los tres endpoints sin header se comportan exactamente como hoy, así que el frontend actual sigue funcionando sin cambios.
3. Verificación de Fase A con la suite de backend completa, contra el baseline medido antes de empezar.
4. **Fase B** — cableado del frontend y retiro del copy interino, una vez Fase A está en producción. El tramo de cobros, después de que C-36 archive.
5. Rollback de Fase B: revertir el frontend basta; el backend sigue aceptando requests sin header.
6. Rollback de Fase A: `alembic downgrade 0012` dropea los tres índices y las tres columnas. Las filas creadas con clave sobreviven intactas — la clave nunca fue parte de su significado.

## Open Questions

Ninguna bloquea la implementación.

1. **¿El fast path de cobros debería aplicarse también a pagos y facturas, por simetría?** Hoy la respuesta es no: no lo necesitan y la asimetría documenta la razón. Si aparece una tercera validación con estado, conviene revisar si el fast path pasa a ser el patrón por defecto en vez de la excepción.
2. **¿Cuál es el umbral real para la tabla genérica de idempotencia?** C-42 dijo "~diez"; este change llega a cuatro. Es una decisión a tomar con evidencia el día que aparezca la quinta o sexta escritura protegida, no antes.
3. **Producto:** ¿la repetición de una factura debería avisar en la interfaz que el `estado` que muestra es el de ahora y no el del intento original? Técnicamente no hace falta y agregar el aviso puede confundir más de lo que aclara. Candidata a `10_preguntas_abiertas.md`.
