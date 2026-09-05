## Context

Este change es de **arquitectura de información**: mueve cosas de lugar y cambia jerarquías. No agrega ni quita capacidades de negocio, no toca el backend y no modifica el mapa de rutas.

Estado actual relevante, verificado en el código:

| Pieza | Dónde | Situación |
|---|---|---|
| Home | `src/app/HomePage.tsx` | Saludo + héroe de carga IA + "Proveedores frecuentes" + "Actividad reciente". Sin acceso a ventas. |
| Navegación | `src/shared/components/AppLayout/AppLayout.tsx` | Un único array `NAV_ITEMS` que alimenta a la vez el sidebar de escritorio y la barra inferior móvil (LAYOUT.md, "una única definición de navegación"). Estadísticas en tercer lugar. |
| Datos de la home | `src/features/home/api/{homeApi,homeHooks}.ts` | Dos hooks consumidos exclusivamente por `HomePage`. Sin tests propios. |
| Panel de compras | `src/features/estadisticas/PanelComprasProveedor.tsx` | Montado por `ProveedorDetailPage`. Único consumidor de la ruta de datos de compras del frontend. |
| Ruta `/ventas/nueva` | `src/app/router.tsx` | Ya existe, renderiza `VentaFormPage`. Este change solo la enlaza desde la home. |

Restricciones que gobiernan el diseño:

- **`visx` (SVG) es la librería de gráficos y canvas está prohibido** (D-85). Los tests corren en `jsdom` sin el paquete `canvas`.
- **`/estadisticas` no se consolida dentro de `/ventas`** (D-86): `VentasPage` ya usa `desde`/`hasta` con el significado "filtrá la lista".
- **Los decimales se parsean en el borde de cada cliente de API y un valor malformado lanza, nunca degrada a `0`** (D-88, D-94, capability `api-contract-types`).
- **Un tipo de contrato se DERIVA de `api.generated.d.ts`; no hay un tercer lugar** (C-41): o deriva de un schema, o va en la sección rotulada a mano de `api.d.ts` con su motivo.
- Suite frontend base: **1035 passed / 126 archivos**, `tsc --noEmit` y `eslint --max-warnings 0` limpios.

## Goals / Non-Goals

**Goals:**

- Que la acción que genera ingresos —registrar una venta— sea alcanzable desde la pantalla de inicio y sea el elemento más prominente.
- Que el orden del menú refleje la frecuencia de uso real del negocio.
- Que "Proveedores frecuentes" y "Actividad reciente" sigan existiendo, con sus endpoints intactos, en la pantalla donde tienen contexto.
- Que el retiro del panel de compras se refleje en los specs con la misma formalidad con que se incorporó.
- Terminar sin código huérfano ni tests que pasen sin ejercitar nada.

**Non-Goals:**

- **Renombrar el proyecto.** Hace falta genuinamente (la app ya no es "facturas a proveedores"): repo, servicios `facturas_api`/`facturas_web`/`facturas_db` del compose, nombres de imagen, `package.json`, los directorios `facturas-proveedores-api/` y `facturas-proveedores-web/`, los alias de path. Meterlo acá produciría un diff donde un reordenamiento de una línea del menú es indistinguible de cientos de renombres mecánicos, y volvería miserable bisecar cualquier regresión. Va en su propio change.
- **Rediseñar la pantalla de estadísticas.** Acá solo cambia su posición en el menú. La pantalla no se toca.
- **Poner estadísticas en la home.** Es un no-goal ACTIVO, no una omisión (ver D1).
- Cualquier cambio en Ventas, Clientes, Facturas, Pagos, Perfil o Equipo.
- Cualquier cambio en el backend.

## Decisions

### D1 — La home es una superficie de ACCIÓN; los números están prohibidos ahí

**Decisión:** la home ofrece dos acciones —"Vender ahora" (primaria, hacia `/ventas/nueva`) y "Cargar con IA" (secundaria, se conserva)— y **ningún dato**: ni totales, ni contadores, ni gráficos, ni listados de movimientos. Tras el cambio la home **no emite ninguna request HTTP**.

**Por qué:** el motivo declarado para degradar Estadísticas es que "no muestra nada relevante — es información que ya vemos en otras vistas". Un tablero en la home sería esa misma información una tercera vez. La home es lo primero que se ve al abrir la app parado en el mostrador: su trabajo es sacarte de ahí hacia la tarea, no darte para leer.

**Cómo se hace verificable:** "es lo más prominente" no es afirmable en un test. Lo que sí lo es: la acción de venta es la **primera acción en el orden del DOM** de la región principal, y la pantalla **no contiene ningún texto con formato de moneda** ni ningún gráfico expuesto como `role="img"`. Esa segunda aserción es la que impide que dentro de seis meses alguien vuelva a colgar un total "chiquito" en la home.

