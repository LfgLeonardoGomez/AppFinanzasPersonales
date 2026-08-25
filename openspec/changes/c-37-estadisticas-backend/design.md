## Context

Las dos fuentes ya tienen la misma forma, y eso no es casualidad: D-35 lo anotó como consecuencia útil de haber modelado la venta como una fila por operación. `Factura` aporta `(negocio_id, proveedor_id, fecha_emision, monto_total, deleted_at)`; `Venta` aporta `(negocio_id, fecha, monto, forma_pago, deleted_at)`. Agrupar por período es la misma operación de los dos lados, y contrastar compras contra ventas queda trivial porque ambos lados devuelven la misma estructura.

Tres hechos del esquema que mandan sobre el diseño:

- **`fecha` y `fecha_emision` son columnas `date`, no `datetime`.** Verificado en `app/models/venta.py:60` y `app/models/factura.py:49`. Una fecha no tiene zona horaria, así que el corte de período es aritmética pura.
- **Las dos tablas tienen soft delete.** Una fila borrada no puede contar, por la misma razón por la que no cuenta en el saldo.
- **El eje de aislamiento es `negocio_id`** (D-27), denormalizado en las dos tablas, así que la agregación filtra sin joins.

Restricción de entorno: el VPS es Oracle Free Tier con **1 GB de RAM**. No hay caché, no hay scheduler, no hay tabla de totales precalculados — ni hace falta, si las queries son agregaciones indexadas.

## Goals / Non-Goals

**Goals:**

- Contestar "cuánto compré" y "cuánto vendí" por período, con un solo camino de cálculo para las dos.
- Que el desglose por forma de pago **sume el total**, siempre, por construcción.
- Que las series salgan listas para graficar, sin que el frontend tenga que rellenar huecos ni ordenar nada.

**Non-Goals:**

- **Frontend.** C-38 dibuja esto.
- **Márgenes, rentabilidad o costo de mercadería vendida.** El sistema no sabe cuánto costó lo que vendió: una factura de proveedor es una compra del negocio, no el costo de una venta puntual. Calcular "ganancia" con estos datos sería inventar un número que parece contable y no lo es. El `resumen` contrasta compras contra ventas, y eso es lo que dice que es.
- **Persistir o cachear totales.** RN-VTA-05 y D-01. Un total persistido es un número que puede quedar viejo sin avisar.
- **Estadísticas de cuenta corriente** (cuánto se cobró, cuánto se pagó). Ver D3: son plata moviéndose, no compras ni ventas, y mezclarlas es el error de dominio de este change.

## Decisions

### D1 — El "motor único" es el bucketing y la forma del resultado, no un constructor de queries genérico

D-35 pide "un solo motor, dos fuentes". La lectura tentadora es un `agregar(tabla, col_fecha, col_monto, filtros)` que sirva para las dos. Se descarta.

Las dos fuentes se parecen pero no son iguales: compras filtra opcionalmente por `proveedor_id`, ventas necesita un desglose por `forma_pago` que compras no tiene, y las columnas se llaman distinto. Un motor genérico que cubra eso termina siendo un mini-ORM con banderas — más difícil de leer que las dos queries que reemplaza, y con la propiedad de que un cambio para un lado rompe el otro por un camino no obvio.

**Lo que sí se comparte, porque es donde de verdad se puede divergir:**

1. **La expresión de bucketing** (`granularidad` → truncamiento de fecha). Una sola definición de qué es "semana".
2. **El relleno de períodos vacíos** (D2). Una sola definición de qué períodos deben existir en un rango.
3. **La forma del resultado**: `[{periodo, desde, hasta, total}]`. Idéntica de los dos lados, que es lo que hace trivial el `resumen`.

Cada fuente tiene su propia query, corta y legible. Lo compartido es lo que, si se duplicara, se desincronizaría en silencio — el mismo criterio con el que C-35 extrajo el motor FIFO (D-57) y no una línea más.

### D2 — Un período sin movimiento vale cero y aparece; no se omite

Una agregación SQL solo devuelve filas para los períodos que tienen datos. Si se emite eso tal cual, una semana sin ventas simplemente **no existe** en la respuesta.

Y ahí es donde se rompe: el frontend recibe dos puntos con fechas no consecutivas y traza una línea recta entre ellos. Eso no se ve como un hueco — se ve como una tendencia. El gráfico muestra una caída suave donde hubo un cero abrupto, y nadie tiene forma de notarlo mirando la pantalla.

El backend SHALL generar la serie completa de períodos del rango y rellenar con `0` los que la query no devolvió. Es responsabilidad del backend y no del frontend porque el backend es quien sabe qué períodos **debería** haber: el frontend solo ve lo que llegó.

**Alternativa descartada:** devolver solo los períodos con datos y documentar que el cliente rellene. Traslada una decisión de corrección a cada consumidor, y el primero que se la olvide dibuja un gráfico que miente sin error visible.

### D3 — Qué entra en cada agregación, y la trampa que hay que blindar

| Agregación | Suma | **NO** suma |
|---|---|---|
| **Compras** | `factura.monto_total` | `pago.monto` |
| **Ventas** | `venta.monto` | `cobro_cliente.monto` |

La trampa: **un cobro de cuenta corriente no es una venta** (RN-VTA-04). Cuando el negocio fía, esa operación ya se registró como `Venta` con `forma_pago = CUENTA_CORRIENTE` el día que salió la mercadería (RN-VTA-02). El cobro posterior es la **misma plata entrando**, no una venta nueva. Sumarlos duplica la facturación.

