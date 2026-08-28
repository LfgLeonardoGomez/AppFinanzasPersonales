## Context

C-37 dejó tres endpoints de solo lectura (`/api/estadisticas/compras|ventas|resumen`) y ningún consumidor. Este change construye el frontend que los usa. Es la última pieza de la etapa post-MVP que le falta al usuario final.

Estado actual relevante, verificado en el código y no en el roadmap:

- **No hay librería de gráficos en el proyecto.** `facturas-proveedores-web/package.json` no tiene Recharts, Chart.js, D3, visx ni uPlot.
- **Los tests corren en `environment: 'jsdom'`** (`vite.config.ts:84`) y **no está instalado el paquete `canvas`**.
- **No hay tier e2e con navegador**: no hay Playwright; `tests/` contiene solo `design-system-guard.test.ts` y `frontend-lint.test.ts`.
- **`src/shared/api/api.d.ts` no conoce las estadísticas.** No hay `Granularidad` ni ninguno de los cinco schemas de C-37. C-41 (generación desde OpenAPI) sigue pendiente, así que ese archivo se mantiene a mano.
- **`VentasPage` ya usa `desde`/`hasta` en los search params** con el significado *"filtrar la lista de ventas"*, y por defecto valen HOY (`VentasPage.tsx:25-26`, C-34 design D9).
- **`tests/design-system-guard.test.ts` escanea solo** `features/ventas`, `features/clientes` y `shared/components/ClienteAutocomplete` (`scanDirs`, línea 65).
- Piezas reutilizables ya existentes: `FORMA_PAGO_LABELS`, `formatMonto`, `Card`, `LoadingState`, y el patrón de carga de `TotalesDelDia`.

Contrato del backend, leído de `app/routers/estadisticas.py`, `app/schemas/estadisticas.py`, `app/services/estadisticas_service.py` y `app/models/enums.py`:

- `granularidad` ∈ `dia` | `semana` | `mes`; la semana arranca lunes.
- Series **rellenadas con ceros** por el backend. `desglose` trae siempre las 5 `FormaPago` y `sum(desglose) == total` por construcción.
- `MAX_PERIODOS = 400`. Excederlo → **422**. Rango invertido → **422**. `proveedor_id` ajeno → **404**.
- Los montos son `Decimal` en Pydantic y **llegan por el cable como string JSON**, no como número: Pydantic v2 serializa `Decimal('1234.50')` como `"1234.50"`. Verificado ejecutando Pydantic 2.13.4 del propio backend, no asumido.

## Goals / Non-Goals

**Goals:**

- Que las tres estadísticas que ya calcula el backend sean visibles y usables desde la app.
- Que todo número mostrado sea **exactamente** el que devolvió el backend, sin aritmética intermedia en el cliente.
- Que las vistas sean testeables con el tier que el proyecto ya tiene (vitest + jsdom + testing-library), sin agregar infraestructura de testing.
- Que la feature nueva nazca dentro de los guards existentes, no fuera.

**Non-Goals:**

- **Ningún cálculo en el frontend.** Ni sumas, ni promedios, ni reagrupaciones, ni relleno de huecos. Si un número no vino del backend, no se muestra.
- **Ninguna noción de margen o rentabilidad.** El backend expone `diferencia` y se muestra como `diferencia` (C-37 D6).
- **Ningún cambio en el backend.** C-38 no toca `facturas-proveedores-api`.
- **Ninguna exportación** de estas vistas. C-39 cubrió cuenta corriente; extenderlo a estadísticas es scope nuevo.
- **Ningún tier e2e.** Instalar Playwright para este change sería desproporcionado (governance BAJO).

## Decisions

### D1 — Gráficos con visx (SVG), no con una librería sobre canvas

**Decisión**: `@visx/shape` + `@visx/scale`.

**Por qué**: el criterio no es estético, es de testabilidad. Los tests corren en jsdom **sin el paquete `canvas`**, donde `getContext('2d')` devuelve `null`: una librería sobre canvas no dibuja nada afirmable. La única forma de "testearla" sería afirmar que el constructor recibió tal array — un test que valida la preparación de datos y **no** que la pantalla muestre algo, es decir un test tautológico. Este proyecto ya cazó y borró uno de esos (`test_alembic_migration_0003.py`). Y no hay tier e2e donde compensar la ceguera.

visx renderiza nodos SVG reales: quedan en el DOM y `getByText`/`getByRole` los ven.

**Alternativas consideradas**:
- **uPlot** (~40KB, canvas): descartada por lo anterior. Se evaluó la variante "canvas decorativo + tabla HTML como fuente de verdad", que es legítima y accesible, pero implica pagar peso y fricción con React por un adorno mientras la información real la sirve HTML plano.
- **Recharts** (~100KB gzip, SVG): testeable, pero pesada para una PWA y sus estilos hay que domarlos contra el design-system guard de C-34. visx da el mismo SVG con una fracción del peso y control total del markup.
- **Sin librería** (SVG a mano): viable — son barras. Se prefiere visx porque `@visx/scale` resuelve el escalado, que es justamente donde un cálculo a mano se equivoca en silencio.

