> **Modo TDD estricto activo.** Cada tarea de implementación sigue el ciclo RED → GREEN → TRIANGULATE → REFACTOR. No se escribe código de producción sin un test que falle primero, y ninguna tarea se marca completa sin haber **ejecutado** la suite.
>
> **Comandos (todos desde `facturas-proveedores-web/`):**
> - suite completa: `npm test`
> - tipos: `npm run typecheck`
> - lint: `npm run lint`
>
> **Regla de corrida (design.md, Risks).** Este change mueve componentes y clientes entre features. Un fixture que mockea el endpoint de un cliente desde **fuera** del directorio de ese feature no aparece en una corrida acotada y solo sale en la suite completa — confirmado dos veces en C-41. Por eso **toda tarea de movimiento o borrado se cierra con `npm test` completo**, nunca con una corrida filtrada por archivo.
>
> **Flake conocido:** el caso del contador en `src/features/ia-vision/PropuestaIAModal.e2e.test.tsx` es sensible al timing bajo carga. Si falla solo, reejecutar; no perseguirlo ni "arreglarlo".
>
> **Este change no toca el backend.** Ninguna tarea modifica `facturas-proveedores-api/`.

## 1. Línea de base

- [x] 1.1 Ejecutar `npm test`, `npm run typecheck` y `npm run lint` y registrar la línea de base. Esperado: **1035 passed / 126 archivos**, `tsc` y `eslint` limpios. Si algo falla acá, es un fallo preexistente: reportarlo y **no** arreglarlo dentro de este change.
- [x] 1.2 Verificar por búsqueda que `PanelComprasProveedor` es el único consumidor de `useCompras`, y que `SerieBarras` tiene un segundo consumidor (`PanelVentas`). Dejar constancia del resultado — es el supuesto sobre el que se apoyan los grupos 9 y 10.

## 2. Contrato de tipos: `ActividadRecienteItem` derivado del OpenAPI (D3)

- [x] 2.1 **RED** — agregar en `src/shared/api/api.contract.test-d.ts` la aserción de compilación de `ActividadRecienteItem` contra `components['schemas']['ActividadRecienteItem']`, con `monto` convertido a número vía `DecimalAsNumber`. Verificar que `npm run typecheck` **falla** (el tipo todavía no existe en `api.d.ts`).
- [x] 2.2 **GREEN** — declarar `ActividadRecienteItem` en la sección **derivada** de `src/shared/api/api.d.ts` (no en la sección escrita a mano: tiene schema de backend, así que ese es su lado). Resolver explícitamente la opcionalidad de `proveedor_nombre` siguiendo el patrón de `ProveedorListItem`. Verificar que `npm run typecheck` pasa.
- [x] 2.3 **TRIANGULATE (por mutación)** — renombrar temporalmente un campo del schema `ActividadRecienteItem` en `api.generated.d.ts` y confirmar que `npm run typecheck` falla señalando el tipo. Revertir la mutación. Sin esta comprobación, la aserción podría estar comparando dos expresiones que mutan juntas y no detectar nada.
- [x] 2.4 Ejecutar `npm test` completo.

## 3. Cliente de actividad reciente dentro de `features/proveedores/` (D2, D3)

- [x] 3.1 **RED** — crear `src/features/proveedores/api/actividadRecienteApi.test.ts` con handlers MSW **propios, declarados dentro de `features/proveedores/`**. Casos: (a) el monto llega como cadena y el cliente devuelve número; (b) un monto vacío lanza; (c) un monto no numérico lanza; (d) `proveedor_nombre` ausente se normaliza a nulo sin perder la fila. Los fixtures reproducen la forma del **wire** (decimales como cadena), nunca valores ya convertidos.
- [x] 3.2 **GREEN** — crear `src/features/proveedores/api/actividadRecienteApi.ts` siguiendo el patrón de `proveedoresApi.ts`: interfaz `Raw` interna, función de parseo, y una conversión que **lanza** ante cadena vacía o valor no finito (nunca degrada a `0`, D-88). Ejecutar los tests hasta verde.
- [x] 3.3 **RED/GREEN** — crear `actividadRecienteHooks.test.tsx` y `actividadRecienteHooks.ts` con el hook de TanStack Query y su clave. Verificar que la clave incluye el límite, para que cambiarlo sea un refetch y no un acierto de caché sobre otra cantidad.
- [x] 3.4 Ejecutar `npm test` completo y `npm run typecheck`.

## 4. Panel "Actividad reciente" en `/proveedores` (spec `proveedores-frontend`)