Es el error más fácil de cometer acá —"quiero ver toda la plata que entró"— y el más difícil de detectar, porque el número resultante es plausible: más alto, pero plausible. Nadie mira un total de ventas inflado y sospecha de un problema de modelo.

Simétricamente, del lado de compras: la **factura** es la compra; el **pago** es la cancelación de esa compra. Sumar los dos cuenta la misma operación dos veces.

El desglose de ventas por `forma_pago` incluye `CUENTA_CORRIENTE` como una forma más. Eso es correcto: fue una venta, cobrada o no. Que esté todavía impaga es asunto de la cuenta corriente, no del total vendido.

**Las dos agregaciones excluyen filas con soft delete**, por la misma razón por la que no cuentan en el saldo.

### D4 — La semana empieza el lunes

`date_trunc('week', ...)` de Postgres usa la norma ISO: la semana arranca el lunes. Se adopta tal cual en vez de forzar domingo, porque coincide con cómo se cuenta la semana laboral acá y evita una expresión hecha a mano que hay que testear aparte.

Queda escrito en la spec para que sea una decisión visible y no un detalle heredado del motor de base.

### D5 — Tope de períodos por respuesta

Un rango de cinco años con granularidad diaria son más de 1800 períodos en una sola respuesta JSON, y D2 garantiza que **todos** viajen aunque estén vacíos — el relleno es justamente lo que impide que un rango enorme salga barato.

Se impone un tope de períodos y se responde **422** al excederlo, informando cuántos períodos pediría y sugiriendo una granularidad más gruesa o un rango más corto. Mismo criterio que C-39 para el tamaño de un export: un error que dice qué hacer es mejor que una respuesta gigante que degrada la API para todos.

El tope se define sobre la **cantidad de períodos**, no sobre la longitud del rango: cinco años por mes son 60 filas y no molestan a nadie; cinco años por día, no.

### D6 — El `resumen` compone las dos agregaciones; no es un tercer camino de cálculo

`GET /api/estadisticas/resumen` llama a las mismas dos funciones que sirven a los otros dos endpoints y arma el contraste. No tiene query propia.

Si tuviera la suya, sería un tercer lugar donde "cuánto vendí" está definido, y el día que difiera del endpoint de ventas nadie va a poder decir cuál está bien. La única forma de que dos números coincidan siempre es que sean el mismo número.

El resumen no calcula ni margen ni porcentaje de "rentabilidad": devuelve compras, ventas y la diferencia, con el nombre de lo que es. Ver Non-Goals.

### D7 — Un query por endpoint, y los índices que lo sostienen

Cada agregación es un `GROUP BY` sobre el truncamiento de fecha, filtrado por `negocio_id` y rango. Nada de traer filas y sumar en Python: eso es lo que convierte una consulta barata en un problema de memoria sobre 1 GB.

`negocio_id` ya está indexado en las dos tablas. Se verifica con el plan de ejecución que el filtro por rango de fechas no degenere en un scan completo, y si hace falta, se agrega el índice compuesto — **medido, no supuesto**.

## Risks / Trade-offs

- **Sumar cobros como ventas duplica la facturación** → D3, con test explícito: un fiado cobrado aparece **una sola vez** en el total de ventas, el día de la venta. Verificable por mutación: incluir `cobro_cliente` en la agregación hace fallar el test.
- **Un gráfico que miente por períodos ausentes** → D2, relleno con cero en el backend. Test que verifica que un rango con un hueco devuelve la cantidad **exacta** de períodos esperada, no solo los que tienen datos.
- **Alguien agrega conversión de zona horaria "por las dudas"** → las columnas son `date`; una conversión introduciría un desplazamiento que mueve de bucket a los movimientos cercanos a medianoche. Queda escrito en la spec y en el código: acá **no** se convierte nada.
- **El desglose por forma de pago no suma el total** → test de que la suma de las partes es igual al total, en cada período. Es la clase de bug que se ve recién cuando alguien hace la cuenta a mano.
- **Un rango enorme por día devuelve miles de períodos** → D5, tope con 422 explicativo.
- **La agregación cuenta filas borradas** → filtro de soft delete en las dos fuentes, con test.
- **Superficie de conflicto con C-39, que corre en paralelo** → C-37 monta router nuevo y **sí** toca `main.py`; C-39 **no** (cuelga de routers existentes). Así que ese archivo es de C-37 en exclusiva. C-39 suma dos dependencias a `pyproject.toml`; C-37 **no suma ninguna**. Los dos agregan un servicio, así que **los dos mueven el conteo colectado** de `test_c28_scoping_axis_guard.py` — esperado, lo dice `CLAUDE.md`.
- **`_TZ_AR` está duplicado** en `factura_service` y `cobro_cliente_service` (y probablemente más). C-37 **no lo toca**: no lo necesita (D2/las columnas son `date`) y unificarlo es una refactorización que merece su propio change, no un pasajero de este.

## Migration Plan

Sin migración: ninguna tabla cambia y todo es lectura.

1. Verificar planes de ejecución contra datos de volumen realista antes de dar por buena la performance (D7).
2. Deploy backend. No rompe nada existente: son endpoints nuevos.
3. Rollback: revertir el commit. Sin estado que deshacer.

## Open Questions

- **El valor concreto del tope de períodos (D5)** se fija midiendo, no a ojo. Arranca conservador.
- **Si hace falta índice compuesto `(negocio_id, fecha)`** se decide con el plan de ejecución real (D7). Agregarlo preventivamente es costo de escritura a cambio de una suposición.