### D2 — Las estadísticas viven en su propia ruta, NO dentro de `VentasPage`

**Decisión**: nueva ruta `/estadisticas` que hospeda el panel de ventas por período y el de contraste compras vs. ventas, ambos bajo **un** selector de rango y granularidad. El panel de compras por proveedor se monta dentro de `ProveedorDetailPage`, con su propia instancia del selector.

**Por qué**: `VentasPage` **ya escribe `desde`/`hasta` en los search params**, y ahí significan *"filtrá la lista"*, con default HOY (`VentasPage.tsx:25-26`). Montar las estadísticas en esa misma pantalla pondría dos significados distintos sobre los mismos dos parámetros de la misma URL. Eso no es un problema de prolijidad: es un bug esperando — el usuario mueve el rango del gráfico y se le filtra la lista, o al revés, y ninguna de las dos cosas es lo que pidió. Separar las rutas separa los significados.

Además, el contraste compras vs. ventas no pertenece ni a la ficha de un proveedor ni a la lista de ventas: es del negocio entero. Necesitaba una casa propia igual.

**Alternativa considerada**: agregar una sección de estadísticas a `VentasPage` y otra a alguna pantalla existente para el contraste. Rechazada por la colisión de parámetros descrita.

### D3 — El selector es un componente compartido con estado por ruta, no un store global

**Decisión**: un componente `RangoGranularidadSelector` + un hook que lee y escribe `desde`/`hasta`/`granularidad` en los search params de **la ruta donde está montado**. Sin Zustand.

**Por qué**: "compartido" acá significa *la misma pieza de UI*, no *el mismo valor sincronizado entre pantallas*. Un store global haría que abrir la ficha de un proveedor le cambie el rango a la pantalla de estadísticas y viceversa — acoplamiento que nadie pidió. Con search params, cada ruta tiene su propio estado, la vista queda enlazable y sobrevive al refresh, que es el patrón que el proyecto ya usa en `VentasPage` (C-34 D9).

### D4 — Los tipos se escriben leyendo `app/schemas/estadisticas.py`, y se blindan con un test de tipos

**Decisión**: agregar `Granularidad`, `PeriodoTotal`, `ComprasResponse`, `VentaPeriodo`, `VentasResponse` y `ResumenResponse` a la capa de contratos del frontend, transcritos **leyendo el schema de Pydantic**, y agregar un `api.estadisticas.test-d.ts` siguiendo el patrón de `api.types.test-d.ts` y `api.cuentaCorriente.test-d.ts`.

**Por qué**: C-41 sigue pendiente, así que `api.d.ts` se mantiene a mano y **ya mintió antes** — `FacturaListItem` declaraba 12 campos cuando la API devolvía 6. Transcribir de memoria repite exactamente ese error.

Cuando C-41 genere los tipos desde OpenAPI, estas definiciones se reemplazan por las generadas; el test de tipos es lo que va a avisar si difieren.

> **Corrección hecha durante el apply.** Una versión anterior de este design afirmaba que los montos llegaban como número JSON. **Es falso**: Pydantic v2 serializa `Decimal` como string. Se detectó ejecutando Pydantic contra el propio backend en lugar de transcribir de memoria — exactamente el riesgo que este D4 existe para evitar, encontrado por el procedimiento que este D4 manda usar.

### D4b — Los decimales se parsean en el límite, con el patrón `Raw*` + `parse*` que ya usa cuenta corriente

**Decisión**: interfaces `Raw*` internas al módulo de API que espejan el cable (decimales como `string`), y una función de parseo en el límite que devuelve los tipos públicos con los montos ya como `number`. Es el patrón exacto de `parseCuentaCorriente` (C-13, D13), que `PropuestaFactura.monto_total` también sigue.

**Por qué number y no string**: el gráfico necesita números para escalar; dejar strings empujaría la conversión hacia adentro de los componentes, que es donde se convierte N veces y en algún lado mal.

**Y esto importa especialmente acá**: `parseCuentaCorriente` **lanza un `Error` tipado si un decimal sale `NaN`**, en vez de degradar a `0`, para que el hook exponga `isError` en lugar de corromper el saldo. En una pantalla de estadísticas ese detalle es todavía más grave que en cuenta corriente: un `0` fabricado por un parseo fallido es **indistinguible de un período legítimo sin movimiento**, que es justo el valor que estas vistas muestran todo el tiempo (D6, D7). Un dato roto se vería exactamente como un dato verdadero. Se replica el `throw`, no el `|| 0`.

