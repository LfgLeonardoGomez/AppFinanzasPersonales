## Contexto

El motor que este change necesita ya corre en producción. Desde C-12/C-13 el lado de proveedores calcula, on-demand y sin persistir jamás:

- **saldo** — `SUM(facturas activas.monto_total) − SUM(pagos activos.monto)` (RN-SALDO);
- **estado por factura** — una asignación FIFO greedy de todo el pool de pagos sobre las facturas ordenadas `(fecha ASC, created_at ASC, id ASC)` (RN-FIFO);
- **historial** — una mezcla cronológica de cargos y créditos que lleva un saldo corriente por fila (RN-HIST).

Dos funciones puras cargan con todo eso, con 26 tests ya escritos contra ellas:

| Función | Ubicación | Tests |
|---|---|---|
| `_compute_estado_fifo(facturas, pool) -> dict[id, EstadoFactura]` | `app/services/factura_service.py` | `tests/test_fifo_algorithm.py` (10) |
| `_build_historial(facturas, pagos) -> list[dict]` | `app/services/proveedor_service.py` | `tests/test_cuenta_corriente_historial_helper.py` (16) |

C-33 entregó el cargo del lado del cliente y, deliberadamente, la query que alimenta este change: `VentaRepository.listar_fiadas_de_cliente` devuelve los fiados vivos de un cliente del más viejo al más nuevo — ya en orden FIFO — respaldada por el índice `ix_venta_negocio_cliente_deleted` creado exactamente para esta lectura.

Lo que falta es el crédito (`CobroCliente`) y la composición.

La correspondencia es exacta en forma y **no** en vocabulario ni en reglas:

| Proveedores | Clientes |
|---|---|
| `Proveedor` | `Cliente` |
| `Factura` (cargo, `monto_total`, `fecha_emision`) | `Venta` con `forma_pago = CUENTA_CORRIENTE` (cargo, `monto`, `fecha`) |
| `Pago` (crédito, `comprobante_url`) | `CobroCliente` (crédito, `comprobante_url`) |
| `EstadoFactura.PAGADA` | `EstadoVentaFiada.COBRADA` |
| el saldo puede ir a negativo — crédito a favor del negocio es un estado válido | **el saldo no debe ir a negativo** (RN-CCC-04) |

Esa última fila es la única asimetría sustantiva, y vive enteramente en el write path.

## Objetivos / No-objetivos

**Objetivos:**
- Registrar los pagos de clientes como una entidad que se asocia al **cliente**, nunca a una venta (RN-CCC-03).
- Responder "cuánto me debe este cliente" con una sola lectura on-demand: saldo, fiados con estado, historial.
- Hacer imposible registrar un pago mayor al saldo pendiente (RN-CCC-04).
- Terminar este change con **una sola** implementación de la asignación FIFO y de la mezcla cronológica, calculando para ambos libros.
- Dejar el comportamiento observable del libro de proveedores byte-idéntico, probado por sus tests existentes sin editarlos.

**No-objetivos:**
- Cualquier cambio a `Venta` o `VentaService`. Este change lee fiados; no los escribe.
- Frontend (C-36), agregaciones por período (C-37), exportación (C-39).
- Reconciliar un pago contra ventas puntuales en la base de datos. FIFO es una vista de lectura y sigue siéndolo.
- Extracción por IA de comprobantes de pago. Un cobro se tipea.

## Decisiones

### D1 — Extraer el núcleo puro; los helpers de proveedores pasan a ser adaptadores sobre él

**Decisión.** Crear `app/services/cuenta_corriente_engine.py` con las dos piezas de aritmética que son genuinamente idénticas en ambos lados:

```python
@dataclass(frozen=True)
class Movimiento:
    id: uuid.UUID
    fecha: date
    monto: Decimal
    archivo_url: Optional[str] = None

def asignar_fifo(cargos: Sequence[Movimiento], pool: Decimal) -> dict[uuid.UUID, Decimal]
def construir_historial(
    cargos: Sequence[Movimiento],
    abonos: Sequence[Movimiento],
    tipo_cargo: str,
    tipo_abono: str,
) -> list[dict]
```

Cada libro adapta sus propias filas a `Movimiento` y le pone nombre a sus propios resultados. `factura_service._compute_estado_fifo` y `proveedor_service._build_historial` **mantienen exactas su firma y sus valores de retorno** y pasan a ser adaptadores finos: mapean filas hacia adentro, llaman al motor, mapean resultados hacia afuera. Los cuatro call sites quedan intactos, y los 26 tests existentes corren sin editar — son el arnés de regresión de la extracción.

