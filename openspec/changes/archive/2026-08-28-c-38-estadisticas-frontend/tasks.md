> **Strict TDD Mode activo.** Cada tarea de implementación va RED → GREEN → TRIANGULATE → REFACTOR. No se escribe código de producción sin un test que falle primero.
>
> **Regla que atraviesa todo el change**: si un número no vino del backend, no se muestra. Cero aritmética en el cliente (design.md Non-Goals).

## 1. Baseline y dependencias

- [x] 1.1 Correr la suite del frontend completa y registrar el baseline (`npm test`), más `npm run typecheck` y `npm run lint`. Si algo ya falla, reportarlo como falla preexistente y NO arreglarlo dentro de este change.
- [x] 1.2 Instalar `@visx/shape` y `@visx/scale` como dependencias de producción. NO instalar el meta-paquete `visx` (design.md Risks).
- [x] 1.3 Verificar que la suite sigue en el baseline después de instalar, y que el bundle sigue construyendo (`npm run build`).

## 2. Guard de design system — antes de escribir la feature (design.md D8)

- [x] 2.1 RED: agregar `src/features/estadisticas` a `scanDirs` en `tests/design-system-guard.test.ts` y crear un archivo temporal en esa feature con un color hexadecimal literal; confirmar que el guard **falla** e identifica ese archivo.
- [x] 2.2 GREEN: borrar el archivo temporal y confirmar que el guard vuelve a pasar. La verificación negativa es lo que distingue "el guard está listado" de "el guard guarda" (lección de C-40).

## 3. Capa de contratos (design.md D4)

- [x] 3.1 Transcribir a la capa de tipos del frontend, **leyendo `facturas-proveedores-api/app/schemas/estadisticas.py` y `app/models/enums.py`** (no de memoria): `Granularidad`, `PeriodoTotal`, `ComprasResponse`, `VentaPeriodo`, `VentasResponse`, `ResumenResponse`. En los tipos **públicos** los montos van como `number`; el cable los manda como `string` (Pydantic v2 serializa `Decimal` así) y se convierten en el límite — ver 4.0.
- [x] 3.2 Crear `src/shared/api/api.estadisticas.test-d.ts` siguiendo el patrón de `api.cuentaCorriente.test-d.ts`: fijar la forma de las tres respuestas y que `desglose` cubra las 5 `FormaPago`.
- [x] 3.3 Verificar que `npm run typecheck` pasa y que no se usó `any` en ningún punto.

## 4. Acceso a datos

- [x] 4.0 RED/GREEN: límite de parseo con el patrón `Raw*` + `parse*` de `parseCuentaCorriente` (design.md D4b). Interfaces `Raw*` internas con los decimales como `string`; el parseo devuelve los tipos públicos con montos `number`. **Un decimal que sale `NaN` lanza un `Error` tipado, NUNCA degrada a `0`**: en estadísticas un cero fabricado es indistinguible de un período legítimo sin movimiento. Test explícito del `throw` ante un decimal malformado.
- [x] 4.1 RED/GREEN: `estadisticasApi.getCompras(desde, hasta, granularidad, proveedorId?)` — test de que arma la query string correcta e incluye `proveedor_id` solo cuando se le pasa.
- [x] 4.2 RED/GREEN: `estadisticasApi.getVentas(...)` y `estadisticasApi.getResumen(desde, hasta)` con sus tests de query string.
- [x] 4.3 RED/GREEN: hooks de TanStack Query (`useCompras`, `useVentas`, `useResumen`) con query keys que incluyan rango, granularidad y `proveedor_id`. Test: cambiar la granularidad cambia la key y dispara un refetch (spec: *"Cambiar la granularidad dispara un refetch"*).

## 5. Traducción de errores del backend (design.md D5)

- [x] 5.1 RED/GREEN: helper que clasifica la respuesta de error en `tope-excedido` | `rango-invertido` | `proveedor-inexistente` | `desconocido`, discriminando **por la forma del `detail`** (objeto vs. string), nunca por el texto del mensaje.
- [x] 5.2 TRIANGULATE: casos de test para los cuatro resultados, incluido un 422 con `detail` objeto que trae `periodos_estimados` y `tope`.
- [x] 5.3 RED/GREEN: componente de mensaje de error que, ante `tope-excedido`, explica que el rango es demasiado grande para esa granularidad **e indica la acción correctiva**, y no lo presenta como error inesperado (spec: *"El tope de períodos del backend se comunica como algo accionable"*).

## 6. Selector compartido de rango y granularidad (design.md D3)

- [x] 6.1 RED/GREEN: hook que lee y escribe `desde`/`hasta`/`granularidad` en los search params de la ruta donde está montado. Sin store global.
- [x] 6.2 RED/GREEN: `RangoGranularidadSelector` con las tres granularidades (`dia`/`semana`/`mes`) y los dos campos de fecha, reutilizando los tokens del design system (mirar `VentasFilters` como referencia de estilo).
- [x] 6.3 TRIANGULATE: al montar sin search params se inicializa con el rango por defecto y emite la request inicial; al recargar con search params respeta la selección (spec: *"El rango y la granularidad se reflejan en la URL"*).
- [x] 6.4 Verificar que montar el selector en dos rutas distintas NO sincroniza sus valores entre sí (design.md D3).

