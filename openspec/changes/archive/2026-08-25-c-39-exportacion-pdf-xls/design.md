## Context

La cuenta corriente ya está resuelta del lado del cálculo. `ProveedorService.get_cuenta_corriente(negocio_id, proveedor_id)` y su gemelo de clientes devuelven la terna on-demand: `saldo` con signo, las facturas/ventas con su estado FIFO, y un `historial` cronológico donde **cada fila ya trae su `saldo_acumulado`**. Nada de eso se persiste (D-01, RN-SALDO, RN-FIFO).

Lo que falta no es cálculo: es **transporte**. Sacar esos mismos números del sistema en un archivo, sin que se conviertan en otros números por el camino.

Restricciones que mandan sobre el diseño:

- **El VPS es Oracle Free Tier con 1 GB de RAM.** No es una nota al pie: descarta librerías de PDF que arrastran binarios de sistema, y obliga a pensar qué pasa con una cuenta de miles de movimientos.
- **La autorización vive en el service layer** y un recurso ajeno responde **404**, nunca 403 (Regla Dura #3 y #8).
- **Prohibido recalcular saldo o historial por otra vía** (scope de C-39). Si el export y la pantalla pueden divergir, algún día divergen, y el día que dos documentos digan números distintos nadie va a poder decir cuál tiene razón. Es el mismo argumento que llevó a extraer el motor FIFO compartido en C-35 (D-57).

## Goals / Non-Goals

**Goals:**

- Que el negocio pueda entregarle a un cliente un resumen de cuenta que **cierre solo**: que las filas reconcilien contra el saldo que muestra.
- Que los movimientos salgan a Excel para trabajarlos aparte.
- Que el documento use **exactamente** los números de la pantalla, por construcción y no por disciplina.

**Non-Goals:**

- **Papel membretado.** `Negocio` solo tiene `nombre` y C-39 **no** le agrega campos. Dirección, CUIT y logo son un perfil de negocio que hoy no existe; agregarlo acá sería tocar la tabla que es el límite de aislamiento del sistema por una mejora cosmética.
- **Export de listados que no sean cuenta corriente** (facturas sueltas, ventas del día, estadísticas). C-37/C-38 tienen su propio motor de agregación; mezclarlos acá es garantizar dos implementaciones del mismo concepto.
- **Envío por email o compartir por link.** El endpoint devuelve un archivo; qué hace la persona con él es asunto suyo.
- **Exportación asíncrona con job y notificación.** No hay scheduler en el VPS (D-65). Ver D5 para qué se hace en su lugar.

## Decisions

### D1 — El export reutiliza el service de cuenta corriente; no toca la base

`ExportacionCuentaCorrienteService` llama a `ProveedorService.get_cuenta_corriente` / `ClienteService.get_cuenta_corriente` y **formatea lo que recibe**. No abre queries propias, no importa el motor FIFO, no suma montos.

Es la única forma de que "el export coincide con la pantalla" sea una **propiedad estructural** y no una promesa que hay que testear para siempre. Un servicio de export con sus propias queries empieza idéntico y se desincroniza en el primer cambio de reglas que alguien aplique en un solo lado — y lo que se desincroniza es justo lo que no da síntoma: un desempate de orden, un borde en `applied == monto`, un redondeo.

**Alternativa descartada:** queries SQL dedicadas al export, más eficientes porque traen solo lo que el documento necesita. Se descarta por la razón de arriba: la eficiencia se paga con la posibilidad de divergencia, y el volumen acá no la justifica (ver D5).

### D2 — Con rango, el documento abre con `saldo anterior` — y ese número tampoco se calcula

Filtrar el historial por fecha rompe la lectura del documento si no se dice de dónde viene el arrastre. El saldo del encabezado es el **saldo actual de la cuenta entera**; las filas del rango arrancan en un acumulado que ya trae todo lo anterior. Sin una fila de apertura, el que recibe el PDF hace la cuenta, no le da, y deja de creerle al documento entero. Un resumen que no cierra es peor que no tener resumen.

La pieza elegante: **`saldo anterior` no hay que calcularlo.** Es el `saldo_acumulado` de la última fila **anterior** a `desde` — un dato que el historial ya trae. Si no hay ninguna fila anterior, es `0`.

```
saldo_anterior = historial[i-1].saldo_acumulado   (i = primera fila con fecha >= desde)
                 0                                 (si i == 0)
```

Así D2 no viola D1: se lee una fila que ya vino, no se computa nada nuevo.

**Consecuencia que se acepta en voz alta:** el `saldo` del encabezado es el de **hoy**, no el del final del rango. Un rango que termina en el pasado va a mostrar un encabezado que las filas no explican. Por eso, cuando hay `hasta` anterior a hoy, el documento **también** rotula el saldo al cierre del rango, y el encabezado aclara a qué fecha corresponde cada número. Dos números distintos, cada uno con su fecha, es honesto; un número sin fecha es una trampa.

### D3 — `fpdf2` para PDF y `xlsxwriter` para XLSX

**PDF — `fpdf2`.** Python puro, sin dependencias de sistema, huella de memoria chica. Escribe imperativamente, que es todo lo que un resumen de cuenta necesita: encabezado, tabla, totales.

- **`weasyprint` descartado**: renderiza HTML/CSS, lo que sería cómodo, pero arrastra cairo, pango y gdk-pixbuf. En una imagen Docker sobre 1 GB de RAM eso es peso de instalación y de runtime a cambio de un layout que acá no hace falta.
- **`reportlab` descartado**: es el estándar y hace mucho más, pero también es bastante más pesado y su API de bajo nivel no compra nada para una tabla con encabezado.

**XLSX — `xlsxwriter`.** Es **solo de escritura**, que es exactamente el caso: el sistema nunca lee un XLSX. Soporta `constant_memory` (escribe fila por fila sin retener la hoja), que es la propiedad que importa en 1 GB.

- **`openpyxl` descartado**: más conocido y sabe leer, pero acá leer no se necesita, y retiene más en memoria para el mismo trabajo.

El formato es **`xlsx`**, no `.xls` binario legado, pese al nombre del change. Excel, LibreOffice y Google Sheets lo abren; el `.xls` de verdad no lo genera ninguna librería mantenida.

### D4 — La ruta va ANTES de `/{id}`, o la rompe

Las dos rutas cuelgan de los routers que ya existen:

```
GET /api/proveedores/{proveedor_id}/cuenta-corriente/export
GET /api/clientes/{cliente_id}/cuenta-corriente/export
```

`proveedores.py` ya tiene el comentario `# MUST come before /{id} (C-12)` sobre la ruta de cuenta corriente, y la misma trampa aplica acá: FastAPI matchea en orden de declaración, así que una ruta declarada después de `/{id}` nunca se alcanza. Las nuevas van **junto a** la de cuenta corriente, antes del `/{id}`, no al final del archivo donde es natural agregarlas.

Sin router nuevo: cero líneas tocadas en `main.py`, lo que además **elimina el punto de conflicto con C-37**, que sí monta un router propio.

**Parámetros** (todos de query, todos opcionales salvo el formato):

| Param | Default | Significado |
|---|---|---|
| `formato` | requerido | `pdf` \| `xlsx` |
| `incluir_historial` | `false` | Sin él, el documento es un comprobante de saldo de una carilla |
| `desde` / `hasta` | sin rango | Filtran el historial. **Nunca** filtran el saldo del encabezado |

`desde` y `hasta` con `incluir_historial=false` es contradictorio: se responde **422** en vez de ignorarlos en silencio. Pedir un rango y recibir un documento sin filas es el tipo de silencio que se lee como bug.

### D5 — Tope de filas explícito, en vez de un job asíncrono que no se puede tener

Una cuenta con miles de movimientos generando un PDF en un proceso de 1 GB es el riesgo real de este change. La salida ortodoxa —encolar el trabajo y notificar cuando esté— **no está disponible**: no hay scheduler en el VPS (mismo motivo por el que D-65 rechazó vencer claves).

Entonces: **tope duro de filas de historial por documento**, y al excederlo se responde **422 con el número real de movimientos y una sugerencia de acotar el rango**, no un timeout ni un 500. Un error que dice qué hacer es infinitamente mejor que un proceso que muere en silencio y se lleva puesta la API para todos los demás.

El XLSX usa `constant_memory` igual, así que su techo es mucho más alto que el del PDF; el tope se fija por formato, no uno solo para los dos.

### D6 — El archivo se nombra en el backend, con fecha

`Content-Disposition: attachment; filename="cuenta-corriente-{nombre}-{YYYY-MM-DD}.{ext}"`, con el nombre normalizado (sin acentos ni espacios). Bajar tres resúmenes del mismo cliente y que se llamen los tres igual con `(1)` y `(2)` es cómo se termina mandando el mes equivocado.

### D7 — El frontend no arma el archivo ni calcula nada

El cliente dispara la request y entrega el blob al navegador. No compone el PDF, no suma montos, no formatea números para el documento. La única lógica de frontend es la del formulario que arma los query params y la del disparo de descarga.

Se descarta generar el PDF en el cliente (jsPDF y similares): pondría la lógica del documento del lado donde los montos **no** son la fuente de verdad, que es exactamente contra lo que existe la Regla Dura #9.

## Risks / Trade-offs

- **Un documento con rango que no reconcilia contra su encabezado** → D2: fila de `saldo anterior` obligatoria cuando hay rango, y saldo al cierre del rango rotulado con su fecha cuando `hasta` es anterior a hoy. Con test que verifica la reconciliación aritmética, no solo que las filas estén.
- **El export y la pantalla dan números distintos** → D1 lo hace estructuralmente imposible (mismo service, misma llamada). El test que importa no es "el export tiene filas" sino "el export coincide con lo que devuelve el endpoint de cuenta corriente para la misma cuenta".
- **Una cuenta enorme tumba el proceso de 1 GB** → D5: tope por formato con 422 explicativo. Verificable por mutación: bajar el tope a 1 en el test tiene que producir el 422, no un documento.
- **Una ruta declarada después de `/{id}` nunca se alcanza** → D4. Es un fallo silencioso: no rompe el arranque, simplemente el endpoint devuelve otra cosa. Test que pega a la ruta real y verifica el `Content-Type`, no solo que el router la tenga registrada.
- **Dependencias nuevas en un entorno de 1 GB** → D3 elige Python puro y sin binarios de sistema; ambas librerías son de escritura solamente y de huella chica.
- **Superficie de conflicto con C-37, que corre en paralelo** → C-39 no crea router (D4) ni toca `main.py`; C-37 sí. El único archivo compartido es `pyproject.toml` (deps): C-39 suma dos líneas. Y los dos agregan archivos a `services/`, así que **los dos mueven el conteo de tests colectados** de `test_c28_scoping_axis_guard.py` — esperado, no una falla (lo dice `CLAUDE.md`).
- **`xlsx` y no `.xls`, pese al nombre del change** → declarado acá y en el proposal para que no se lea como un desvío.

## Migration Plan

Sin migración: ninguna tabla cambia y nada del export se persiste.

1. Sumar las dos dependencias a `pyproject.toml` y reconstruir la imagen.
2. Backend primero (los endpoints nuevos no rompen nada existente), frontend después. El orden inverso mostraría un botón que responde 404.
3. Rollback: revertir el commit. Sin estado que deshacer.

## Open Questions

- **El valor concreto del tope de D5** (cuántas filas por formato) se fija midiendo contra el contenedor real, no a ojo. Hasta tener el número medido, arranca conservador.
- **Un rango sin movimientos** produce un documento con encabezado, `saldo anterior` y ninguna fila. Se asume que eso es correcto —"no hubo movimientos en este período" es información— y no un caso de error.
