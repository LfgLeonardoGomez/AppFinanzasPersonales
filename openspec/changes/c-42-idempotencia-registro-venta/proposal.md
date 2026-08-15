## Why

C-34 entregó la pantalla de ventas y una revisión adversarial de resiliencia encontró, sobre el código ya archivado, un agujero que termina en la deuda de una persona real.

`POST /api/ventas` no tiene ninguna forma de reconocer que dos requests son **el mismo intento**. Sobre eso se apilan cuatro hechos del código actual:

1. `facturas-proveedores-web/src/features/ventas/api/ventasApi.ts:58` — `createVenta` postea sin clave de idempotencia ni identificador de request.
2. `facturas-proveedores-web/src/app/main.tsx:35-37` — las mutaciones corren con `retry: 0`. Eso está **bien** (evita una tormenta de reintentos automáticos), pero significa que la app nunca distingue "la request no llegó" de "llegó, se guardó y se perdió la respuesta".
3. `facturas-proveedores-web/src/shared/api/client.ts:82-88` — la instancia de Axios **no tiene `timeout`**. Con datos móviles inestables una request puede quedar colgada indefinidamente.
4. `facturas-proveedores-web/src/features/ventas/components/VentaForm.tsx:245-253` — ante el error se muestra un mensaje genérico, el botón se vuelve a habilitar y los datos siguen cargados. La única jugada visible es apretar "Guardar" de nuevo.

El resultado es una segunda fila en `venta`. Cuando la venta era fiada (`forma_pago = CUENTA_CORRIENTE` + `cliente_id`), esa fila **es** un cargo en la cuenta corriente del cliente (D-33): al cliente se le cobra dos veces, y el número duplicado es el que se le muestra cuando pregunta cuánto debe.

Peor todavía: el desastre no es reversible de forma limpia. Borrar el fiado duplicado más tarde quita el cargo pero **deja los cobros ya imputados**, y el saldo del cliente queda negativo (D-58, hallazgo de C-35). Un duplicado de hoy es un saldo que no cierra mañana y que nadie puede explicar.

El contexto de despliegue es exactamente el peor caso para esto: una PWA usada sobre el mostrador, en un teléfono, con datos móviles, contra FastAPI en un VPS Oracle free tier de 1GB.

Este change existe para proteger, en la capa de transporte, la garantía que D-33 dio en el modelo: **una operación de venta es una fila, y volver a intentarla no crea otra.**

## What Changes

**Backend (`facturas-proveedores-api`)**