- [x] 4.1 **RED** — crear `src/features/proveedores/components/ActividadReciente.test.tsx` cubriendo los escenarios del spec: se renderiza una fila por movimiento distinguiendo factura de pago; una lista vacía muestra estado vacío explícito; una fila sin nombre de proveedor se muestra igual y no se omite.
- [x] 4.2 **GREEN** — crear `ActividadReciente.tsx` migrando el marcado de la sección homónima de `HomePage.tsx`. Usar `formatMonto` de `@shared/utils/currency` en lugar del `formatARS` local. Llevar el helper de tiempo relativo con el componente, como módulo propio y con su test.
- [x] 4.3 **TRIANGULATE** — agregar un caso con orden no trivial que verifique que el panel muestra las filas **en el orden que devolvió el backend**, sin reordenar.
- [x] 4.4 **RED/GREEN** — extender `ProveedoresPage.test.tsx` para afirmar que la pantalla monta el panel, y montarlo en `ProveedoresPage.tsx` (debajo del listado, design.md Open Question 4).
- [x] 4.5 Ejecutar `npm test` completo.

## 5. Panel "Proveedores frecuentes" en `/proveedores` (spec `proveedores-frontend`, D2, D4)

- [x] 5.1 **RED** — crear `src/features/proveedores/components/ProveedoresFrecuentes.test.tsx`: se muestran nombre y saldo de cada proveedor; una lista vacía muestra estado vacío explícito; los accesos directos de factura y pago llevan al formulario con el proveedor ya identificado.
- [x] 5.2 **GREEN** — crear `ProveedoresFrecuentes.tsx` consumiendo `useProveedores({ orderBy: 'saldo' })` del propio feature y cortando a 6 en el componente. **No** crear un segundo cliente HTTP contra `/proveedores`.
- [x] 5.3 **RED/GREEN (D4)** — agregar un test que afirme que un proveedor presente a la vez en el listado y en el panel muestra su saldo **con el mismo signo y el mismo criterio de color** en ambos. Adoptar `formatSaldo` y el mismo criterio de color que `ProveedoresList`. Este test es la única defensa contra dos lecturas contradictorias del mismo dato en la misma pantalla.
- [x] 5.4 **RED/GREEN** — extender `ProveedoresPage.test.tsx` y montar el panel en `ProveedoresPage.tsx`.
- [x] 5.5 Ejecutar `npm test` completo. **Gate del grupo 6:** no avanzar a vaciar la home hasta que los dos paneles estén verdes en `/proveedores` (D8).

## 6. La home pasa a ser una superficie de acción (spec `home-y-navegacion`)

- [x] 6.1 **RED** — reescribir `src/app/HomePage.test.tsx` sobre los escenarios del spec: la acción de venta es la **primera acción del contenido principal en el orden del DOM**; activarla navega a `/ventas/nueva`; la entrada de carga con IA sigue presente.
- [x] 6.2 **RED (la aserción que sostiene la restricción)** — agregar los tests negativos: la home **no** renderiza ningún texto con formato de moneda; **no** renderiza ningún gráfico; **no** emite ninguna request HTTP (servidor MSW con `onUnhandledRequest: 'error'` y **cero handlers**); no muestra proveedores frecuentes; no muestra actividad reciente. Estos son los tests que impiden que la home vuelva a ser un tablero por acumulación (D1).
- [x] 6.3 **GREEN** — reescribir `src/app/HomePage.tsx`: saludo, acción primaria "Vender ahora" hacia `/ventas/nueva`, entrada de carga con IA conservada con su destino actual (`/facturas/nueva`, sin tocar — design.md Open Question 2). Eliminar las dos secciones, sus subcomponentes y los helpers locales `formatARS` y de tiempo relativo (ya migrados en el grupo 4).
- [x] 6.4 **TRIANGULATE (por mutación)** — reintroducir temporalmente un total con formato de moneda en la home y confirmar que el test de 6.2 **falla**. Revertir. Una aserción negativa que no se prueba por mutación no protege nada.
- [x] 6.5 Ejecutar `npm test` completo y `npm run typecheck`.

## 7. Eliminar `features/home/` (D2)

- [x] 7.1 Verificar por búsqueda que no queda ningún import de `@features/home/...` en todo `src/`.
- [x] 7.2 Eliminar `src/features/home/` completo (`homeApi.ts` y `homeHooks.ts`). Con él desaparecen `getProveedoresFrecuentes`, `useProveedoresFrecuentes`, `ProveedorFrecuente` (extensión hoy no-op) y la copia a mano de `ActividadRecienteItem`.
- [x] 7.3 Ejecutar `npm run typecheck` (detecta cualquier import colgado antes de que llegue a un test) y después `npm test` completo.

## 8. Reordenar la navegación principal (spec `home-y-navegacion`, D7)

