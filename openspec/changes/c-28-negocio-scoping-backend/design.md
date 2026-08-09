## Context

El backend aísla datos por `usuario_id`. El patrón es uniforme y eso es lo que hace viable este change: los routers pasan `current_user.id` como primer argumento del service, los services validan pertenencia en un helper `_get_owned*(usuario_id, recurso_id)` que levanta 404, y los repositories filtran por la columna. Nadie hace autorización en el router ni en el repository.

**Superficie medida**: 186 referencias a `usuario_id` en `app/`, 172 en `tests/` (32 archivos). Concentración en `services/` (105) y `repositories/` (34).

**Restricciones:**
- Hay datos reales en producción. La migración debe ser reversible y no puede perder filas.
- No hay ventana de mantenimiento definida ni despliegue azul-verde: la migración corre en el arranque del contenedor `api`.
- Los tests corren contra Postgres real en contenedor (regla dura del proyecto), así que la migración se puede ejercitar de verdad.
- TDD estricto activo: cada comportamiento nuevo entra con su test en rojo primero.

**Lo que hace crítico a este change** no es la dificultad técnica, es el modo de falla: un filtro mal migrado no rompe una pantalla, expone las facturas de un negocio a otro y no avisa.

## Goals / Non-Goals

**Goals:**
- Reemplazar el eje de aislamiento por `negocio_id` en `Proveedor`, `Factura` y `Pago`, **de una sola vez**, sin dejar ninguna ruta filtrando por `usuario_id`.
- Migrar los datos existentes preservando exactamente el mismo dueño efectivo que hoy.
- Dejar los campos `es_admin` y `desactivado` creados y con significado real (el login rechaza desactivados), listos para que C-29 construya la gestión de equipo encima.
- No cambiar ningún contrato HTTP: mismas rutas, mismos payloads, mismos códigos.

**Non-Goals:**
- Invitaciones, alta de empleados, endpoints de equipo, desactivar/reactivar desde la API y la guarda de último admin. Todo eso es **C-29**.
- Promover o degradar admins.
- Frontend. Este change no toca `facturas-proveedores-web`.
- Renombrar `usuario.nombre_negocio` o eliminar la columna: queda obsoleta pero viva, para no acoplar la migración de datos a un borrado destructivo.

## Decisions

### D1 — El `negocio_id` sale del `Usuario` hidratado, no de un claim del token

`get_current_user` ya hace un `SELECT` del `Usuario` en cada request (`deps.py:113-114`, D-C03-6 lo documenta como decisión consciente). El `negocio_id` viene en esa misma fila, gratis.

**Alternativa considerada**: meter `negocio_id` como claim del JWT, que es lo que pedía RN-NEG-09. Se descarta porque su premisa —"evitar una consulta a la base por request"— es falsa contra el código actual: la consulta ocurre igual. Y agregaría un modo de falla nuevo: un token emitido antes de desactivar a un usuario seguiría siendo válido hasta expirar, que es exactamente lo contrario de lo que `desactivado` tiene que garantizar.

**Consecuencia**: `security.py` no se toca. El token conserva `sub = usuario_id`. **RN-NEG-09 queda corregida en la KB como parte de este change.**

### D2 — Un solo commit lógico del eje, no una convivencia gradual

Todos los services y repositories de negocio cambian en el mismo change. No hay fase intermedia en la que unas tablas filtren por `usuario_id` y otras por `negocio_id`.

**Alternativa considerada**: migrar capacidad por capacidad (proveedores, después facturas, después pagos) con ambas columnas pobladas. Se descarta: durante la transición habría dos definiciones simultáneas de "ajeno", y las invariantes cruzadas (`Factura.negocio_id == Proveedor.negocio_id`) no se pueden expresar mientras una de las dos tablas todavía razona por usuario. La ventana de inconsistencia es justo donde se filtran datos.

### D3 — `desactivado` es un bool, no un `deleted_at`

La columna representa ciclo de vida de **acceso**, no borrado de UI. Mismo criterio que `RefreshToken.revoked_at` (D-17). Un `deleted_at` en `usuario` haría que las lecturas de negocio que filtran `deleted_at IS NULL` por convención empiecen a excluir usuarios, que no es lo que se quiere: los registros del empleado que se fue tienen que seguir visibles.

**Enforcement en este change**: `get_current_user` levanta 401 si `desactivado`. Revocar los refresh tokens al desactivar es parte de C-29, porque acá todavía no existe el endpoint que desactiva.

### D4 — `creado_por_usuario_id` es nullable y puramente informativo

Nullable porque las filas migradas de un usuario que después se borre no deben romper, y porque nada de la lógica depende de él. Se documenta explícitamente que **no se usa para filtrar**: es el campo que un futuro lector va a estar tentado de usar para "mostrar solo lo mío", y eso reintroduciría el eje viejo por la ventana.

### D5 — Migración en seis pasos dentro de una sola revisión Alembic

Una revisión `0006`, no seis. Alembic corre cada revisión en su propia transacción; partirla en varias abre la posibilidad de quedar a mitad de camino con `negocio_id` nullable en unas tablas y no en otras.