**Alternativa descartada:** un "resumen del día" mínimo (ventas de hoy). Se descartó por lo anterior: `/ventas` ya muestra los totales del día (requisito vigente de `ventas-frontend`), y duplicarlos abre la puerta a que los dos números se desincronicen y a que la home vuelva a ser un tablero por acumulación.

### D2 — `features/home/api/*` se disuelve dentro de `features/proveedores/`

**Decisión:** el directorio `src/features/home/` se **elimina**. Su contenido se reparte así:

| Origen | Destino | Forma |
|---|---|---|
| `getProveedoresFrecuentes` / `useProveedoresFrecuentes` | — | **Se borran.** Son `listProveedores({ page: 1, orderBy: 'saldo' })` + un corte a 6. El panel llama directo a `useProveedores({ orderBy: 'saldo' })` (hook del propio feature) y corta en el componente. |
| `ProveedorFrecuente` | — | **Se borra.** Es `ProveedorListItem` más `ultima_factura_fecha`, y C-41 ya incorporó ese campo al tipo derivado: la extensión es un no-op. |
| `getActividadReciente` / `useActividadReciente` | `features/proveedores/api/actividadRecienteApi.ts` y `actividadRecienteHooks.ts` | Se mueven, ahora con borde de parseo. |
| `ActividadRecienteItem` | `shared/api/api.d.ts`, sección derivada | `DecimalAsNumber` sobre el schema `ActividadRecienteItem`, con `monto` convertido. |

**Por qué disolver y no mover el directorio entero:** después del cambio, ningún consumidor se llama "home". Un directorio `features/home/` cuyo único cliente vive en `features/proveedores/` nombra a un dueño que ya no existe, y un import `@features/home/...` desde adentro de `features/proveedores/` es exactamente el acoplamiento entre features que la estructura por features existe para evitar.

**Por qué el destino es `proveedores` y no `shared`:** ambos datasets tienen un único consumidor —la pantalla `/proveedores`— y ninguno es genérico. Un helper compartido con un solo llamador es un helper compartido inventado.

**Nota sobre `actividad-reciente`:** el endpoint mezcla facturas y pagos, así que "pertenece a proveedores" es discutible en abstracto. Manda el consumo real: lo consume una sola pantalla, y es la de proveedores. Si mañana lo consume una segunda, ese será el momento de subirlo, con dos llamadores que justifiquen la abstracción.

### D3 — Al relocalizar, el cliente se pone al día con C-41 (no es scope creep: es incumplimiento)

`features/home/api/homeApi.ts` **incumple hoy** tres requisitos ya vigentes de `api-contract-types`:

1. `ActividadRecienteItem` está escrito a mano pese a existir el schema homónimo en `api.generated.d.ts` — viola "las formas del contrato se derivan del OpenAPI del backend".
2. `getProveedoresFrecuentes` castea la respuesta cruda a `ProveedorListItem[]`, cuyo `saldo` promete `number` mientras el wire manda `string` — viola "un tipo público no declara un valor monetario como número sin que exista una conversión que lo produzca". `HomePage` lo tapaba con un `Number(...)` en el render.
3. `ActividadRecienteItem.monto` es un `Decimal` del backend expuesto como `string` y formateado con un `formatARS` local que degrada a `0` ante un valor no finito — exactamente lo que D-88 prohíbe.

**Decisión:** se corrigen los tres al mover. Ninguno requiere modificar un requisito — el archivo simplemente no los cumple. Mover un cliente que miente hacia adentro de un feature que sostiene el borde de parseo plantaría la inconsistencia en el peor lugar posible.

**Consecuencia:** el nuevo `actividadRecienteApi.ts` sigue el patrón de `proveedoresApi.ts`: interfaz `Raw` interna, función de parseo, y una conversión que **lanza** ante cadena vacía o valor no finito. Y se agrega la aserción de compilación de `ActividadRecienteItem` en `api.contract.test-d.ts`, junto al resto.

### D4 — El signo del saldo lo manda la pantalla destino, no el origen

`HomePage` mostraba el saldo con un formateo local (deuda en positivo, en rojo). `ProveedoresList` —que vive en la misma pantalla destino— usa `formatSaldo`, que **invierte el signo** (deuda en negativo), más `saldoColorClass`.

**Decisión:** el panel relocalizado adopta `formatSaldo` y el mismo criterio de color.

**Por qué:** dos paneles en la misma pantalla mostrando el saldo del mismo proveedor con signos opuestos no es una inconsistencia estética, es una lectura contradictoria del mismo dato. Es un cambio visible respecto de la home actual, y es deliberado.

