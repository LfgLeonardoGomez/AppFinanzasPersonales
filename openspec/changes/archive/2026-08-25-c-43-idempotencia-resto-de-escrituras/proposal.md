## Why

C-42 construyó el mecanismo de idempotencia y lo aplicó a **una sola** escritura: `POST /api/ventas`. Las otras tres escrituras de registro del sistema —`POST /api/pagos`, `POST /api/facturas`, `POST /api/cobros`— siguen sin desduplicar: un reintento crea una segunda fila, exactamente el bug que C-42 arregló para ventas.

Y quedaron **peor** que antes del change, no mejor. C-42 sumó un `timeout` de 20s a la instancia Axios compartida, que es transversal: ahora una request estancada a `/api/pagos` se aborta del lado del cliente mientras el servidor puede estar commiteando, y la persona ve un error donde antes veía un spinner. La única mitigación hoy es **copy**: `PagoForm.tsx:403` y `FacturaForm.tsx:407` piden revisar el listado antes de reintentar y no ofrecen el reintento como acción principal. Eso es honesto, pero es pedirle a la persona que haga a mano lo que el sistema debería garantizar — y en el mostrador, con un cliente esperando, nadie va al listado.

Lo que cuesta cada duplicado:

- **Pago duplicado** → infla el pool de pagos del proveedor, y vía FIFO (RN-FIFO) marca como `PAGADA` una factura que no lo está. El negocio cree que no debe algo que sí debe, y el error aparece recién cuando el proveedor reclama.
- **Cobro duplicado** → acredita dos veces lo mismo en la cuenta corriente del cliente. Como el saldo es signado y puede ir a negativo (D-58), el resultado es un cliente al que el sistema le dice que el negocio le debe plata.
- **Factura duplicada** → duplica la deuda con el proveedor y desordena el FIFO de todo ese proveedor, no solo de esa factura.

Encima, la variante de cobros tiene un modo de falla que ventas no tenía y que **la receta de C-42 copiada al pie de la letra no arregla**: la validación de saldo (RN-CCC-04, D-37) es una validación **con estado**. Un cobro que cancela más de la mitad de lo adeudado —el caso más común, saldar la cuenta— consume el saldo, y el reintento legítimo choca contra `monto > disponible` y recibe un `422 "El pago supera el saldo pendiente. Saldo disponible: 0.00."` **antes** de llegar al `INSERT` que lo habría reconocido como repetición. A la persona se le rechaza una operación que sí se guardó, y la salida obvia —cargar un monto menor— produce un cobro parcial duplicado. Ver design.md D2.

Este change cierra la deuda que C-42 declaró en voz alta y que `CHANGES.md` dejó anotada como C-43.

## What Changes

El change se entrega en **dos fases**, y el límite entre ellas es duro: **Fase A no toca un solo archivo del frontend** y es verificable, deployable y reversible sola.

### Fase A — Backend (`facturas-proveedores-api`), ejecutable ya