- `POST /api/ventas` acepta un header **opcional** `Idempotency-Key` (UUID). Es opcional en el contrato para no romper clientes ni los 28 tests de C-33; es **obligatorio en nuestro cliente**, y eso lo asegura un test del frontend.
- Nueva columna `venta.idempotency_key` (uuid, nullable) + **índice único parcial** `(negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. La desduplicación la garantiza la base, no un `SELECT` previo en Python. Migración **0012** (reservada por adelantado, D-46).
- Una request repetida con la misma clave **devuelve la venta original** con `200 OK` y el header `Idempotent-Replay: true` — no crea nada, no falla. Un reintento es transparente.
- Misma clave con datos distintos → **409** con la venta existente en el `detail`, siguiendo el precedente de `cliente_existente` de C-32 (D-45). Nunca devuelve la original haciéndola pasar por la nueva.
- Nuevo módulo `app/services/idempotencia.py` con lo único que es genuinamente compartible: reconocer **cuál** índice único fue violado. Es la trampa que hoy tiene `cliente_service` (captura un `IntegrityError` pelado y asume que es el nombre duplicado).
- `main.py`: `Idempotency-Key` sumado a `allow_headers` de CORS.

**Frontend (`facturas-proveedores-web`)**

- `createVenta` manda `Idempotency-Key`. La clave se **acuña una vez por intento de guardado** y se **reutiliza en el reintento del mismo payload**; si el usuario edita cualquier campo, se acuña una nueva. Reutilizar la clave es todo el mecanismo: sin eso el header es decorativo.
- La clave sobrevive a un reload de la pestaña (espejada en `sessionStorage`, borrada al confirmarse el éxito).
- **`timeout` global de 20s** en la instancia Axios compartida, con override explícito de **120s** en los endpoints de extracción por IA — que hoy corren sobre la misma instancia sin techo y tardan legítimamente decenas de segundos.
- Clasificación explícita del resultado de un submit: **creado** (201), **ya estaba registrado** (200 + replay), **rechazado** (4xx, no se creó nada) y **desconocido** (timeout, error de red, 500/502/503/504). Hoy los cuatro se ven igual.
- El estado "desconocido" deja de ser un error genérico: dice que no se sabe si se guardó, que volver a intentar **es seguro**, y ofrece el reintento como acción principal. El formulario no se limpia.

**Fuera de alcance (y su consecuencia, dicha en voz alta)**

- **`POST /api/pagos`, `POST /api/facturas` y `POST /api/cobros` quedan expuestos al mismo doble submit.** C-42 establece el mecanismo y lo aplica a ventas; extenderlo es un repeat mecánico y queda como **C-43**. Ver la nota de riesgo en Impact: el `timeout` global, que es transversal, **empeora** la exposición de esos tres si se lo lee como una invitación a reintentar.
- No hay clave de idempotencia en `PATCH` ni en `DELETE`. `PATCH` con el mismo cuerpo es naturalmente idempotente y `DELETE` sobre un soft delete también.
- No hay tabla genérica de idempotencia con cuerpo de respuesta serializado ni job de limpieza. Ver design.md D2.

## Capabilities

### New Capabilities
- `escritura-idempotente`: el contrato transversal de una escritura protegida — el header, la semántica de repetición (réplica vs. conflicto), la desduplicación garantizada por la base y no por código, el aislamiento por `negocio_id`, la ausencia deliberada de vencimiento, y del lado del cliente el ciclo de vida de la clave, el `timeout` y la clasificación del resultado de un submit.

### Modified Capabilities
- `ventas-backend`: `POST /api/ventas` pasa a ser una escritura protegida. Una request repetida deja de crear una segunda venta.
- `ventas-frontend`: el formulario de venta reutiliza la clave al reintentar y distingue en pantalla los cuatro resultados posibles de un guardado.

## Impact

**Backend** — `app/models/venta.py`, `app/schemas/venta.py`, `app/services/venta_service.py`, `app/routers/ventas.py`, `app/services/idempotencia.py` (nuevo), `app/main.py`, `alembic/versions/20240012_0012_venta_idempotency_key.py` (nuevo), `tests/`.

**Frontend** — `src/shared/api/client.ts`, `src/shared/api/idempotency.ts` (nuevo), `src/features/ia-vision/api/iaVisionApi.ts`, `src/features/ventas/api/ventasApi.ts`, `src/features/ventas/api/ventasHooks.ts`, `src/features/ventas/components/VentaForm.tsx`, `src/shared/api/api.d.ts`.

**Migración sobre base viva.** La 0012 agrega una columna nullable y un índice único **parcial** sobre filas con `idempotency_key IS NOT NULL` — que al momento de correr son cero. No hay backfill, no hay reescritura de tabla, no hay riesgo de que una fila existente viole el índice. Es lo más barato que puede ser una migración de este tipo, y aun así toca la tabla que registra la facturación: se corre con la app detenida.

**Riesgo — el `timeout` global sin idempotencia es peor que no tener `timeout`.** Hoy una request colgada a `/api/pagos` termina sucediendo o el usuario se cansa. Con un `timeout` de 20s la request se aborta del lado del cliente mientras el servidor puede estar commiteando, y al usuario se le muestra un error que lo invita a reintentar — sobre un endpoint que **no** sabe desduplicar. El cambio de `timeout` es transversal y el de idempotencia no: esa asimetría es deliberada (ver design.md D5) y se paga con dos cosas obligatorias — el copy de error en endpoints no protegidos dice "revisá el listado antes de volver a intentar", nunca "reintentá", y C-43 va inmediatamente después de este change.

**Riesgo — una clave que no se reutiliza no protege nada.** Si el reintento acuña una clave nueva, todo el mecanismo es un header que se ignora y el sistema queda exactamente como está, pero con la apariencia de estar arreglado. Es el punto único de falla del change y por eso la reutilización tiene tests propios, no solo el envío del header.

**Riesgo — la réplica no puede cruzar negocios.** La búsqueda por clave se filtra por `negocio_id` en el service layer (Regla Dura #3): una clave repetida entre dos negocios crea la venta de cada uno y ninguno ve la del otro. Sin ese filtro, una clave adivinada sería una fuga de datos entre cuentas. Tiene escenario de spec propio.

**No toca ninguna invariante del proyecto.** No se persiste saldo ni estado (`idempotency_key` no es un valor derivado). No aparece `factura_id` en ningún lado. El scoping sigue siendo `negocio_id` en el service layer. Y el fiado se sigue registrando con una sola escritura — este change existe justamente para que sea **una**.

**Governance: ALTO.** No hay auth ni cambio del eje de aislamiento, pero se toca la tabla que registra la facturación y el camino por el que se crea la deuda de un cliente. La propuesta y el diseño se aprueban antes de escribir código.