### D5 — Los dos 422 del backend se distinguen por la forma del `detail`

**Decisión**: el manejo de errores discrimina por el tipo de `detail`:

| Caso | `detail` | Qué muestra la UI |
|---|---|---|
| Tope de períodos excedido | **objeto** con `mensaje`, `periodos_estimados`, `tope`, `sugerencia` | Rango demasiado grande para esa granularidad + la acción correctiva |
| Rango invertido | **string** `"`desde` no puede ser posterior a `hasta`."` | Rango inválido |
| Proveedor ajeno | 404, `"Proveedor not found"` | Proveedor inexistente |

**Por qué**: el backend ya emite la distinción de fábrica — el tope manda un objeto estructurado, el rango invertido manda una cadena. Discriminar por `typeof detail === 'object'` es leer lo que el backend ya dice, en vez de parsear texto en castellano, que se rompe el día que alguien corrige una tilde.

El 422 por tope **no es un error inesperado**: es el backend explicando cómo pedir bien. Mostrarlo como "algo salió mal" convertiría una instrucción accionable en un callejón sin salida.

### D6 — Los períodos en cero se muestran; el rango entero en cero se explica

**Decisión**: se renderizan todos los períodos recibidos, ceros incluidos. Si **todos** los períodos vienen en cero, se muestra además un mensaje de "sin movimiento en el rango".

**Por qué**: el backend rellena los huecos a propósito (C-37 D2) para que el gráfico no invente una tendencia uniendo dos fechas no consecutivas. Que el frontend filtre los ceros desharía esa decisión. Pero un gráfico de barras todas en cero es visualmente indistinguible de un gráfico roto, y ahí el texto es el que desambigua.

### D7 — Mientras carga no se muestran ceros

**Decisión**: estado de carga explícito (el patrón de `TotalesDelDia`: región presente desde el primer render, con afordancia de carga en lugar de valores).

**Por qué**: `TotalesDelDia` (C-34 D2) ya estableció que un `$0` durante la carga es indistinguible de un `$0` real, y solo el segundo es verdad. En una pantalla de estadísticas el problema es peor, porque el cero es un valor legítimo y frecuente: el usuario no tiene forma de saber si no vendió nada o si todavía no llegó la respuesta.

### D8 — El guard de design system se extiende antes de escribir la feature

**Decisión**: agregar `src/features/estadisticas` a `scanDirs` en `tests/design-system-guard.test.ts`, y verificar que el guard **falla de verdad** ante un color hardcodeado en la feature nueva antes de dar la tarea por hecha.

**Por qué**: el guard escanea una lista fija de directorios. Una feature nueva nace **fuera** de él, en silencio. C-40 ya pagó esa lección: `frontend-lint.test.ts` existía en el repo, nunca se había ejecutado, y era un guard que no guardaba nada. La verificación negativa (romperlo a propósito y ver que falla) es lo que distingue "el guard está listado" de "el guard guarda".

## Risks / Trade-offs

- **Los tipos escritos a mano pueden derivar del backend** → Se transcriben leyendo `app/schemas/estadisticas.py`, no de memoria, y se blindan con `api.estadisticas.test-d.ts`. Mitigación real y definitiva: C-41.
- **visx es la primera dependencia de gráficos del proyecto y suma peso al bundle** → Se importan solo `@visx/shape` y `@visx/scale`, que son paquetes independientes y tree-shakeables; no se instala el meta-paquete `visx`.
- **El SVG a mano puede quedar inaccesible** → Todo valor representado en el gráfico existe también como texto accesible (spec: *"Los gráficos se renderizan en SVG y su información es legible sin el gráfico"*). El gráfico ilustra; el texto informa.
- **El tope de 400 períodos es alcanzable sin querer**: en granularidad `dia`, cualquier rango mayor a ~13 meses lo excede. → Es por eso que el 422 se trata como instrucción accionable (D5) y no como error. Vale además elegir un rango por defecto que no arranque cerca del tope.
- **`ProveedorDetailPage` gana una responsabilidad más** (ya monta cuenta corriente y el diálogo de edición) → El panel de compras entra como componente autónomo de la feature `estadisticas`, montado ahí; la página solo le pasa el `proveedor_id`.

## Migration Plan

No aplica migración de datos: el change es aditivo y de solo lectura. El backend no cambia, así que no hay orden de despliegue que respetar ni ventana de incompatibilidad. Rollback = revertir el frontend; los endpoints de C-37 quedan donde estaban.

## Open Questions

- **Rango por defecto**: se propone *últimos 12 meses en granularidad `mes`* para el panel de compras y contraste, y *últimos 30 días en `dia`* para ventas. Ninguno se acerca al tope de 400. Confirmable en apply si el usuario prefiere otro.
