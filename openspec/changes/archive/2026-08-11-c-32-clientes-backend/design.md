## Context

`Proveedor` ya resolvió un problema parecido: RN-VINC normaliza nombres para sugerir coincidencias en el autocompletado. Pero ahí la normalización es **solo una ayuda de búsqueda** — dos proveedores con el mismo nombre son legales (`nombre` no es único, por spec).

Con clientes es al revés, y esa es la diferencia que manda todo el diseño: acá el nombre **identifica una cuenta corriente**. Dos filas equivalentes no son un detalle cosmético, son la deuda de una persona partida en dos lugares.

Restricciones que ya están fijadas y este change hereda: aislamiento por `negocio_id` (C-28), soft delete en entidades de negocio (D-04), rutas de colección sin redirect (C-27), y tests contra Postgres real.

**Coordinación con C-31**: los dos changes agregan migración. Se reservó `0008` para este y `0009` para C-31, decidido antes de escribir código para no descubrir el choque al mergear.

## Goals / Non-Goals

**Goals:**
- Que sea imposible tener dos clientes equivalentes en un negocio, garantizado por la base y no por el código.
- Que el alta sea de un solo campo, porque ocurre con el cliente esperando.
- Que un choque de unicidad devuelva algo accionable, no un error de base.
- Fijar la regla de normalización ahora, con tests que la claven.

**Non-Goals:**
- Ventas, fiados, cobros, saldo (C-33, C-35).
- Frontend (C-34).
- Fusionar dos clientes ya creados. Si un duplicado se cuela por nombres genuinamente distintos ("Juan" y "Juan Pérez"), no hay herramienta para unirlos. Queda anotado.
- Búsqueda difusa o fonética. Ver D2.

## Decisions

### D1 — La normalización es una función pura y sola, con su propio test

Vive en `app/core/normalizacion.py`, sin dependencias de sesión ni de modelo: entra un string, sale un string. Se testea directo, sin base de datos.

Está separada de la de RN-VINC a propósito, aunque hoy hagan casi lo mismo. La de proveedores sirve para **sugerir**; esta **decide identidad**. Acoplarlas significaría que ajustar el autocompletado de proveedores —algo de UX, sin riesgo aparente— cambia en silencio qué clientes se consideran la misma persona.

Algoritmo, en este orden: `strip` → minúsculas → `unicodedata.normalize("NFKD")` y descarte de marcas diacríticas → colapso de espacios internos.

### D2 — Normalización deliberadamente conservadora

No hay coincidencia fonética, ni ordenamiento de palabras, ni descarte de partículas ("de", "del").

**Alternativa considerada**: normalización agresiva para atrapar más duplicados. Se descarta por el error simétrico: fusionar dos personas distintas es **peor** que dejar pasar un duplicado. Un duplicado se ve en el listado y se corrige; una fusión silenciosa mezcla la deuda de dos clientes y nadie se entera hasta que uno reclama.

Lo que la normalización no atrapa —"Juan" vs "Juan Pérez", apodos, apellido primero— lo cubre el **autocompletado**: el empleado ve las coincidencias antes de crear. La defensa es la UI mostrando lo que existe, no el algoritmo adivinando.

### D3 — Índice único **parcial**, solo sobre activos

```sql
CREATE UNIQUE INDEX ix_cliente_negocio_nombre_normalizado
    ON cliente (negocio_id, nombre_normalizado)
    WHERE deleted_at IS NULL;
```

El `WHERE` es lo que hace que el soft delete y la unicidad convivan. Sin él, un cliente eliminado seguiría bloqueando su propio nombre para siempre y el negocio no podría volver a dar de alta a alguien que había borrado — un callejón sin salida y sin explicación visible.

Postgres soporta índices parciales nativamente, así que esto no cuesta nada.

### D4 — Se chequea antes **y** la base respalda

El service busca la colisión antes de insertar, para poder devolver un 409 con el id y el nombre del cliente existente. Pero el índice único queda igual: entre el chequeo y el insert hay una ventana, y dos empleados cargando al mismo cliente al mismo tiempo la encuentran.

Así que el service **también** captura el `IntegrityError` y lo traduce al mismo 409. El chequeo previo existe para dar un mensaje útil; el índice existe para que la regla sea cierta.

**Alternativa considerada**: solo el índice, traduciendo el error. Más simple, pero el mensaje quedaría sin el id del existente —hay que buscarlo igual para armarlo— así que no ahorra nada.

### D5 — El 409 lleva el cliente existente adentro

La respuesta de conflicto incluye `cliente_existente: {id, nombre}`. Sin eso, el frontend tendría que hacer una búsqueda extra para ofrecer "¿quisiste decir este?", con el empleado esperando frente al mostrador.

### D6 — `nombre` se guarda tal cual se tipeó

Se persisten los dos campos: `nombre` con sus mayúsculas y acentos, `nombre_normalizado` para comparar. Guardar solo el normalizado ahorraría una columna y le mostraría al negocio "juan perez" en los listados, que se ve descuidado en algo que el dueño le muestra a su cliente.

## Risks / Trade-offs

**[Cambiar la normalización después invalida el índice]** → Es la decisión más difícil de revertir del change. Si mañana se ajusta la función, las filas viejas conservan el valor calculado con la regla anterior y el índice deja de garantizar lo que promete. Cambiarla exigiría recalcular toda la tabla dentro de una migración. Mitigación: la regla está clavada por tests con casos explícitos, así que un cambio accidental rompe el build en vez de corromper datos en silencio.

**[Duplicados que la normalización no puede ver]** → "Juan" y "Juan Pérez" son clientes distintos para el sistema. Aceptado y consciente: la defensa es el autocompletado en C-34. Lo que queda sin cubrir es el caso en que el empleado ignora las sugerencias y crea igual; ahí no hay herramienta de fusión, y eso queda anotado como deuda.

**[El 409 filtra nombres del propio negocio]** → La respuesta de conflicto revela el nombre de un cliente existente, pero solo del negocio del solicitante, que ya puede listarlos todos. No hay exposición nueva.

**[Carrera entre dos empleados]** → Cubierta por el índice más la traducción del `IntegrityError`. El segundo en llegar recibe 409, no un 500.

## Migration Plan

Revisión `0008` (número reservado; C-31 usa `0009`): crea `cliente` con el índice único parcial y un índice por `negocio_id`. Tabla nueva, sin backfill, sin tocar nada existente. `downgrade` la elimina.

## Open Questions

- ¿Hace falta una herramienta para fusionar dos clientes duplicados? Hoy no existe. Recién se va a sentir cuando haya fiados cargados en los dos, así que se decide con datos reales en vez de ahora.
- ¿El teléfono debería participar de la identidad? Sería una segunda señal para detectar duplicados, pero hoy es opcional y casi siempre va vacío en el mostrador. Se descarta por ahora.