- `POST /api/pagos`, `POST /api/facturas` y `POST /api/cobros` aceptan el header **opcional** `Idempotency-Key` (UUID) y honran el contrato completo de `escritura-idempotente`: repetición con los mismos datos → `200` + `Idempotent-Replay: true` con el recurso original; misma clave con datos distintos → `409` con el recurso existente en el `detail`; sin header, el comportamiento es byte por byte el de hoy.
- Nuevas columnas `pago.idempotency_key`, `factura.idempotency_key` y `cobro_cliente.idempotency_key` (uuid, nullable), cada una con su **índice único parcial** `(negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. Migración **0013**, una sola revisión para las tres tablas.
- **`cobro_cliente_service.crear` invierte el orden respecto de C-42**: busca la clave *antes* de correr la validación de saldo, porque esa validación es con estado y rechazaría una repetición legítima. La unicidad la sigue garantizando el índice; el `INSERT` + `IntegrityError` sigue siendo el camino que resuelve la concurrencia. Ver design.md D2.
- **`factura_service.crear` arma la respuesta de la repetición por el mismo camino que la creación**: recalcula el `estado` FIFO y relee los `items` en el momento de responder. La repetición devuelve el recurso **como está ahora**, no una copia congelada de la respuesta original (design.md D4).
- La comparación "mismos datos" de facturas **incluye los items**: una línea corregida es exactamente la corrección que no puede tragarse en silencio.
- `cliente_service.crear` deja de capturar un `IntegrityError` pelado y pasa a comparar el nombre de la constraint contra `uq_cliente_negocio_nombre_normalizado_activo` vía `app/services/idempotencia.py`. Hoy funciona por accidente —`cliente` tiene un solo índice único— y reportaría "nombre duplicado" ante cualquier otra violación en cuanto tenga dos.

### Fase B — Frontend (`facturas-proveedores-web`), bloqueada

Bloqueada por dos cosas: Fase A tiene que estar deployada, y el tramo de **cobros depende de C-36**, que es quien crea el formulario de cobro (hoy no existe: `features/cuenta-corriente/` es el de proveedores, C-13).

- `createPago` y `createFactura` mandan `Idempotency-Key` reutilizando la clave del intento vía `getIdempotencyKey` / `confirmIdempotencyKey` (ya genéricos por namespace desde C-42) y clasifican el resultado con `classifySuccess` / `classifyError`.
- Se **retira el copy interino** de `PagoForm` y `FacturaForm`: una vez protegidos, el estado desconocido ofrece el reintento como acción principal y dice que debería ser seguro, igual que `VentaForm`.
- El formulario de cobro que entregue C-36 nace con la clave cableada. **Este change no escribe un delta spec para la capability de frontend de cobros** — esa capability la crea C-36 y escribirla acá sería un conflicto garantizado. El requisito que la obliga vive en `escritura-idempotente`, que es transversal.

### Fuera de alcance

- Idempotencia en `PATCH` y `DELETE`. `PATCH` con el mismo cuerpo es naturalmente idempotente y `DELETE` sobre un soft delete también.
- Idempotencia en `POST /api/clientes`. El alta de cliente ya está desduplicada por su propio índice único de nombre normalizado (C-32): un doble submit devuelve `409` con el cliente existente, que es la respuesta correcta. Acá solo se arregla el `except`.
- Una tabla genérica de idempotencia con cuerpo de respuesta serializado. Sigue vigente el rechazo de C-42 (design.md D2 de C-42), y este change agrega un argumento nuevo a favor: la respuesta de una factura contiene `estado` derivado, que no se puede congelar sin mentir.
- Los endpoints de extracción por IA (`/facturas/extraer-ia`, `/pagos/extraer-ia`). No persisten nada (RN-IA-04), así que no hay nada que duplicar.

## Capabilities

### New Capabilities

Ninguna. C-42 ya creó `escritura-idempotente`; este change la aplica donde faltaba.

### Modified Capabilities

- `escritura-idempotente`: se admite explícitamente un caso que el contrato de C-42 no contemplaba —una escritura protegida cuya validación depende del estado que ella misma modifica— y se fija cómo se resuelve sin debilitar la garantía de la base. Se agrega además que la promesa de "reintentar es seguro" solo puede hacerse sobre una escritura efectivamente protegida, y que la mitad de cliente del mecanismo no es opcional.
- `pagos-backend`: `POST /api/pagos` pasa a ser una escritura protegida.
- `facturas-api`: `POST /api/facturas` pasa a ser una escritura protegida, con la repetición armada al momento de responder (estado FIFO recalculado, items releídos) y la comparación de datos extendida a los items.
- `cuenta-corriente-clientes-backend`: `POST /api/cobros` pasa a ser una escritura protegida, y la validación de saldo de RN-CCC-04 deja de poder rechazar una repetición legítima.
- `clientes-backend`: el `409` de nombre duplicado SHALL emitirse solo cuando la constraint violada es efectivamente la del nombre normalizado.
- `pagos-frontend` (Fase B): el formulario de pago reutiliza la clave al reintentar y retira el copy interino de "revisá el listado".
- `facturas-frontend` (Fase B): ídem para el formulario de factura.

## Impact

**Backend (Fase A)** — `app/models/pago.py`, `app/models/factura.py`, `app/models/cobro_cliente.py`, `app/services/pago_service.py`, `app/services/factura_service.py`, `app/services/cobro_cliente_service.py`, `app/services/cliente_service.py`, `app/services/idempotencia.py`, `app/repositories/pago_repository.py`, `app/repositories/factura_repository.py`, `app/repositories/cobro_cliente_repository.py`, `app/routers/pagos.py`, `app/routers/facturas.py`, `app/routers/cobros.py`, `alembic/versions/20240013_0013_idempotency_pago_factura_cobro.py` (nuevo), `tests/`.

**Frontend (Fase B)** — `src/features/pagos/api/pagosApi.ts`, `src/features/pagos/components/PagoForm.tsx`, `src/features/facturas/api/facturasApi.ts`, `src/features/facturas/components/FacturaForm.tsx`, y el `cobrosApi` / formulario de cobro que entregue C-36. **Ningún cambio en `src/shared/api/`**: `idempotency.ts` y `submitOutcome.ts` ya son genéricos, y `client.ts` ya tiene el `timeout`. **Ningún cambio en `api.d.ts`**: la clave no se expone en ninguna respuesta, así que no hay tipo de wire nuevo.

**Migración sobre base viva.** La 0013 agrega tres columnas nullable y tres índices únicos parciales que al correr indexan **cero filas**. Sin backfill, sin reescritura de tabla, sin posibilidad de que una fila existente los viole. Aun así toca las tres tablas que registran la plata del negocio: se corre con la app detenida.

**Riesgo — copiar la receta de C-42 al pie de la letra rompe cobros.** Es el riesgo central del change y la razón de que exista un diseño y no solo tasks. La validación de saldo corre antes del `INSERT` en el orden de C-42, y sobre una repetición ve el saldo **ya consumido**: cualquier cobro que cancele más de la mitad de lo adeudado recibiría un `422` diciendo que supera el saldo pendiente, sobre una operación que sí se guardó. Es peor que el duplicado que veníamos a evitar, porque empuja a la persona a "corregir" el monto. Mitigación: el orden se invierte solo en cobros y tiene tests propios (design.md D2).

**Riesgo — Fase A protege el backend y la persona sigue viendo el copy viejo.** Entre el deploy de Fase A y el de Fase B, los tres endpoints desduplican pero ningún formulario manda la clave, así que en la práctica nada cambió para el usuario. Es un estado intermedio seguro (no rompe nada) pero **no** entrega el valor: Fase A sin Fase B es infraestructura sin usuario. Queda dicho para que nadie cierre el change en Fase A.

**Riesgo — la repetición de una factura puede devolver un `estado` distinto al de la creación.** Si entre el intento original y el reintento entró un pago, el FIFO cambió y la respuesta de la repetición lo refleja. Es **correcto** —`estado` es derivado y nunca persistido (RN-FAC-09, D-01)— pero rompe la expectativa intuitiva de que una repetición devuelve bytes idénticos. Declarado como no-goal explícito en design.md D4, con escenario de spec propio.

**Riesgo — colisión con C-36, que corre en paralelo.** Fase A tiene superficie de conflicto **cero** con C-36: C-36 es frontend puro y Fase A es backend puro. En Fase B la única superficie es el `cobrosApi` / formulario que C-36 crea, y por eso ese tramo espera a que C-36 archive. La numeración de migración también está limpia: C-36 no agrega ninguna, así que 0013 no compite con nadie.

**No toca ninguna invariante del proyecto.** No se persiste saldo ni estado (`idempotency_key` no es un valor derivado; el `estado` FIFO de facturas se sigue calculando on-demand). No aparece `factura_id` en ningún pago. El scoping sigue siendo `negocio_id` en el service layer, y la búsqueda por clave lo respeta — el guard de AST `tests/test_c28_scoping_axis_guard.py` no se toca ni se relaja. El cobro sigue sin escribir en `venta` (D-34) y sigue sin poder generar saldo a favor (D-37).

**Governance: ALTO.** Se tocan las tres tablas que registran la plata del negocio y el camino por el que se calcula lo que se debe y lo que se cobró. La propuesta y el diseño se aprueban antes de escribir código.