- [x] 8.1 **RED** — extender `src/shared/components/AppLayout/AppLayout.test.tsx` con la aserción del orden exacto: `Home, Ventas, Clientes, Proveedores, Facturas, Pagos, Estadísticas, Perfil`. Escribirla **contra los dos landmarks** con `aria-label` "Navegación principal", para que un futuro intento de divergir sidebar y barra inferior rompa acá.
- [x] 8.2 **RED** — agregar los tests de los escenarios restantes: Estadísticas queda después de Pagos y antes de Perfil; la entrada de Equipo sigue apareciendo solo para administradores y al final de la lista; activar Estadísticas navega a `/estadisticas` y monta la misma pantalla.
- [x] 8.3 **GREEN** — mover la entrada de Estadísticas dentro del array `NAV_ITEMS` de `AppLayout.tsx`. **Un solo movimiento**: ninguna otra entrada cambia de posición relativa, y no se introduce ninguna estructura nueva.
- [x] 8.4 Ejecutar `npm test` completo.

## 9. Retirar el panel de compras de la ficha de proveedor (spec `estadisticas-frontend`, REMOVED)

- [x] 9.1 **RED** — ajustar `ProveedorDetailPage.test.tsx` y `ProveedorDetailPage.integration.test.tsx` para afirmar que la ficha **no** monta el panel de compras por período, y que la cuenta corriente y las acciones del encabezado siguen intactas.
- [x] 9.2 **GREEN** — quitar de `ProveedorDetailPage.tsx` el import y el montaje de `PanelComprasProveedor`, junto con el comentario que lo justificaba.
- [x] 9.3 Eliminar `src/features/estadisticas/PanelComprasProveedor.tsx` y `PanelComprasProveedor.test.tsx`.
- [x] 9.4 Ejecutar `npm run typecheck` y `npm test` completo.

## 10. Podar la ruta de datos de compras del frontend (D5)

> Cada subtarea es un borrado con su corrida completa detrás. No agrupar: si algo rompe, el borrado que lo causó tiene que ser identificable de un vistazo.

- [x] 10.1 Eliminar `getCompras` y `ComprasQuery` de `estadisticasApi.ts`, y sus casos de `estadisticasApi.test.ts`. Correr `npm test`.
- [x] 10.2 Eliminar `useCompras` y la clave `compras` de `ESTADISTICAS_KEYS` en `estadisticasHooks.ts`, y sus casos de `estadisticasHooks.test.tsx`. Correr `npm test`.
- [x] 10.3 Eliminar `parseCompras`, `parsePeriodoTotal` y `RawComprasResponse` de `estadisticasParse.ts`, y sus casos de `estadisticasParse.test.ts`. Correr `npm test`.
- [ ] 10.4 Simplificar `utils/rangos.ts`: eliminar la variante `compras` de `VistaEstadisticas` y la rama de 12 meses de `rangoPorDefecto`, dejando la firma con un solo parámetro (design.md Open Question 4 de D5). Actualizar `useRangoGranularidad` y `rangos.test.ts`. Correr `npm test`.
- [ ] 10.5 **RED/GREEN** — eliminar la clasificación `proveedor-inexistente` de `clasificarError.ts` y su copy de `EstadisticasError.tsx`, junto con sus tests. Agregar en su lugar el test del escenario nuevo del spec modificado: **un fallo no reconocido cae en el mensaje genérico**, y la vista no ofrece ningún diagnóstico sobre proveedores. Correr `npm test`.
- [ ] 10.6 **Verificación explícita de lo que NO se toca:** confirmar que `SerieBarras`, `RangoGranularidadSelector`, `useRangoGranularidad` y `etiquetas.ts` siguen en uso desde `EstadisticasPage`, `PanelVentas` y `PanelContraste`, y que `@visx/shape` y `@visx/scale` **siguen siendo dependencias en uso**. No desinstalar nada de `package.json`.
- [ ] 10.7 Confirmar que `ComprasResponse` y `PeriodoTotal` **siguen declarados** en `api.d.ts` con sus aserciones de contrato: son tipos derivados del schema, sin runtime, y el endpoint sigue especificado por `estadisticas-backend`.

## 11. Cierre y verificación

- [ ] 11.1 Confirmar que el guard `tests/design-system-guard.test.ts` cubre los archivos nuevos de `features/proveedores/`: si el directorio ya está en su lista de escaneo, no hay nada que hacer; si no, agregarlo, porque una pantalla que nace fuera del guard nace sin control y en silencio.
- [ ] 11.2 Ejecutar `npm test` completo, `npm run typecheck` y `npm run lint`. Comparar contra la línea de base de 1.1 y **explicar toda diferencia en el conteo** (los borrados de los grupos 7, 9 y 10 bajan el total; los tests nuevos de los grupos 2 a 8 lo suben). Un conteo que no cierra es un test perdido, no ruido.
- [ ] 11.3 Verificar a mano en la app corriendo: la home ofrece "Vender ahora" y lleva al formulario de venta; el menú muestra el orden nuevo en escritorio y en móvil; `/proveedores` muestra los dos paneles relocalizados; la ficha de proveedor ya no muestra el panel de compras; `/estadisticas` sigue funcionando igual que antes.
- [ ] 11.4 Confirmar que `git status` no muestra ningún archivo modificado bajo `facturas-proveedores-api/`. Este change es frontend puro.
