> **TDD estricto activo.** Toda task que nombra un comportamiento arranca en RED: escribir el test que falla, hacerlo pasar con lo mínimo, triangular con un segundo caso de entradas distintas, y recién ahí refactorizar. Los tests corren contra **Postgres real en contenedor**, nunca SQLite (Regla Dura #12); Cloudinary y el modelo de visión quedan mockeados.
>
> Comando de test backend: `cd facturas-proveedores-api && .venv/Scripts/python.exe -m pytest`
> Comando de test frontend: `cd facturas-proveedores-web && npm test`
>
> **Gobernanza ALTO.** No arrancar el grupo 2 antes de que un humano haya aprobado `design.md`. La migración toca la tabla que registra la facturación.
>
> **NO correr `npm run generate-types`.** `src/shared/api/api.d.ts` está escrito a mano; regenerarlo rompe 262 imports (C-41).
>
> **Orden de entrega no negociable:** backend completo antes que frontend. El backend sin header se comporta como hoy, así que el frontend viejo sigue funcionando contra el backend nuevo; al revés no.

## 1. Red de seguridad

- [ ] 1.1 Correr el suite completo de backend y anotar acá la línea `N passed` **copiada de la corrida**, no de memoria ni del número de un change anterior. Cualquier fallo es **preexistente**: reportarlo y NO arreglarlo en este change.
- [ ] 1.2 Correr el suite completo de frontend y anotar acá la línea medida de tests y archivos. Mismo criterio para fallos preexistentes.
- [ ] 1.3 Anotar el conteo puntual de `tests/test_c33_ventas.py` (28 al escribir esto). Es el arnés directo del endpoint que se modifica: tiene que seguir en verde sin editarse, porque todos esos tests postean **sin** header y prueban que el comportamiento sin clave no cambió.

## 2. Migración 0012 y modelo

- [ ] 2.1 Test de migración `0012` con revisiones fijas (`revision="0012"`, `down_revision="0011"`), nunca `head` ni `-1` (D-21): agrega la columna `idempotency_key` (uuid, nullable) y el índice único parcial `uq_venta_negocio_idempotency_key` sobre `(negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. `downgrade` limpio y ciclo upgrade → downgrade → upgrade.
- [ ] 2.2 **Test que importa (D2/D3):** insertar **directo en la tabla**, sin pasar por la aplicación, dos ventas del mismo negocio con la misma `idempotency_key` — la base SHALL rechazar la segunda. Es la mitad que ninguna validación de aplicación puede dar.
- [ ] 2.3 Test (triangulación del anterior): insertar directo varias ventas del mismo negocio con `idempotency_key` **nula** — la base SHALL aceptarlas todas. Y la misma clave en **dos negocios distintos** SHALL ser aceptada.
- [ ] 2.4 Test: el índice **no** excluye filas con soft delete — una venta borrada sigue reteniendo su clave (design.md D2). Verificable por mutación: agregar `AND deleted_at IS NULL` al predicado hace fallar el test de 4.7.
- [ ] 2.5 Escribir `alembic/versions/20240012_0012_venta_idempotency_key.py`. Documentar en el docstring por qué el predicado del índice es solo `IS NOT NULL` y no incluye `deleted_at`.
- [ ] 2.6 Test: `Venta` persiste `idempotency_key` y **sigue sin** columnas de saldo ni estado (D-01 intacto).
- [ ] 2.7 Sumar el campo a `app/models/venta.py` con el comentario de por qué es nullable y por qué no participa de ningún cálculo.

## 3. `app/services/idempotencia.py`

- [ ] 3.1 Test: dado un `IntegrityError` de psycopg2 por violación de unicidad, la función devuelve el **nombre de la constraint** violada.
- [ ] 3.2 Test (triangulación): con un `IntegrityError` de otra constraint devuelve ese otro nombre, y con un error del que no se puede extraer el nombre devuelve `None` en vez de explotar.
- [ ] 3.3 Implementar `app/services/idempotencia.py` leyendo `err.orig.diag.constraint_name`, defensivo ante cada nivel ausente. Documentar en el docstring la trampa que motiva el módulo: `cliente_service.crear` hoy captura un `IntegrityError` pelado y asume que es el nombre duplicado, suposición que se rompe sola en cuanto `cliente` tenga un segundo índice único (C-43).

## 4. `VentaService.crear` con clave de idempotencia

- [ ] 4.1 Test: `crear` sin clave se comporta **exactamente** como hoy — se persiste, `idempotency_key` queda en `None`, y dos llamadas iguales sin clave producen **dos** ventas (RN-VTA-06).
- [ ] 4.2 Test: `crear` con una clave nueva persiste la venta con esa clave y la reporta como **creada** (no como repetición).
- [ ] 4.3 Test: `crear` con una clave ya usada y **los mismos datos** devuelve la venta original —mismo `id`— marcada como repetición, y en la base sigue habiendo **una sola** venta con esa clave.
- [ ] 4.4 Test (triangulación): repetir cinco veces con la misma clave deja exactamente una venta.
- [ ] 4.5 Test: `crear` con una clave ya usada y **monto distinto** levanta `409` con la venta existente en el `detail`, y la venta guardada conserva su monto original. Triangular con `fecha` distinta y con `cliente_id` distinto.
- [ ] 4.6 Test: la comparación usa `monto`, `fecha`, `forma_pago`, `cliente_id` y `notas` normalizadas — repetir con `notas` que solo difiere en espacios al borde SHALL ser una repetición, no un conflicto.
- [ ] 4.7 Test: una venta creada con clave y luego eliminada, reintentada con la misma clave, levanta `409` y **no** aparece una segunda venta en el listado.
- [ ] 4.8 Test: la misma clave usada por **dos negocios distintos** crea una venta en cada uno, y el listado de cada negocio muestra solo la suya (Regla Dura #3).
- [ ] 4.9 Test: la búsqueda de la venta por clave filtra por `negocio_id`. Verificable por mutación: al quitar el filtro, el test de 4.8 falla mostrando la venta ajena.
- [ ] 4.10 Test: las validaciones de negocio corren **antes** de tocar la idempotencia — un fiado sin cliente con clave nueva sigue dando `422` (RN-VTA-03), no persiste nada, y esa clave sigue disponible para un envío corregido.
- [ ] 4.11 Test de carrera (Postgres real, dos sesiones): dos `crear` con la misma clave desde conexiones distintas producen **una** venta; la segunda recibe la original. Sin `SELECT` previo — el test debe fallar si se reemplaza el `INSERT` + captura por un "consultar y después insertar".
- [ ] 4.12 Test: tras la violación de unicidad la sesión queda **usable** — la relectura posterior funciona porque hubo `rollback()` antes. Verificable por mutación: al quitar el `rollback()`, el test falla con `PendingRollbackError`.
- [ ] 4.13 Test: un `IntegrityError` por una constraint **distinta** de la de idempotencia se propaga y no se responde como repetición.
- [ ] 4.14 Implementar en `app/services/venta_service.py`: `INSERT` primero, captura de `IntegrityError`, `rollback()`, comparación de nombre de constraint vía `idempotencia.py`, relectura por `(negocio_id, idempotency_key)` y decisión réplica/conflicto. El repository suma el método de lectura por clave, siempre scopeado (Regla Dura #3 y #8: la autorización y la decisión viven en el service, la consulta en el repository).

## 5. Schema, router y CORS

- [ ] 5.1 Test: `VentaResponse` **no** expone `idempotency_key`. Es transporte, no dominio.
- [ ] 5.2 Test: `POST /api/ventas` con `Idempotency-Key` malformada (no UUID) responde `422` y no persiste nada.
- [ ] 5.3 Test end-to-end del endpoint: primer POST con clave → `201` **sin** header `Idempotent-Replay`; segundo POST idéntico → `200` **con** `Idempotent-Replay: true` y el mismo `id` en el cuerpo.
- [ ] 5.4 Test end-to-end del caso que motiva el change: dos POST de una venta con `forma_pago = CUENTA_CORRIENTE` y la misma clave dejan **un solo** cargo en la cuenta corriente del cliente, verificado contra el saldo que devuelve C-35.
- [ ] 5.5 Test: el POST sin sesión sigue dando `401` antes de mirar el header (el requirement de sesión de `ventas-backend` no se relaja).
- [ ] 5.6 Implementar en `app/routers/ventas.py`: leer el header con `Header(None)` tipado `Optional[uuid.UUID]`, pasarlo al service, e inyectar `Response` para bajar el status a `200` y setear `Idempotent-Replay` en la rama de réplica. **Ninguna lógica de decisión en el router.**
- [ ] 5.7 Sumar `Idempotency-Key` a `allow_headers` en `app/main.py`, junto a `X-Request-ID`. Test que lo afirma: en prod el frontend va por rewrite del mismo origen, así que olvidarlo no rompe ahí y sí rompe cualquier configuración cross-origin — un fallo que no se ve donde se prueba.
- [ ] 5.8 Correr el suite completo de backend y comparar contra el baseline de 1.1. `test_c33_ventas.py` tiene que seguir en verde **sin editarse**.

## 6. Frontend — `timeout` del cliente compartido

- [ ] 6.1 Test: `apiClient` tiene `timeout` de 20000 ms.
- [ ] 6.2 Test: una request que excede el `timeout` se rechaza como error sin `response`, y **no** dispara el flujo de refresh de sesión (la guarda `error.response?.status !== 401` lo corta).
- [ ] 6.3 Test: las dos llamadas de extracción por IA (`/facturas/extraer-ia`, `/pagos/extraer-ia`) pasan un `timeout` explícito mayor por request. Sin esto el global de 20s corta una extracción legítima: es el bug que el cambio de `timeout` introduce si se hace a ciegas.
- [ ] 6.4 Implementar el `timeout` en `src/shared/api/client.ts` y el override en `src/features/ia-vision/api/iaVisionApi.ts`, con el comentario de por qué 20s y no menos (design.md D5).
- [ ] 6.5 Correr el suite de `src/features/ia-vision/` completo: es el que más riesgo corre con este cambio.

## 7. Frontend — ciclo de vida de la clave (`src/shared/api/idempotency.ts`)

- [ ] 7.1 Test: acuñar una clave devuelve un UUID válido, y dos llamadas devuelven claves distintas.
- [ ] 7.2 Test: con `crypto.randomUUID` ausente, el fallback sobre `crypto.getRandomValues` devuelve igual un UUID válido. El destino son teléfonos baratos con WebViews viejas: una excepción acá rompería el guardado entero.
- [ ] 7.3 Test: pedir la clave para un payload ya visto devuelve **la misma** clave; pedirla para un payload distinto devuelve una nueva.
- [ ] 7.4 Test: confirmar el resultado descarta la clave, y el siguiente pedido con el mismo payload devuelve una clave distinta.
- [ ] 7.5 Test: la clave se espeja en `sessionStorage` y sobrevive a una reconstrucción del módulo (simula el reload de la pestaña).
- [ ] 7.6 Test: si `sessionStorage` lanza al leer **y** si lanza al escribir, el módulo degrada a memoria y **no** propaga la excepción.
- [ ] 7.7 Implementar `src/shared/api/idempotency.ts`. Mantenerlo aislado: si la revisión decide que la persistencia no vale la complejidad, este grupo se saca sin desarmar nada más (design.md D7).

## 8. Frontend — clasificación del resultado

- [ ] 8.1 Test: `201` → `creada`.
- [ ] 8.2 Test: `200` con `Idempotent-Replay: true` → `ya_registrada`.
- [ ] 8.3 Test: `422` y `409` → `rechazada`, con el `detail` del backend disponible para mostrar.
- [ ] 8.4 Test: error sin `response` (timeout, red) → `desconocida`.
- [ ] 8.5 Test: `500`, `502`, `503` y `504` → `desconocida`, **no** `rechazada`. Un gateway puede responder después de que la app commiteó; tratarlo como rechazo reabre el duplicado por otro camino.
- [ ] 8.6 Implementar el clasificador como función pura y exportada, sin depender de React ni de Axios más allá de la forma del error.

## 9. Frontend — `ventasApi`, hooks y `VentaForm`

- [ ] 9.1 Test: `createVenta` incluye siempre el header `Idempotency-Key`. Es el guard del mecanismo: como un POST sin clave **no** da error, este test es la única señal de que un call site nuevo se la olvidó. Anotarlo así en el código.
- [ ] 9.2 Test: dos llamadas de `createVenta` con el mismo payload tras un fallo sin respuesta mandan **la misma** clave.
- [ ] 9.3 Test (triangulación): si entre los dos envíos cambia el monto, la clave es distinta.
- [ ] 9.4 Test: `updateVenta` y `deleteVenta` **no** mandan clave — no están en alcance y mandarla sugeriría una protección que no existe.
- [ ] 9.5 Test (`VentaForm`): ante un error sin respuesta, el formulario dice que no se pudo confirmar si se guardó, ofrece reintentar como acción principal aclarando que es seguro, y **conserva** monto, fecha, forma de pago y cliente.
- [ ] 9.6 Test (`VentaForm`): apretar ese reintento manda la misma clave que el intento fallido.
- [ ] 9.7 Test (`VentaForm`): ante `200` + `Idempotent-Replay: true` el formulario informa éxito diciendo que la venta **ya estaba** registrada, navega como en un guardado normal, y **no** muestra ningún error.
- [ ] 9.8 Test (`VentaForm`): ante `422` sigue mostrando el `detail` del backend, como hoy.
- [ ] 9.9 Test (`VentaForm`): ante `409` explica que la operación ya fue registrada y no la presenta como resultado desconocido.
- [ ] 9.10 Test (`VentaForm`): tras varios intentos desconocidos consecutivos aparece además la salida al listado de ventas.
- [ ] 9.11 Test: el fiado no queda sin protección por el camino del diálogo de deuda — un guardado de venta con `CUENTA_CORRIENTE` que falla y se reintenta manda la misma clave.
- [ ] 9.12 Implementar en `ventasApi.ts`, `ventasHooks.ts` y `VentaForm.tsx`. Los tipos nuevos van a mano en `src/shared/api/api.d.ts` (nunca `npm run generate-types`).
- [ ] 9.13 Correr el suite completo de frontend y comparar contra el baseline de 1.2.

## 10. Cierre y documentación

- [ ] 10.1 Correr los dos suites completos y anotar los números finales medidos.
- [ ] 10.2 Documentar en `knowledge-base/09_decisiones_y_supuestos.md` las decisiones nuevas, continuando la numeración desde **D-62**: la clave la genera el cliente y nunca se deriva del contenido; columna con índice único parcial en vez de tabla genérica; la repetición devuelve el recurso con `200` + `Idempotent-Replay` y solo un cuerpo distinto es `409`; la clave no vence; `timeout` de 20s con override de 120s para IA; el `timeout` global sin idempotencia en pagos/facturas/cobros es una exposición conocida hasta C-43.
- [ ] 10.3 Sumar a `knowledge-base/05_reglas_de_negocio.md`, en el dominio Ventas, la regla de que reintentar el registro de una venta no crea una segunda operación.
- [ ] 10.4 Sumar a `knowledge-base/10_preguntas_abiertas.md` lo que la KB no resuelve y decide un humano: cuánto tolera esperar alguien atendiendo el mostrador (el valor de `timeout`), si la persistencia de la clave en `sessionStorage` vale su complejidad, y la deuda descubierta de que el backend no le pone `timeout` a la llamada al proveedor de visión.
- [ ] 10.5 Marcar C-42 en `CHANGES.md` con la fecha de archive.
- [ ] 10.6 Dejar registrada la entrada **C-43** en `CHANGES.md` con el alcance de extender el mecanismo a `POST /api/pagos`, `/api/facturas` y `/api/cobros`, incluyendo el arreglo del `except IntegrityError` pelado de `cliente_service`. No dejarla implícita: mientras no exista, esos tres endpoints están expuestos y el `timeout` global los expone un poco más.