### D5 — Retirar el panel de compras arrastra toda la ruta de datos de compras

Con `PanelComprasProveedor` fuera, quedan sin ningún consumidor en producción:

- `getCompras` y `ComprasQuery` (`estadisticasApi.ts`)
- `useCompras` y la clave `compras` de `ESTADISTICAS_KEYS` (`estadisticasHooks.ts`)
- `parseCompras`, `parsePeriodoTotal` y `RawComprasResponse` (`estadisticasParse.ts`)
- la variante `compras` de `VistaEstadisticas` y la rama de 12 meses de `rangoPorDefecto` (`utils/rangos.ts`)
- la clasificación `proveedor-inexistente` y su copy en `EstadisticasError`

**Decisión: se borran todos, junto con sus tests.**

**Por qué:** un cliente de API probado que ningún componente consume es una suite que pasa sin proteger nada — la misma clase de test que este repo ya cazó y borró una vez. Y el caso `proveedor-inexistente` es peor que inútil: su copy dice literalmente "Este proveedor no existe", y los dos endpoints que siguen consumiéndose (`/ventas`, `/resumen`) no reciben `proveedor_id`, así que esa rama solo podría llegar a mostrarse como una mentira.

**Alternativa considerada — dejarla dormida:** el dueño ya anunció un rediseño de la pantalla de estadísticas, que muy probablemente vuelva a necesitar compras. Se descartó: son alrededor de 150 líneas a reescribir, las reescribirá el diseño nuevo con la forma que ese diseño pida, y mientras tanto el código dormido se pudre en silencio. **Trigger para revisar esta decisión:** el change de rediseño de estadísticas la revierte deliberadamente, con contexto propio.

**Lo que NO se toca:** `SerieBarras` sigue vivo (lo usa `PanelVentas`), y con él `@visx/shape` y `@visx/scale`. `RangoGranularidadSelector`, `useRangoGranularidad`, `etiquetas.ts`, `EstadisticasError` (sin la rama borrada) y `clasificarError` (sin la rama borrada) siguen en uso desde `EstadisticasPage`. **Ninguna dependencia de npm queda huérfana; no se desinstala nada.**

### D6 — El retiro del requisito de C-38 va por delta `REMOVED`, y arrastra dos `MODIFIED`

C-38 fue archivado y su delta ya se fusionó en `openspec/specs/estadisticas-frontend/spec.md`. Editar ese archivo a mano dejaría el retiro sin rastro en la historia de changes.

**Decisión:**

| Operación | Requisito | Motivo |
|---|---|---|
| `REMOVED` | "Total comprado por proveedor en su ficha" (`estadisticas-frontend`) | El panel se retira. |
| `MODIFIED` | "Selector compartido de rango y granularidad" (`estadisticas-frontend`) | Dice "Las tres vistas de estadísticas". Quedan dos, y ambas sobre una única ruta. |
| `MODIFIED` | "El tope de períodos del backend se comunica como algo accionable" (`estadisticas-frontend`) | Su escenario "Proveedor ajeno al negocio" describe un 404 de `/compras` con `proveedor_id`, inalcanzable tras el retiro. |
| `REMOVED` | "Home quick-access surfaces the cuenta-corriente view" (`cuenta-corriente-frontend`) | Describe una `HomePage` inlineada en `router.tsx` que dejó de existir con el rediseño de UX/UI. Este change define qué es la home; dejarlo vigente pondría los specs a contradecirse. |

Los `MODIFIED` copian el bloque **completo** del requisito (encabezado más todos sus escenarios) y luego editan, según pide el flujo de deltas: un `MODIFIED` parcial pierde detalle al archivar.

### D7 — Una sola definición de navegación, un solo lugar donde cambiar el orden

`AppLayout` alimenta el sidebar de escritorio y la barra inferior móvil desde el mismo array `NAV_ITEMS`. El cambio de orden es mover **una entrada** dentro de ese array.

**Decisión:** no se introduce ninguna estructura nueva. El test del orden se escribe **contra los dos landmarks de navegación** (el `aria-label` "Navegación principal" aparece dos veces), para que un futuro intento de divergir las dos listas rompa acá y no en producción.

`Equipo` conserva su ubicación actual: se concatena al final para admins, después de Perfil. No se mueve — el pedido nombra solo a Estadísticas.

### D8 — Orden de ejecución: primero relocalizar, después vaciar la home

**Decisión:** los paneles se montan y se prueban en `/proveedores` **antes** de sacarlos de la home.

