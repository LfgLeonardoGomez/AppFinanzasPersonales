## Context

El sistema ya tiene un espejo casi exacto de lo que hay que construir: `Factura` es un cargo que el negocio debe, `Venta` fiada es un cargo que le deben. Mismo `negocio_id` denormalizado, mismo soft delete, mismo `creado_por_usuario_id` como autoría, misma prohibición de persistir saldo.

`Cliente` (C-32) ya existe con su unicidad normalizada. Lo único que falta es el cargo.

La decisión que gobierna todo se tomó en la charla de diseño y quedó como D-33: **el fiado no es una entidad, es una forma de pago**. Todo lo que sigue es consecuencia de eso.

## Goals / Non-Goals

**Goals:**
- Registrar ventas con su forma de pago, para poder mirar el día y separar contado de fiado.
- Que el fiado quede registrado **una sola vez**, sin posibilidad de divergir.
- Que sea imposible tener un fiado sin cliente, garantizado por la base.
- Dejar servido el cargo que C-35 va a consumir para calcular saldo y FIFO.

**Non-Goals:**
- Cobros, saldo, estado FIFO de ventas fiadas (C-35).
- Agregaciones por período (C-37). Este change entrega filas y filtros; sumar es otro trabajo.
- Frontend (C-34).
- Items, stock, inventario. Se registran **montos**, no productos: esto no es un POS y no debe empezar a parecerlo.

## Decisions

### D1 — La invariante vive en un CHECK de la base, no solo en Pydantic

```sql
CHECK ((forma_pago = 'CUENTA_CORRIENTE') = (cliente_id IS NOT NULL))
```

Postgres expresa esto en una línea, así que no hay excusa para dejarlo solo en la aplicación. `cliente_id` es nullable por necesidad —la mayoría de las ventas no tienen cliente— y eso significa que **el tipo no impide guardar un fiado huérfano**. Un fiado sin cliente es plata que el negocio cree que le deben y no puede cobrarle a nadie: no se recupera revisando, porque no hay a quién preguntarle.

Mismo criterio que C-32 (D-45): el service chequea para poder dar un mensaje útil, la base chequea para que la regla sea **cierta** — incluida cualquier ruta futura, un script de importación, o una corrección hecha a mano.

**Alternativa considerada**: solo Pydantic + service. Se descarta porque la validación de aplicación protege los caminos que hoy existen, no los que se agreguen en seis meses.

### D2 — `PATCH` valida el par resultante, no el campo que llega

Al editar, se computa `(forma_pago, cliente_id)` **después** de aplicar los cambios y se valida esa combinación. Validar campo por campo dejaría pasar el caso obvio: cambiar `forma_pago` a `EFECTIVO` sin tocar `cliente_id`, y quedar con una venta al contado que arrastra un cliente.

Sacar una venta de `CUENTA_CORRIENTE` **limpia `cliente_id`** explícitamente en el service, en vez de exigir que el cliente lo mande en `null`. La alternativa haría que la corrección más común —"en realidad me lo pagó"— falle con un error de validación que el usuario no entiende.

### D3 — Borrar una venta fiada modifica el saldo del cliente, y está bien

El saldo se calcula on-demand sobre lo activo (D-01), así que un soft delete de una venta fiada hace desaparecer ese cargo. No hay nada que "revertir": es la misma mecánica que ya tiene el lado de proveedores.

Lo que **sí** hay que hacer es que no sorprenda. Queda anotado para C-34: el borrado de una venta fiada tiene que avisar que afecta la cuenta del cliente, igual que el borrado de proveedor avisa de sus dependencias (RN-PROV-04).

### D4 — Sin endpoint de totales en este change

Es tentador agregar `GET /api/ventas/resumen` porque la pantalla lo va a querer. Se deja afuera a propósito: C-37 define **un solo motor de agregación** parametrizado por período, compartido con las compras de proveedores (D-35). Adelantar acá una suma ad-hoc garantiza dos implementaciones distintas del mismo concepto, y que en algún momento den números diferentes.

Mientras tanto, el listado con filtro de fechas alcanza para que la pantalla muestre el día.

### D5 — `fecha` es `date`, no timestamp

Una venta se registra en un día, no en un instante. Un timestamp obligaría a decidir zona horaria en cada lectura y abriría la puerta a que una venta "salte" de día según quién la mire. La validación de "no futura" usa el reloj de `America/Argentina/Buenos_Aires`, igual que facturas y pagos.

### D6 — Sin `origen` MANUAL/IA

`Factura` y `Pago` lo tienen porque la IA de visión los puede proponer. Una venta se carga en el mostrador, a mano; no hay nada que extraer de una imagen. Agregar el campo "por consistencia" sería agregar una columna que nadie va a leer.

## Risks / Trade-offs

**[Una venta fiada borrada por error borra deuda]** → El soft delete conserva la fila, así que es recuperable por alguien con acceso a la base, pero **no hay deshacer en la app**. Aceptado por ahora: es el mismo nivel de riesgo que borrar una factura, que existe desde el MVP. Si aparece el caso real, la solución es un "restaurar" sobre `deleted_at`, no cambiar el modelo.

**[Cambiar la forma de pago borra deuda en silencio]** → Mitigado por D2 en cuanto a coherencia, no en cuanto a visibilidad. La advertencia al usuario es responsabilidad de C-34 y queda anotada; el backend no puede impedir una corrección legítima.

**[El CHECK complica una migración futura]** → Si algún día aparece una forma de pago que también requiera cliente, el CHECK hay que reescribirlo. Es una línea en una migración, y a cambio la regla es cierta hoy.

**[Sin agregaciones, la pantalla del día pagina]** → Un negocio con muchas ventas diarias va a traer muchas filas para sumar del lado del cliente. Es temporal hasta C-37 y no justifica adelantar una suma que después habría que unificar.

## Migration Plan

Revisión `0010`: crea `venta` con el CHECK de la invariante, índice por `negocio_id`, índice compuesto `(negocio_id, fecha)` para el listado por período, e índice `(negocio_id, cliente_id, deleted_at)` para que C-35 pueda juntar las ventas fiadas de un cliente sin escanear. Tabla nueva, sin backfill. `downgrade` la elimina.

## Open Questions

- ¿Debería poder restaurarse una venta borrada? Hoy no, igual que facturas. Se decide cuando alguien lo pida con un caso real.
- ¿Conviene un campo de "comprobante" o número de ticket? No lo pediste, y agregarlo sin caso de uso es adivinar. Anotado por si aparece.
