## Why

C-37 entregó los tres endpoints de estadísticas y los dejó **sin nadie que los mire**. El negocio puede preguntarle a la API cuánto compró, cuánto vendió y cómo le fue en el período, pero desde la app no hay forma de preguntarlo: no existe pantalla, no existe hook, y la capa de tipos del frontend (`src/shared/api/api.d.ts`) **no menciona la palabra "estadísticas" ni una vez**. Hoy esa funcionalidad solo es accesible con `curl`.

Este change cierra el pedido original que abrió toda la línea de estadísticas — *"quiero saber cuánto le compré a este proveedor"* — y además es lo último que le falta a la etapa post-MVP para que el usuario final vea la analítica que ya está calculada.

## What Changes

- **Nueva feature `src/features/estadisticas/`** con la capa de acceso (`estadisticasApi`, `estadisticasHooks`) sobre los tres endpoints de C-37.
- **Tipos de estadísticas escritos a mano** en la capa de contratos del frontend (`Granularidad`, `PeriodoTotal`, `ComprasResponse`, `VentaPeriodo`, `VentasResponse`, `ResumenResponse`). Hoy no existen. Ver el riesgo de deriva en *Impact*.
- **Primera librería de gráficos del proyecto: `visx`** (`@visx/shape` + `@visx/scale`). Renderiza **SVG**, no canvas. Ver *Impact* para por qué esa distinción no es estética.
- **Ficha de proveedor** (`ProveedorDetailPage`): sección de total comprado por período, acotada a ese proveedor vía `proveedor_id`. Cierra el pedido original.
- **Pantalla de ventas**: totales por período con el desglose por forma de pago que ya devuelve el backend.
- **Vista de contraste compras vs. ventas** del mismo período, alimentada por `GET /api/estadisticas/resumen`.
- **Selector de granularidad y rango compartido** entre las tres vistas, con el estado en URL search params (el patrón que ya usa `VentasPage`).
- **El guard de design system se extiende** a la feature nueva. Hoy `tests/design-system-guard.test.ts` escanea solo `features/ventas`, `features/clientes` y `shared/components/ClienteAutocomplete`: una feature nueva nace **fuera** del guard. C-40 ya dejó la lección de un guard que existía y no guardaba nada; no la repetimos.

### Lo que este change NO hace

- **No agrega ningún cálculo.** Todo número que se muestre viene de un endpoint de C-37. El frontend no suma, no promedia y no rellena huecos.
- **No inventa "margen" ni "rentabilidad".** El backend expone `diferencia` y se muestra como `diferencia` (C-37 D6): el sistema no sabe cuánto costó la mercadería que vendió.
- **No agrega exportación** de estas vistas. Eso es C-39 y ya está cerrado para cuenta corriente; extenderlo a estadísticas sería scope nuevo.

## Capabilities

### New Capabilities
- `estadisticas-frontend`: las tres vistas de estadísticas (compras por proveedor, ventas con desglose, contraste compras vs. ventas), el selector compartido de rango y granularidad, y el manejo de los estados que el backend puede devolver — incluido el 422 por tope de períodos.

### Modified Capabilities
<!-- Ninguna. `estadisticas-backend` no cambia de comportamiento: este change lo consume tal como está.
     `proveedores-frontend` y `ventas-frontend` reciben un punto de montaje, no un cambio de requisito. -->

## Impact

**Código afectado**
- Nuevo: `facturas-proveedores-web/src/features/estadisticas/`
- Modificado: `src/features/proveedores/ProveedorDetailPage.tsx` (punto de montaje), `src/features/ventas/VentasPage.tsx` (punto de montaje), `src/shared/api/api.d.ts` (tipos), `tests/design-system-guard.test.ts` (`scanDirs`)
- Backend: **cero**. C-38 no toca `facturas-proveedores-api`.

**Dependencias**
- `+ @visx/shape`, `+ @visx/scale`. Primera librería de gráficos del proyecto.
- **Por qué SVG y no canvas**: los tests corren en `environment: 'jsdom'` (`vite.config.ts:84`) y **no hay paquete `canvas` instalado**. Una librería sobre canvas (uPlot, Chart.js) no dibuja nada bajo jsdom — `getContext('2d')` devuelve `null` — y la única forma de "testearla" sería afirmar contra un mock, que es exactamente la clase de test tautológico que este proyecto ya cazó y borró una vez. visx renderiza nodos SVG reales: quedan en el DOM y se pueden afirmar. Tampoco hay tier e2e con navegador (no hay Playwright instalado), así que no existe una segunda red donde caerse.

**Contrato que este change consume (C-37, verificado en el código, no en el roadmap)**
- `granularidad` ∈ `dia` | `semana` | `mes`; la semana arranca **lunes**.
- Las series vienen **rellenadas con ceros**: un período sin movimiento llega con `total: 0`, no se omite. **El frontend no debe rellenar huecos** — ya vienen rellenos.
- `desglose` trae **siempre las 5 `FormaPago`**, con `0.00` donde no hubo movimiento, y `sum(desglose) == total` por construcción.
- **Tope de 400 períodos** (`MAX_PERIODOS`): un rango que lo exceda devuelve **422 con el conteo estimado**, no una serie truncada. La UI tiene que saber leer ese 422 y decirle al usuario que achique el rango o suba la granularidad — no puede mostrarlo como "error inesperado".
- Rango invertido (`hasta < desde`) → **422**.
- `proveedor_id` de otro negocio → **404** (RN de aislamiento por `negocio_id`).

**Riesgo conocido: deriva de tipos**
`C-41` (tipos TS generados desde OpenAPI) sigue pendiente, así que `api.d.ts` se mantiene **a mano**. Ese archivo ya mintió antes: `FacturaListItem` declaraba 12 campos cuando la API devolvía 6. Los tipos de estadísticas que agrega este change nacen con el mismo riesgo, y la mitigación acá es escribirlos leyendo `app/schemas/estadisticas.py`, no de memoria.

**Riesgo de UX heredado**
`TotalesDelDia` (C-34) estableció una regla que estas vistas deben respetar: **mientras carga no se muestra `$0`**. Un cero que significa "todavía no llegó" es indistinguible de un cero que significa "no vendiste nada", y solo el segundo es verdad. En una pantalla de estadísticas, donde el cero es un dato legítimo y frecuente, confundirlos es peor todavía.
