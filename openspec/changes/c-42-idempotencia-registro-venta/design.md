## Context

El sistema ya en producción registra una venta así: el navegador postea a `/api/ventas`, el service valida el par `(forma_pago, cliente_id)` (D-53/D-54), el repository inserta y el **router** commitea. No hay clase `UnitOfWork`: `app/core/deps.py` dice explícitamente *"Transaction commit is the router's responsibility"*, el service usa `flush()` y el router `commit()`. Ese es el patrón real del repo y este change lo respeta tal cual.

Del lado del cliente, `apiClient` es una instancia única de Axios con `withCredentials` y un interceptor de 401 → refresh (contrato de `auth-frontend`). **Sin `timeout`.** Las mutaciones de TanStack Query corren con `retry: 0`.

Entre esas dos puntas hay un tramo que nadie modela: datos móviles. Cuando ese tramo falla después de que el servidor commiteó, el cliente ve un error indistinguible del caso en que la request nunca llegó, y la persona parada frente al mostrador aprieta "Guardar" otra vez.

Lo que hace que esto sea un problema de plata y no de UX es D-33: la venta fiada no tiene un cargo aparte, **es** el cargo. Duplicarla duplica una deuda con nombre y apellido. Y D-58 cierra la trampa: borrar el duplicado después quita el cargo pero deja los cobros imputados, así que el saldo queda negativo y sin explicación.

Restricciones que condicionan todo lo de abajo:

- **VPS Oracle free tier, 1GB RAM.** No hay scheduler, no hay cron, no hay Redis. Cualquier diseño que necesite un job de limpieza necesita antes infraestructura que no existe.
- **Postgres real en los tests, nunca SQLite** (Regla Dura #12). El comportamiento de un índice único parcial y de un `IntegrityError` bajo concurrencia solo se puede testear contra Postgres.
- **La autorización y el scoping viven en el service layer** (Regla Dura #3 y #8), filtrando por `negocio_id`. Recurso ajeno → 404.
- **El validador de openspec solo lee el primer párrafo de un requirement buscando `SHALL`** (D-59): la oración normativa va primera.

## Goals / Non-Goals

**Goals:**

- Que reintentar un guardado de venta **no pueda** crear una segunda fila, garantizado por la base de datos y no por una comprobación en Python.
- Que el reintento sea **transparente**: la persona ve "guardado", no un conflicto que tenga que interpretar.
- Que el estado "no sé si se guardó" deje de ser invisible y deje de ser un callejón: se nombra, y la salida ofrecida es segura.
- Que el mecanismo sea **repetible** sobre pagos, facturas y cobros sin rediseñarlo.
- Que nada de esto toque las invariantes de negocio ni el camino feliz existente.

**Non-Goals:**

- Proteger `POST /api/pagos`, `/api/facturas` y `/api/cobros`. Es C-43, y su ausencia está declarada como riesgo en el proposal.
- Idempotencia en `PATCH` y `DELETE`.
- Una tabla genérica de requests idempotentes con cuerpo de respuesta serializado (D2).
- Reintento automático. `retry: 0` en mutaciones se mantiene: el mecanismo hace que un reintento **humano** sea seguro, no que la app reintente sola.
- Cola de escrituras offline / outbox en el service worker. Es otra clase de problema.

## Decisions

### D1 — La clave la genera el cliente por intento de guardado; nunca se deriva del contenido

Una clave natural derivada del contenido —hash de `(negocio_id, fecha, monto, forma_pago, cliente_id, notas)` con una ventana de tiempo— es tentadora porque no necesita que el cliente coopere. **Se descarta, y es la decisión más importante del change.**

RN-VTA-06 / D-35 dicen que la granularidad de carga es libre: una fila es "una operación de venta", y vender dos veces $500 en efectivo en el mismo minuto es un caso **normal**, no un error. Una clave natural desduplicaría esas dos ventas reales y perdería plata en silencio. El error que introduce es peor que el que arregla: un duplicado se ve en el listado y se borra; una venta que nunca se guardó no deja rastro de que faltó.

También se descarta que el cliente asigne el **id** de la venta (idempotencia por clave primaria). Rompe D-16 —los ids los genera el servidor como UUIDv7 time-ordered— y ese orden no es decorativo: el desempate de FIFO es `(fecha, created_at, id)`, así que dejar el id en manos del cliente le deja también la posibilidad de alterar el orden de imputación de una cuenta corriente.

Queda: **un UUID aleatorio acuñado por el cliente**, enviado en el header `Idempotency-Key`. Se usa `crypto.randomUUID()` con fallback sobre `crypto.getRandomValues` — el destino son teléfonos baratos con WebViews viejas, y una excepción al acuñar la clave rompería el guardado entero.

El header es **opcional en el contrato**. Hacerlo obligatorio devolvería 400 a los 28 tests de C-33 y a cualquier script existente, a cambio de una garantía que igual depende del cliente. La protección se asegura donde vive: un test del frontend afirma que `createVenta` **siempre** manda la clave, en el espíritu del guard de AST de `test_c28_scoping_axis_guard.py`.

### D2 — La desduplicación es una columna en `venta` con índice único parcial, no una tabla aparte

Las dos opciones reales:

**Tabla dedicada** (estilo Stripe: `idempotency_key`, `status`, `response_code`, `response_body`, `expires_at`). Generaliza a cualquier endpoint sin tocar tablas de negocio y permite guardar la respuesta serializada. Cuesta: dos escrituras por venta, una máquina de estados (in-flight / completed) para el caso concurrente, un cuerpo de respuesta almacenado que **se desactualiza** respecto del recurso real en cuanto alguien edita la venta, y un job de limpieza — sobre un VPS de 1GB sin scheduler. Es infraestructura para un problema que este sistema todavía no tiene.

**Columna en `venta`** (elegida):

```
ALTER TABLE venta ADD COLUMN idempotency_key uuid NULL;

CREATE UNIQUE INDEX uq_venta_negocio_idempotency_key
    ON venta (negocio_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;
```

El registro de desduplicación **es** el recurso, así que no pueden discrepar: no hay respuesta guardada que se desactualice, la réplica se sirve leyendo la venta real. Una sola escritura. Sin limpieza: la clave vive lo que vive la fila.

El índice es parcial solo sobre `idempotency_key IS NOT NULL`, porque en Postgres los `NULL` no colisionan entre sí pero el predicado hace explícito que las 100% de las filas actuales quedan fuera del índice, y mantiene el índice del tamaño de lo que realmente indexa.

**Deliberadamente NO lleva `WHERE deleted_at IS NULL`**, a diferencia del índice único de cliente (D-44). Ahí el predicado libera el nombre para poder volver a dar de alta a alguien; acá liberar la clave significaría que un reintento tardío, después de que alguien borró la venta, **crea una segunda**. La clave la consume la operación, no el ciclo de vida del recurso.

El costo se paga por entidad: extender a pagos/facturas/cobros es una columna y un índice por tabla. Es más repetición que una tabla genérica, y a cambio cada entidad queda sin dependencias de infraestructura. Con 3 repeticiones pendientes y ninguna lógica divergente entre ellas, la repetición es aceptable; si llegaran a ser diez, la tabla genérica se justifica.

### D3 — La carrera la resuelve la base, y el `IntegrityError` se traduce a réplica

Nada de "consultar y después insertar": entre las dos operaciones hay una ventana, y dos taps sobre el mismo botón la encuentran. El flujo es el mismo que fijó D-45 para clientes:

1. `INSERT` con la clave.
2. Si la base acepta → venta creada, `201`.
3. Si viola `uq_venta_negocio_idempotency_key` → `rollback()`, buscar la venta por `(negocio_id, idempotency_key)` y responder con ella.

El caso concurrente sale gratis: la request B que inserta la misma clave mientras A todavía no commiteó **bloquea** en el índice único hasta que A termina, y recién ahí recibe la violación. En una transacción de milisegundos eso es imperceptible; conviene saber que existe porque en un VPS lento el bloqueo se nota.

Dos detalles que hay que hacer bien o el mecanismo falla en producción y no en los tests:

- **Después de un `IntegrityError` la sesión queda envenenada.** Cualquier statement posterior tira `PendingRollbackError` hasta que se haga `rollback()`. Por eso el `rollback()` va antes de la relectura, exactamente como en `cliente_service.crear`.
- **Hay que distinguir cuál índice se violó.** `cliente_service` hoy captura un `IntegrityError` pelado y asume que es el nombre duplicado — una suposición que era cierta cuando `cliente` tenía un solo índice único y que se rompe sola en cuanto se le agregue idempotencia. Por eso `app/services/idempotencia.py` expone una función que devuelve el **nombre de la constraint violada** leyendo `err.orig.diag.constraint_name` (psycopg2), y `venta_service` compara contra el nombre exacto. Si la violación es otra, se re-eleva. Es lo único genuinamente compartible del mecanismo, y es una trampa real, no una abstracción preventiva.

### D4 — Una repetición devuelve la venta original con `200`; solo un cuerpo distinto es conflicto

**La repetición devuelve el recurso original.** El objetivo entero es que el reintento sea invisible: si devolviera 409, la UI tendría que traducir "conflicto" a "en realidad salió bien", y cualquier error en esa traducción le muestra un fallo a alguien cuya venta sí se guardó. El 409 obliga a razonar del lado equivocado.

El status es **`200 OK`, no `201 Created`**, porque esta request no creó nada. La ruta declara `status_code=201`, así que el override se hace inyectando `Response` y seteando `response.status_code = 200` en la rama de réplica. Se agrega además el header **`Idempotent-Replay: true`**, que es lo único que le permite al cliente decir "ya estaba registrada" en vez de "registrada" — el cuerpo es idéntico y no alcanza para distinguir.

**Misma clave, cuerpo distinto → `409`.** Devolver la venta vieja le diría "guardado" a alguien que corrigió el monto y cuya corrección se descartó. El `detail` lleva la venta existente, siguiendo la forma de `cliente_existente` de C-32 (D-45), para que la UI pueda mostrarla en lugar de un error seco.

La comparación se hace **contra los campos de la venta guardada** (`monto`, `fecha`, `forma_pago`, `cliente_id`, `notas`), después de la validación de Pydantic para que `notas` ya venga normalizada. No se guarda un hash del request: sería otra columna, y comparar contra la fila real cuesta cero porque la fila ya está leída.

Eso tiene una consecuencia que conviene aceptar en vez de esconder: si la venta fue **editada** después de crearse, un reintento tardío con el payload original ve una diferencia y responde 409. Es un borde de un borde, y por eso el mensaje del 409 es neutro —"esta operación ya fue registrada con otros datos"— y no afirma quién cambió qué. Un mensaje que diga "mandaste datos distintos" sería mentira en ese caso.

**Clave cuya venta fue borrada → `409`**, no una réplica. `VentaResponse` no expone `deleted_at`, así que devolver la fila borrada la haría pasar por viva. El 409 dice la verdad: la operación ya ocurrió y la venta ya no está.

**La clave nunca vence.** Un vencimiento parece prolijo y su modo de falla es exactamente el bug que este change arregla: pasada la ventana, la misma clave vuelve a crear filas, en silencio. Como la clave vive en la fila de la venta, no vencer no cuesta nada — ~16 bytes y una entrada de índice por venta. Un negocio con 100 ventas por día genera ~36k filas al año; el índice es del orden de cientos de KB. No hay nada que limpiar.

### D5 — El `timeout` de Axios: 20s global, 120s para IA

Sin `timeout`, una request puede quedar colgada hasta que el sistema operativo corte, y en ese lapso la persona ya decidió que la app está rota.

Un `timeout` agresivo (5s) es peor que no tenerlo: **fabrica exactamente la ambigüedad que este change vino a eliminar**, abortando requests que iban a salir bien y convirtiendo cada venta lenta en un "¿se guardó?". Uno muy laxo (60s+) deja a alguien mirando un spinner con un cliente esperando, y ahí el botón se aprieta igual.

**20 segundos.** El `POST /api/ventas` hace un decode de JWT, un `SELECT` de usuario, como mucho un `SELECT` de cliente, un `INSERT`, el commit y un `refresh`: todo indexado y chico, con un p99 en caliente muy por debajo del medio segundo aun en el free tier. 20s es unas 40 veces eso, así que solo dispara ante un estancamiento real —radio perdida, contenedor frío, red que se cayó a mitad— y no ante lentitud. Y sigue estando dentro de lo que una persona espera de pie.

El punto que hace defendible elegir el valor por criterio humano y no por corrección: **con idempotencia, una request abortada que en realidad se guardó ya no hace daño** — el reintento devuelve la original. El `timeout` deja de ser una decisión de integridad y pasa a ser una de paciencia.

**El global de 20s rompería la IA de visión si se aplicara a ciegas.** `iaVisionApi.ts` postea a `/facturas/extraer-ia` y `/pagos/extraer-ia` sobre la **misma** `apiClient`, y esas llamadas esperan a un modelo de visión: decenas de segundos es normal. Por eso las dos llamadas de IA pasan un `timeout: 120000` explícito por request. Anotado sin arreglar acá: el backend no configura ningún `timeout` sobre el SDK del proveedor de visión, así que hasta ahora el techo de esas requests era **ninguno** de los dos lados.

El `timeout` no interfiere con el interceptor de 401: un error de timeout no trae `response`, así que la guarda `error.response?.status !== 401` lo rechaza de inmediato. El contrato de `auth-frontend` sobre el cliente Axios (credenciales + refresh único en vuelo) queda intacto; esto agrega una propiedad, no cambia ninguna.

### D6 — El resultado de un submit tiene cuatro estados, y hoy se ven todos igual

La clasificación vive en un helper puro y testeable, no desparramada en el `onError` del formulario:

| Resultado | Cómo se reconoce | Qué significa |
|---|---|---|
| **Creada** | `201` | Se guardó ahora |
| **Ya registrada** | `200` + `Idempotent-Replay: true` | Se había guardado antes; este intento no hizo nada |
| **Rechazada** | `4xx` con respuesta | No se guardó nada. Se muestra el mensaje del backend |
| **Desconocida** | sin `response` (timeout, red), o `500` / `502` / `503` / `504` | Puede haberse guardado o no |

Los 5xx van a "desconocida" a propósito: un `502`/`504` de un proxy puede llegar **después** de que la app commiteó, y un `500` puede dispararse después del commit. Tratarlos como "no se guardó" invita al mismo duplicado por otro camino.

En pantalla:

- **Creada** → lo de siempre: éxito y navegación.
- **Ya registrada** → éxito y navegación igual, pero el mensaje dice que la venta **ya estaba registrada**. Nunca un error para una venta que existe.
- **Rechazada** → el `detail` del backend, como hoy.
- **Desconocida** → deja de ser un error genérico. Dice que no se pudo confirmar si se guardó, que **volver a intentar es seguro porque la app recuerda este intento**, y ofrece el reintento como acción principal. El formulario conserva todo lo cargado. Después de reintentos fallidos se ofrece además ir al listado de ventas, que es la única forma de que la persona lo verifique con sus propios ojos.

La frase "volver a intentar es seguro" solo es cierta si D7 se cumple. Es literalmente el contrato entre las dos decisiones.

### D7 — La clave se reutiliza en el reintento; si el payload cambia, se acuña otra

Este es el punto único de falla del change. Un reintento con clave nueva es un duplicado con más pasos.

La regla: **la clave se acuña en el primer submit de un payload y se reutiliza mientras se reintente ese mismo payload.** Si el usuario corrige cualquier campo y vuelve a mandar, ya es otra intención y le corresponde otra clave — lo que además vuelve prácticamente inalcanzable el 409 de D4 desde nuestra propia UI, dejándolo como lo que debe ser: una guarda contra un cliente con bug.

Implementación: se guarda `{ key, payload }` del intento pendiente; en cada submit se compara el payload nuevo contra el guardado y se reutiliza o se acuña. Se descarta al confirmarse el éxito (creada o ya registrada) y en el 409.

**Se espeja en `sessionStorage`.** Con solo un `ref` de React, un reload de la pestaña entre el fallo y el reintento pierde la clave y el agujero se reabre — y una PWA en un teléfono barato con poca memoria es justamente donde el sistema operativo mata la pestaña. Es la mitad del escenario que motivó el change, así que entra. Se guarda una sola entrada, se borra al confirmarse el resultado, y `sessionStorage` (no `localStorage`) acota la vida al de la pestaña. Está aislado en `src/shared/api/idempotency.ts` y en su propio grupo de tasks: si en la revisión se decide que no vale la complejidad, se saca sin desarmar nada más, con la consecuencia declarada de que un reload reabre la ventana.

### D8 — El scoping de la búsqueda por clave es `negocio_id`, en el service layer

La unicidad es `(negocio_id, idempotency_key)` y **toda** lectura por clave filtra por `negocio_id` en el service (Regla Dura #3). Dos consecuencias, las dos deseadas: dos negocios pueden usar la misma clave y cada uno crea su venta sin ver la del otro; y una clave adivinada no puede devolver la venta de otra cuenta. Sin ese filtro, esto sería una fuga de datos entre cuentas disfrazada de mecanismo de resiliencia. Tiene escenario de spec propio.

### D9 — Migración 0012, reservada por adelantado

La cabeza actual es `0011` (cobro_cliente, C-35). C-42 toma **0012** y lo deja escrito acá antes de codear, siguiendo D-46. Ninguno de los changes pendientes (C-36 a C-41) agrega migración, así que no hay colisión; si C-37 llegara a necesitar un índice, toma 0013.

La migración agrega una columna nullable y un índice único parcial que al correr indexa **cero filas**. Sin backfill, sin reescritura de tabla, sin posibilidad de que una fila existente lo viole. `downgrade` limpio: dropea el índice y la columna. Test de migración con revisiones fijas (`0012` / `0011`), nunca `head` (D-21), y ciclo upgrade → downgrade → upgrade.

## Risks / Trade-offs

- **El `timeout` global protege a todos y la idempotencia a uno solo** → un timeout en `/api/pagos` ahora es un error explícito que invita a reintentar sobre un endpoint que no desduplica. Mitigación: el copy del estado "desconocido" en endpoints **no** protegidos dice "revisá el listado antes de volver a intentar" y no ofrece el reintento como acción principal; y C-43 entra inmediatamente después. Es el riesgo más importante del change.
- **Si el reintento acuña una clave nueva, no se arregló nada y parece arreglado** → tests dedicados a la reutilización (D7), no solo al envío del header; y un test que afirma que el segundo POST del mismo payload lleva la misma clave.
- **La comparación de payload puede dar 409 sobre una venta editada** (D4) → mensaje neutro que no afirma quién cambió qué, y la venta existente en el `detail` para que la UI la muestre.
- **`cliente_service` captura un `IntegrityError` pelado** → hoy funciona porque `cliente` tiene un solo índice único. Cuando C-43 le agregue idempotencia, ese `except` empieza a tragarse la violación equivocada. `idempotencia.py` existe para eso; C-43 debe usarlo también en `cliente_service`.
- **`sessionStorage` puede no estar disponible** (modo privado en algunos navegadores, storage lleno) → el acceso va envuelto en `try/catch` y degrada a solo-memoria. Perder la persistencia no puede romper el guardado.
- **Un `IntegrityError` mal manejado deja la sesión envenenada** y el próximo statement tira `PendingRollbackError`, un error que en producción se ve como un 500 sin relación con ventas → el `rollback()` antes de la relectura tiene test propio, incluyendo el caso de que después del rollback la request siga pudiendo leer.
- **El bloqueo de la segunda request concurrente** dura lo que dure la transacción de la primera. En un VPS de 1GB con la base cargada eso puede ser cientos de milisegundos. Es correcto y es el precio de que la base garantice la regla en lugar de Python.
- **Un header opcional se puede olvidar en un call site nuevo** → el guard de test del frontend sobre `createVenta`; y como el mecanismo no da error cuando falta la clave, el guard es la única señal. Está anotado como tal en el código.

## Migration Plan

1. Aprobación humana de este diseño (governance ALTO) antes de escribir código.
2. Backend con la app detenida: `alembic upgrade 0012`. Segundos, sin backfill.
3. Deploy del backend. `POST /api/ventas` sin header se comporta exactamente como hoy, así que el frontend viejo sigue funcionando: **el orden backend→frontend es seguro y el inverso no**.
4. Deploy del frontend (clave + `timeout` + estados de resultado).
5. Rollback: revertir el frontend basta para volver al comportamiento anterior. Si además hay que revertir el backend, `alembic downgrade 0011` dropea índice y columna; las ventas creadas con clave sobreviven intactas porque la clave nunca fue parte de su significado.

## Open Questions

Ninguna bloquea la implementación. Dos son decisiones de producto que un humano debería confirmar y que son candidatas a `10_preguntas_abiertas.md`:

1. **¿Cuánto debe esperar el mostrador?** Los 20s de D5 están razonados contra el perfil del endpoint y contra el hábito de una persona esperando, no medidos contra el VPS real bajo datos móviles. Si al usarlo aparece que 20s es largo o corto, se ajusta con evidencia. La decisión de negocio de fondo es cuánto tolera alguien atendiendo antes de dudar de la app.
2. **¿La persistencia de la clave en `sessionStorage` (D7) vale su complejidad?** Cubre el reload / la pestaña matada por el sistema operativo, que es parte del escenario que motivó el change, a cambio de ~20 líneas y su manejo de errores. Está aislada para poder sacarse; sacarla reabre esa ventana.

Y una que no es de este change pero se descubrió mirándolo: **el backend no le pone `timeout` a la llamada al proveedor de visión.** Hasta ahora no había techo de ningún lado; después de C-42 el techo lo pone el cliente con 120s. Es una deuda del backend, no de C-42.