Orden interno, que importa:
1. Crear `negocio`.
2. Insertar un `Negocio` por cada `Usuario` (`nombre` desde `usuario.nombre_negocio`, fallback derivado de `usuario.nombre` si es nulo o vacío).
3. Agregar las columnas **nullable**: `usuario.negocio_id/es_admin/desactivado`, y `negocio_id` + `creado_por_usuario_id` en `proveedor`, `factura`, `pago`.
4. Backfill con `UPDATE ... FROM`: `usuario.negocio_id` ← su negocio nuevo; `<tabla>.negocio_id` ← el negocio del `usuario_id` de esa fila; `creado_por_usuario_id` ← ese mismo `usuario_id`; `es_admin = true` para todos los preexistentes.
5. Aplicar `NOT NULL` a las cuatro columnas `negocio_id` — recién ahora, con todo poblado.
6. Crear índices por `negocio_id` y rehacer los índices compuestos que hoy lideran con `usuario_id`.

`downgrade` invierte 6→1 y **no borra filas** de `usuario`, `proveedor`, `factura` ni `pago`.

**Alternativa considerada**: dejar `usuario_id` en las tablas de negocio como columna muerta. Se descarta: una columna muerta con datos plausibles es una invitación a que alguien vuelva a filtrar por ella. Se elimina en el mismo paso.

### D6 — El registro público entra en este change

No es scope creep, es coherencia forzada: con `usuario.negocio_id` NOT NULL, el `POST /api/auth/registro` actual falla. Se extiende `usuario_service.registrar(...)` para crear `Negocio` + `Usuario` en la misma transacción, con `es_admin = true`.

**Nota**: `CHANGES.md` ubicaba el registro con creación de negocio en C-29. Se mueve a C-28 y **se actualiza `CHANGES.md`** como parte de este change.

### D7 — Renombrar el parámetro, no solo el valor

En los services el primer argumento pasa de `usuario_id: uuid.UUID` a `negocio_id: uuid.UUID`, y los helpers `_get_owned(...)` cambian de nombre de parámetro. No se deja `usuario_id` como nombre de variable conteniendo un `negocio_id`: eso compila, pasa los tests, y es la clase de mentira que hace que el próximo lector cometa un error real.

### D8 — Qué NO se toca

`usuario_id` sigue siendo correcto donde significa identidad:
- `RefreshToken.usuario_id`, `usuario_repository`, `usuario_service` (auth y perfil).
- `security.py`: claim `sub`.
- `rate_limit_ia`: el cupo de IA es por usuario (RN-IA-07). Dos empleados no comparten cupo — si fuera por negocio, un empleado podría agotar el de todos.
- `actividad_service`: se migra a `negocio_id` porque lista actividad de **recursos de negocio**; la actividad pasa a ser la del local, no la de la persona.

## Risks / Trade-offs

**[El backfill asigna mal el negocio y mezcla datos de dos usuarios]** → El paso 4 deriva `negocio_id` del `usuario_id` de cada fila, no de un join ambiguo. Test de migración obligatorio: sembrar dos usuarios con proveedores, facturas y pagos propios, correr `upgrade`, y afirmar que ninguna fila cambió de dueño efectivo y que los dos conjuntos siguen disjuntos.

**[Queda una ruta filtrando por `usuario_id` y nadie lo nota]** → Test de regresión estructural que recorre `app/services/` y `app/repositories/` y falla si aparece `usuario_id` como filtro de pertenencia fuera de la lista blanca de D8. Es el mismo patrón AST que ya usa `test_pollution_fix.py` (D-22), así que hay precedente en el repo.

**[172 referencias en tests: la tentación de "arreglar" un test que falla]** → Un test de aislamiento que falla después del swap es una señal de fuga, no un test viejo. Los tests de aislamiento se reescriben para expresar **dos negocios**, no para relajar la aserción. Cualquier test cuya aserción se debilite tiene que quedar registrado en el reporte del apply.

**[El `downgrade` se prueba poco y falla el día que hace falta]** → El test de migración corre `upgrade` → `downgrade` → `upgrade` y afirma que los datos sobreviven al ciclo completo.

**[La migración corre al arrancar el contenedor, sin backup explícito]** → Se documenta en el reporte del apply que antes de desplegar a producción hay que tomar un dump. No se automatiza acá: está fuera del alcance del change y encima es una decisión de operación, no de código.

**Trade-off aceptado**: `usuario.nombre_negocio` queda como columna obsoleta y duplicada respecto de `Negocio.nombre` hasta que un change posterior la retire. Se prefiere una migración no destructiva a un esquema perfectamente limpio.

## Migration Plan

1. Revisión Alembic `0006` según D5, reversible y ejercitada por tests contra Postgres real.
2. Antes del deploy a producción: dump de la base. Manual, documentado en el reporte del apply.
3. `alembic upgrade head` corre en el arranque del contenedor `api`, como hoy.
4. Rollback: `alembic downgrade 0005` restaura el esquema anterior conservando los datos de negocio. La única pérdida aceptada es la tabla `negocio` y los tres campos nuevos de `usuario`.

## Open Questions

Ninguna bloqueante para implementar. Dos cosas quedan anotadas para C-29, no para acá:

- Cómo se promueve un segundo admin (hoy solo lo es quien creó el negocio).
- Si desactivar a un usuario debe además cerrar sus sesiones activas de inmediato — es lo esperable, pero el endpoint que desactiva todavía no existe.