**Por qué:** el orden inverso deja una ventana en la que el código está borrado y todavía no reubicado, y si algo interrumpe el trabajo ahí, lo que queda en el árbol es "se eliminaron dos secciones" — que es precisamente lo que este change decidió **no** hacer.

## Risks / Trade-offs

**[Los fixtures que se mueven entre features dejan de ser vistos por una corrida acotada]** → Confirmado dos veces en C-41: un fixture que mockea el endpoint de un cliente desde **fuera** del directorio de ese feature no aparece en una corrida por feature y solo sale en la suite completa. Este change mueve componentes y clientes entre features, así que es el escenario exacto. **Mitigación:** los tests de los paneles relocalizados declaran sus propios handlers MSW dentro de `features/proveedores/`, y toda tarea de movimiento se cierra con una corrida de la **suite completa**, nunca con una acotada al feature.

**[Borrar la ruta de compras rompe algo que sí se consumía]** → Se verificó por búsqueda que `PanelComprasProveedor` es el único consumidor de `useCompras`, y que `SerieBarras` sobrevive vía `PanelVentas`. **Mitigación:** cada borrado va en su propia tarea con corrida completa después; `tsc --noEmit` detecta cualquier import colgado antes de que llegue a un test.

**[La home queda demasiado vacía]** → Dos acciones y un saludo es poco contenido. Es el resultado buscado, no un efecto colateral: la home es un trampolín, no un destino. **Mitigación:** ninguna. Si el dueño la ve pobre al usarla, la respuesta correcta es agregar **otra acción**, no un dato.

**[Cambiar el signo del saldo confunde a quien ya se acostumbró a la home]** → El panel pasa a mostrar la deuda en negativo (D4). **Mitigación:** es la convención que ya rige en `/proveedores`, la pantalla donde el panel ahora vive; la inconsistencia se resuelve hacia el destino, no hacia el origen.

**[Derivar `ActividadRecienteItem` del schema expone una divergencia latente]** → Si el schema generado difiere de lo que el tipo escrito a mano asumía, la derivación falla en compilación. **Mitigación:** eso es el comportamiento deseado, no el riesgo. Se verificó que el schema declara `monto` como cadena, `proveedor_nombre` como opcional o nulo y `tipo` como unión de `factura` y `pago` — coincide con el tipo a mano salvo por la opcionalidad de `proveedor_nombre`, que la derivación va a exponer y hay que resolver explícitamente en el parseo, igual que hace `parseProveedorListItem` con `ultima_factura_fecha`.

**[Test frágil conocido]** → `src/features/ia-vision/PropuestaIAModal.e2e.test.tsx`, el caso del contador, es sensible al timing bajo carga. No es de este change; no perseguirlo.

## Migration Plan

No hay migración de datos ni de esquema. El despliegue es un build de frontend.

- **Backend:** sin cambios. No hace falta reconstruir la imagen (`docker compose build api` solo aplica a changes que suman dependencias de Python).
- **Rollback:** revertir el commit del frontend. No queda estado persistido que dependa de este change.
- **Compatibilidad:** los endpoints `GET /api/actividad-reciente` y `GET /api/estadisticas/compras` siguen sirviendo. El segundo queda sin consumidor en el frontend, lo cual es visible en los specs (`estadisticas-backend` lo mantiene especificado) y no es una regresión.

## Open Questions

Resueltas por el dueño del producto antes del apply (2026-09-05). Se dejan asentadas
con su respuesta para que el apply no las vuelva a tratar como supuestos.

1. **¿"Vender ahora" navega o abre un modal?** → **RESUELTA: navega** a `/ventas/nueva`.
   Es la ruta existente y ya testeada (`VentaFormPage`), no agrega superficie nueva
   (foco, escape, scroll, mobile) y mantiene el change acotado. Un modal habría exigido
   extraer o duplicar el formulario de venta. **No implementar modal.**
2. **¿La entrada de carga con IA sigue apuntando a `/facturas/nueva`?** → **RESUELTA: sí,
   se deja como está.** Hoy arrastra un `TODO(redesign)` heredado de C-21 que nunca se
   cerró. Cambiar el destino de la carga IA no está en el pedido y no entra acá.
   La deuda sigue abierta y documentada.
3. **¿Cuántos proveedores frecuentes se muestran en `/proveedores`?** → **RESUELTA: 6**,
   el límite actual. En una pantalla que ya lista todos los proveedores paginados, el
   número exacto pesa mucho menos que en la home.
4. **¿Dónde se ubican los dos paneles dentro de `/proveedores`?** → **RESUELTA: debajo**
   de la lista. La lista es a lo que el usuario viene; los paneles son contexto secundario.
   Ponerlos arriba obligaría a scrollear para llegar a lo que se fue a buscar.