**Por qué no duplicar.** Dos implementaciones del mismo loop greedy, en un sistema cuya razón de ser entera es decirle a alguien cuánta plata está pendiente, es una promesa de que algún día van a responder distinto sobre la misma aritmética — y nadie va a poder decir cuál tiene razón. Las piezas que se desalinearían son precisamente las que no tienen síntoma visible cuando lo hacen: un orden de desempate, un límite en `applied == monto`, un redondeo.

**Por qué no "duplicar ahora, unificar después".** Unificar después no pasa nunca. Además cuesta más que hacerlo ahora: una vez que C-36 lo renderiza, un cambio al FIFO de clientes adquiere una superficie de regresión de UI.

**Por qué esto es compatible con la instrucción de `CHANGES.md` de "reusa el motor de C-12/C-13 sin modificarlo".** Esa frase y la siguiente — "antes de escribir código nuevo, revisar qué se puede extraer y compartir en vez de duplicar" — tiran para lados opuestos, porque extraer siempre modifica al que llama. Se reconcilian leyendo "sin modificarlo" como **sin cambiar su comportamiento**: la invariante que vale la pena proteger es que ningún saldo de proveedor se mueva. Este diseño mantiene la costura (nombre de función, firma, tipo de retorno) congelada y cambia solo lo que hay adentro, que es la forma más chica posible de honrar ambas cláusulas. Se nombra acá en vez de reconciliarse en silencio, y es la decisión de este change que más merece un veto humano.

**Costo, dicho con honestidad.** La extracción toca dos cuerpos de función en un motor de proveedores que viene funcionando hace meses, en un change ya calificado gobernanza ALTO. Si eso se juzga inaceptable, el fallback es una copia del lado cliente más un test que asegure que ambas implementaciones coinciden sobre la misma entrada — más barato hoy, y un duplicado que al menos el suite nota.

### D2 — El motor devuelve montos asignados, no un estado

`asignar_fifo` devuelve `dict[id, Decimal]` — cuánto del pool cayó en cada cargo — y cada libro mapea eso a su propio enum:

| Asignado | Proveedores | Clientes |
|---|---|---|
| `0` | `PENDIENTE` | `PENDIENTE` |
| `0 < applied < monto` | `PARCIAL` | `PARCIAL` |
| `applied >= monto` | `PAGADA` | `COBRADA` |

Devolver `EstadoFactura` desde código compartido obligaría al libro de clientes a hablar el vocabulario de proveedores, y una venta reportada como `PAGADA` se lee como si el negocio la hubiera pagado. El vocabulario es dominio, no aritmética, y se queda con cada dominio. Esto también deja el pool sobrante calculable por quien llama, que es lo que D4 necesita.

**Alternativa considerada**: parametrizar el motor con una tripla de enums. Rechazada — hace que el código compartido dependa de los enums de ambos dominios para ahorrarse un mapeo de tres líneas en cada uno.

### D3 — RN-CCC-04 se aplica al crear y al editar, contra el saldo excluyendo la fila que se está editando

Un cobro se rechaza cuando empujaría el saldo por debajo de cero:

```
saldo_disponible = SUM(fiados activos) − SUM(cobros activos, excluyendo el que se está editando)
rechazar si monto > saldo_disponible
```

Aplicarlo solo al crear dejaría el agujero obvio: crear un pago válido de $100, y después editarlo por PATCH a $10.000. La cláusula de `excluyendo` es lo que hace que editar funcione — sin ella, subir un pago existente en $1 se compararía contra un saldo que ya contiene el monto viejo, y se rechazaría como si todo el monto nuevo fuera adicional.

El chequeo vive en el **service layer**, según RN-CCC-04 y la regla dura del proyecto. No es expresable como un CHECK de base de datos: es una restricción entre dos tablas y muchas filas, no una propiedad de una sola fila — a diferencia del `ck_venta_fiado_tiene_cliente` de C-33 (D-53), que por eso sí pudo ir al esquema y este no puede.

El rechazo es **422** con un mensaje en español que dice cuál es el saldo restante, para que la persona en el mostrador pueda corregir el monto en vez de adivinar.

### D4 — El read path reporta un saldo negativo con honestidad en vez de recortarlo

RN-CCC-04 y la KB enuncian la invariante en términos absolutos: `SUM(cobros activos) ≤ SUM(ventas fiadas activas)`. **El sistema entregado no puede garantizar eso**, y esto es un hallazgo, no un descuido de este diseño:

1. El `VentaService.eliminar` de C-33 hace soft-delete de un fiado. El cargo sale de la cuenta del cliente; los pagos que se habían acreditado contra él se quedan.
2. D-54: un PATCH que saca una venta de `CUENTA_CORRIENTE` limpia su `cliente_id`. Mismo efecto, permitido a propósito como la corrección más común ("en realidad me pagó en el momento").

