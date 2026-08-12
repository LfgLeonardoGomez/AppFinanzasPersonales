## Context

El frontend es React + TypeScript + Vite, con TanStack Query para servidor, Zustand para sesión, y tipos generados desde el OpenAPI del backend (`npm run generate-types` → `src/shared/api/api.d.ts`). El sistema de diseño violeta/magenta ya está establecido, con primitivos compartidos en `src/shared/components/` (`Button`, `Card`, `InputField`, `PageHeader`, `EmptyState`) y diálogos sobre Radix desde C-20/C-27.

`RegisterPage` existe y conoce un solo camino de alta. `SupplierSearch` es el precedente más cercano a lo que hace falta acá en materia de listado + acción.

**Lo que este change hereda como deuda**: `api.d.ts` fue generado antes de C-28 y todavía declara `usuario_id`. El proyecto compila porque los tipos son viejos, no porque el código esté bien.

## Goals / Non-Goals

**Goals:**
- Que un empleado con un código pueda entrar solo, sin que nadie le toque la cuenta.
- Que el admin gestione su equipo sin salir de la app.
- Que el código de invitación se entregue de una forma que no se pierda por accidente.
- Sincronizar los tipos con el backend real y dejar que el compilador encuentre lo que quedó colgando.

**Non-Goals:**
- Promoción de admin: no existe en el backend (D-40) y ofrecerlo sería mentir.
- Invitar por email desde la app: el backend no manda mails hasta C-31.
- Rediseñar el registro más allá de partirlo en dos caminos.

## Decisions

### D1 — La regeneración de tipos va en su propio commit, primero

`generate-types` reescribe `api.d.ts` entero, así que su diff mezcla lo de C-28 (`usuario_id` → `negocio_id`) con lo de C-29 (endpoints de equipo) y ruido de nombres de operaciones. Mezclado con las pantallas nuevas, el resultado es irrevisable.

Orden: regenerar → arreglar lo que rompa → commitear eso solo. Recién después, las pantallas.

**Prerrequisito operativo**: el backend tiene que estar corriendo con el código de C-29. Regenerar contra un contenedor viejo deja los tipos peor que antes, y en silencio.

### D2 — Dos caminos con un selector explícito, no dos rutas

`RegisterPage` mantiene una sola ruta (`/registro`) con un selector visible arriba del formulario. Los campos cambian según el camino: el de creación pide nombre del negocio (opcional), el de invitación pide código.

**Alternativa considerada**: dos rutas separadas (`/registro` y `/registro/invitacion`). Se descarta porque el empleado llega con un código en la mano y sin saber que existe una URL distinta; si cae en la equivocada, el sistema le crea un negocio propio y vacío **sin ningún error**. Un selector a la vista hace visible la bifurcación en el momento en que importa.

### D3 — El código de invitación se muestra en un diálogo que exige un acto deliberado para cerrarse

El código aparece en un `Dialog` de Radix con el valor en grande, un botón de copiar, y la advertencia de que no se puede recuperar. El cierre es explícito, no por click en el backdrop.

Es la única pantalla del sistema donde cerrar sin leer tiene un costo real. Suprimir el dismiss por backdrop ya tiene precedente en el proyecto: `DeleteProveedorDialog` lo hace por la misma razón (D-25).

### D4 — `es_admin` viene del usuario en sesión, y la UI solo decide qué ofrecer

`UsuarioResponse` ya expone `es_admin` desde C-28, así que el store de sesión lo tiene sin pedir nada nuevo. La navegación y la ruta lo consultan para decidir qué mostrar.

Esto **no es control de acceso** — el backend responde 403 pase lo que pase. Es evitar ofrecer un camino que termina en error. Vale escribirlo porque es la clase de cosa que alguien lee después y confunde con seguridad.

### D5 — Los errores del dominio se traducen, no se propagan

Dos respuestas del backend tienen significado propio y merecen texto propio:

- **400 en el registro por código**: mensaje único, sin distinguir motivo — el backend lo hace a propósito (D-41) y la UI no debe inventar precisión que no tiene. El texto orienta a la acción: pedile otro código a tu administrador.
- **409 al desactivar**: explicar que el negocio quedaría sin administración. Un "error inesperado" acá deja al admin probando de nuevo sin entender.

El resto de los errores usa el manejo genérico ya existente.

### D6 — Se arregla lo que rompa la regeneración, sin ampliar el alcance

Al regenerar, TypeScript va a marcar `FacturaFormPage.tsx:55` y unos 43 fixtures de test. La corrección es reemplazar el campo, no rediseñar nada. Cualquier otro hallazgo que aparezca se anota, no se arregla acá.

## Risks / Trade-offs

**[Regenerar contra un backend desactualizado]** → Rompería los tipos en silencio y en la dirección contraria. Mitigación: verificar la versión del backend antes de regenerar, y revisar que el diff resultante contenga `negocio_id` y los endpoints de equipo. Si no los tiene, el contenedor está viejo.

**[43 fixtures a tocar]** → Superficie grande y mecánica. El riesgo real no es romper algo, es debilitar una aserción de paso. Regla: si un test falla por algo que no sea el nombre del campo, se reporta en vez de ajustarse.

**[El admin pierde el código]** → Mitigado con el diálogo deliberado y el botón de copiar, no eliminado. Es recuperable generando otro, así que se prefiere esa fricción antes que guardar el código en claro.

**[La UI oculta la sección de equipo y alguien la confunde con seguridad]** → Documentado en D4 y en el spec: la autoridad es el backend. Ocultar es cortesía.

## Migration Plan

No hay datos ni migraciones. El despliegue es un build estático. El único orden que importa es interno al change: los tipos primero, las pantallas después.

## Open Questions

- ¿Conviene mostrar las invitaciones pendientes en la pantalla de equipo? El backend puede listarlas (`list_by_negocio` existe) pero no hay endpoint expuesto, y sin revocación tampoco habría mucho para hacer con ellas. Se deja para cuando exista la revocación.