## 7. Primitiva de gráfico en SVG (design.md D1)

- [x] 7.1 RED/GREEN: componente de barras por período con `@visx/shape` + `@visx/scale`, que recibe la serie ya lista y **no la transforma**. Escalado delegado a `@visx/scale`.
- [x] 7.2 RED/GREEN: el SVG expone un nombre accesible que describe la serie, y cada total del período está presente como **texto accesible en el DOM** (spec: *"Los valores del gráfico son afirmables sin leer píxeles"*).
- [x] 7.3 TRIANGULATE: una serie con un período en cero intermedio se renderiza con ese período presente; la cantidad de períodos mostrados es igual a la recibida (spec: *"Un período sin compras se muestra en cero, no se saltea"*).
- [x] 7.4 RED/GREEN: estado de carga que muestra afordancia y **ningún valor en cero**, siguiendo el patrón de `TotalesDelDia` (design.md D7).
- [x] 7.5 RED/GREEN: cuando todos los períodos vienen en cero, se muestra además el mensaje de "sin movimiento en el rango" (design.md D6).

## 8. Panel de compras por proveedor

- [x] 8.1 RED/GREEN: panel que pide `/api/estadisticas/compras` con el `proveedor_id` recibido por props. Test: la request incluye ese `proveedor_id` (spec: *"La ficha pide las compras acotadas a su proveedor"*).
- [x] 8.2 RED/GREEN: ante 404 del backend, informa que el proveedor no existe **sin exponer que pertenece a otro negocio**.
- [x] 8.3 Montar el panel en `ProveedorDetailPage` pasándole solo el `proveedor_id`; la página no gana lógica de estadísticas (design.md Risks).

## 9. Panel de ventas con desglose por forma de pago

- [x] 9.1 RED/GREEN: panel que pide `/api/estadisticas/ventas` y muestra, por período, el total y su desglose usando `FORMA_PAGO_LABELS` — nunca el enum crudo (spec: *"El desglose usa etiquetas legibles"*).
- [x] 9.2 TRIANGULATE: la suma de los montos del desglose mostrados es igual al total mostrado del período, **leyendo ambos del DOM** y sin que el componente los haya sumado para producirlos (spec: *"El desglose suma el total mostrado"*).
- [x] 9.3 TRIANGULATE: una forma de pago en `0.00` aparece con su etiqueta legible y valor cero, no se omite.

## 10. Panel de contraste compras vs. ventas

- [x] 10.1 RED/GREEN: panel que pide `/api/estadisticas/resumen` y muestra `compras`, `ventas` y `diferencia` tal como llegaron.
- [x] 10.2 RED/GREEN: test que verifica que el rótulo del tercer valor **no contiene** "margen", "ganancia" ni "rentabilidad" (spec + C-37 D6).
- [x] 10.3 TRIANGULATE: una `diferencia` negativa se muestra como negativa, sin convertirla a positivo ni ocultarla.

## 11. Ruta y navegación

- [x] 11.1 RED/GREEN: ruta `/estadisticas` que hospeda el panel de ventas y el de contraste bajo **un solo** selector de rango y granularidad (design.md D2).
- [x] 11.2 Verificar que `VentasPage` **no fue modificada** y que sus search params `desde`/`hasta` siguen significando "filtrar la lista", con default HOY (design.md D2 — esta es la colisión que la ruta separada existe para evitar).
- [x] 11.3 Agregar el acceso de navegación a `/estadisticas` donde corresponda según el layout existente.

## 12. Cierre y verificación

- [x] 12.1 Correr la suite completa del frontend y comparar contra el baseline de 1.1: cero regresiones, y los tests nuevos sumados.
- [x] 12.2 `npm run typecheck` y `npm run lint` en verde, sin `any` y sin warnings.
- [x] 12.3 Confirmar que el guard de design system efectivamente escanea los archivos de la feature nueva (no solo que está listado en `scanDirs`).
- [x] 12.4 Verificado contra la API real el 2026-08-28. `/compras` (36 períodos, suma 646931.00) y `/ventas` (31 períodos, desglose 15000.00 EFECTIVO) **coinciden exacto con la agregación SQL directa**; `/resumen` devuelve `diferencia: "-646931.00"` (negativa, conservada) y **no expone ninguna clave `margen`**. Los tres 422 verificados en vivo: tope excedido → `detail` **dict** con `periodos_estimados: 1096`/`tope: 400`; rango invertido → `detail` **str**; fecha malformada (validación de FastAPI) → `detail` **list** — el borde que justifica el `!Array.isArray()` de D-89, confirmado como real. Proveedor de otro negocio → **404**. Proveedor vivo con rango sin facturas → 12 períodos todos en cero, sin error. **Y la prueba fuerte**: los parsers de producción (`parseCompras`/`parseVentas`/`parseResumen`) se corrieron contra los payloads REALES capturados de la API y dieron los números que dijo SQL — confirmando en vivo que los `Decimal` viajan como **string** (D-88), que el desglose trae las 5 `FormaPago` y cierra contra el total, y que las etiquetas de período no se corren de mes.
- [x] 12.5 Registrar en `knowledge-base/09_decisiones_y_supuestos.md` las decisiones D1–D8 de este design que sobrevivan al apply, y actualizar `CHANGES.md` y `CLAUDE.md`.