Cualquiera de los dos caminos puede dejar a un cliente con más acreditado que cargado. Tres opciones:

| Opción | Consecuencia |
|---|---|
| **Recortar `saldo` a 0 en la lectura** | El sistema esconde plata que no puede justificar. Rechazada de plano — un saldo que miente es peor que uno que sorprende. |
| **Bloquear la edición/borrado de la venta cuando rompería la invariante** | Modifica el comportamiento ya entregado de C-33 y prohíbe una corrección legítima. Fuera de alcance acá y necesita una decisión de negocio, no técnica. |
| **Reportar el número real (elegida)** | `saldo` es un `Decimal` con signo y puede ser negativo en este caso residual. FIFO deja un pool sin asignar, que la respuesta no esconde. |

El write path protege lo que puede proteger atómicamente — el cobro. El agujero residual se plantea en Preguntas Abiertas para un humano, y hay que avisarle a C-36 que el número puede ser negativo para que su UI no asuma lo contrario.

### D5 — Dos tipos de enum de Postgres nuevos, creados exactamente una vez en la migración `0011`

`MetodoCobro` es `EFECTIVO` / `TRANSFERENCIA` / `TARJETA` / `OTRO` — la lista de la KB. No es una reutilización de `MetodoPago`, que lleva `MERCADOPAGO` (plata que sale hacia proveedores) y ensancharía en silencio qué puede ser un cobro; tampoco de `FormaPago`, que lleva `CUENTA_CORRIENTE`, y cancelar deuda con deuda no es una cosa que exista.

`EstadoVentaFiada` (`PENDIENTE` / `PARCIAL` / `COBRADA`) es **derivado y nunca se guarda**, así que es un enum de Python solamente — sin tipo de Postgres, sin columna, nunca (D-01).

**El procedimiento de la migración, textual, porque C-33 lo aprendió rompiéndolo (D-56)** — un enum de Postgres es un objeto de **base de datos**, no uno acotado a una tabla. Crearlo dos veces no rompe la tabla nueva; rompe todas las migraciones que corren después, y la falla aparece en un archivo de test que no tiene nada que ver:

```python
sa.Enum(*_METODO_COBRO, name="metodocobro").create(op.get_bind(), checkfirst=True)
metodo = postgresql.ENUM(*_METODO_COBRO, name="metodocobro", create_type=False)
# ... luego usar `metodo` en create_table — nunca un sa.Enum a secas, que
# haría CREATE TYPE una segunda vez, sin checkfirst.
```

El `downgrade` tiene que tirar el tipo después de la tabla, o el re-upgrade falla.

**Fijación de revisión (D-21)**: `revision = "0011"`, `down_revision = "0010"`. Explícito en ambas puntas — nunca `head`, nunca `-1`. El test de la migración apunta a `0011` y `0010` por nombre para quedar inmune a que la cadena crezca.

### D6 — Saldo por cliente en el listado de clientes (extensión de alcance — señalada para aprobación)

`CHANGES.md` pone "listado de clientes ordenable por saldo" en **C-36**, un change de frontend. No hay ningún backend en ningún lado que lo devuelva, así que C-36 tal como está escrito queda bloqueado, y su improvisación más probable es una llamada a cuenta-corriente por cliente.

Este diseño agrega `saldo` al listado de clientes vía **una query agregada** — `ClienteRepository.get_saldo_por_cliente(negocio_id)`, un espejo directo de `ProveedorRepository.get_saldo_por_proveedor`, que ya resuelve exactamente esto con subqueries pre-agregadas para evitar tanto el N+1 como el fan-out de joins.

Se señala porque es alcance que este change no pidió. Descartarlo es legítimo; descartarlo en silencio no.

### D7 — El endpoint es `GET /api/clientes/{cliente_id}/cuenta-corriente`

`CHANGES.md` lo escribe como `GET /api/cuenta-corriente/clientes/{id}`. Esa forma no tiene precedente en esta API: el equivalente de proveedores es `GET /api/proveedores/{proveedor_id}/cuenta-corriente`, y toda otra lectura cuelga de su recurso dueño. Una segunda ruta, con forma distinta, para el mismo concepto, haría que el cliente TypeScript generado describa dos cosas sin relación.

Elegida: la forma anidada al recurso, replicando proveedores exactamente. Declarada al lado de `/buscar`, antes de `/{cliente_id}`, siguiendo la ubicación que C-06/C-12 establecieron. La discrepancia con `CHANGES.md` se nombra acá en vez de reconciliarse en silencio; si se quiere la forma plana, es un cambio de un decorador de una línea.

### D8 — `cliente_id` es inmutable en el PATCH de un cobro

Replica a `PagoService`, donde `proveedor_id` no se puede patchear porque corrompería el historial FIFO. Mover un pago entre clientes reescribe **dos** saldos en un solo request, uno de los cuales quien llama nunca mencionó — y el segundo se puede empujar a negativo con el movimiento. La corrección es borrar y volver a registrar, lo cual deja ambas cuentas auditables.

### D9 — RN-CCC-04 se chequea leer-y-después-escribir, sin lock

Dos cobros concurrentes para el mismo cliente pueden cada uno leer el mismo saldo disponible y pasar los dos. El resultado es exactamente el saldo negativo que la regla prohíbe.

Aceptado por ahora: la concurrencia realista es una o dos personas en un mostrador, y la ventana es de milisegundos. La alternativa — `SELECT ... FOR UPDATE` sobre la fila del cliente durante la escritura — son pocas líneas y es la corrección correcta si esto algún día importa. Deliberadamente no se hace acá porque un lock introducido sin un problema medido es un deadlock esperando a ser descubierto en producción, y este change ya carga con un refactor del motor de proveedores. Se deja registrado para que sea un límite conocido y no una sorpresa.

### D10 — Índices y orden en `cobro_cliente`

Tres índices, cada uno para una query que existe — la misma disciplina que la migración `0010`:

- `negocio_id` — el filtro de tenant sobre todo;
- `(negocio_id, cliente_id, deleted_at)` — juntar los pagos vivos de un cliente, la lectura para la que existe todo este change;
- `(negocio_id, fecha)` — el listado por período, y sobre lo que C-37 va a agregar.

El repositorio devuelve los pagos de un cliente ordenados `(fecha ASC, created_at ASC, id ASC)`, igual que `listar_fiadas_de_cliente` y `PagoRepository.list_by_proveedor`. El orden no afecta al pool (RN-FIFO-02: la asignación es por monto total, no por fecha) pero hace que el historial sea determinístico, que es lo que hace que un test sobre él tenga sentido.

## Riesgos / Trade-offs

- **[La extracción desestabiliza el libro de proveedores]** → La costura mantiene su firma, así que 26 tests existentes de función pura más 17 tests de servicio de cuenta corriente corren sin editar como arnés. La task 1.1 registra la base del suite completo antes de que nada se mueva; cualquier desvío es atribuible. Los chequeos de mutación de la task 8 confirman que los tests realmente muerden.
- **[Un saldo negativo llega a la UI]** → Real y aceptado (D4). El contrato de la API dice que `saldo` tiene signo; hay que avisarle a C-36, o va a renderizar una deuda con el signo equivocado.
- **[RN-CCC-04 rechaza una corrección legítima]** → La cláusula de `excluyendo la fila que se está editando` en D3 es lo que evita esto; tiene su propio test, porque si se hace mal, cada edición de pago falla de una forma que parece un bug de permisos.
- **[La migración `0011` rompe la cadena por el enum]** → D5 fija el procedimiento exacto de D-56, y el test de la migración corre upgrade → downgrade → upgrade para que un `DROP TYPE` faltante falle acá y no en un archivo de test sin relación.
- **[Scope creep vía D6]** → Aislado en su propio grupo de tasks e independientemente removible sin tocar el resto.
- **[Cobros concurrentes violan RN-CCC-04]** → Aceptado, con la ventana y la corrección documentadas (D9).

## Plan de Migración

1. `alembic upgrade head` aplica `0011`: solo aditivo — una tabla nueva, un tipo de enum nuevo, tres índices. Sin backfill, nada alterado en tablas existentes.
2. Desplegar la API. Las rutas nuevas son aditivas; las rutas existentes de proveedores quedan sin cambios y sus respuestas son byte-idénticas.
3. Rollback: `alembic downgrade 0010` tira la tabla, los índices y el tipo de enum. Nada fuera de `cobro_cliente` depende del tipo nuevo, así que el rollback es limpio. Ojo que hacer rollback **destruye los pagos registrados** — un rollback después de uso real necesita un dump antes.

## Preguntas Abiertas

1. **¿`VentaService` debería negarse a borrar o degradar un fiado cuando eso dejaría el saldo del cliente en negativo?** (D4). Es una decisión de negocio: protege la invariante pero prohíbe la corrección más común que C-33 permitió a propósito. No se decide acá; necesita al humano.
2. **¿D6 (saldo en el listado de clientes) va en este change o en C-36?** Requiere la aprobación ya señalada.
3. **¿Un cobro debería aceptar un `comprobante_url` vía el preset firmado de Cloudinary, como hace `Pago`?** El campo existe en la KB; el flujo de subida es un tema de frontend (C-36) y el backend simplemente guarda el string. Nombrado para que C-36 no se lo encuentre indefinido.
