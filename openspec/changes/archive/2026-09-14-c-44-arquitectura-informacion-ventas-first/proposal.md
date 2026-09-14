## Why

La arquitectura de información de la app es la del proyecto que **fue**, no la del que **es**. Nació como "cargar facturas y pagos de proveedores" — eso era prácticamente todo el producto, así que los proveedores quedaron en el centro de la interfaz. Hoy la app opera un negocio real: lo que genera ingresos es **la venta en el mostrador**, no la contabilidad de proveedores. La navegación y la pantalla de inicio siguen diciendo lo contrario.

Concretamente: la home no ofrece ninguna forma de registrar una venta, y en cambio dedica dos tercios de su superficie a "Proveedores frecuentes" y "Actividad reciente" — información que en la ficha de proveedores tiene contexto y ahí arriba es ruido. En la barra de navegación, Estadísticas ocupa el tercer lugar, delante de Clientes, Proveedores, Facturas y Pagos, pese a ser la pantalla que menos se usa. Y la ficha de proveedor arrastra un panel de compras (C-38) que no informa nada que la cuenta corriente de abajo no diga mejor.

Es un cambio de **ubicación y jerarquía**, no de funcionalidad: ningún endpoint se apaga, ninguna capacidad de negocio se agrega ni se quita.

## What Changes

### Home: superficie de acción, no tablero

- **Se agrega una acción primaria "Vender ahora"** que navega a `/ventas/nueva` (la ruta ya existe, `VentaFormPage`). Es el elemento más prominente de la pantalla.
- **Se conserva la carga con IA** como entrada de primer nivel. Deja de ser la única protagonista; la venta pasa a ser al menos tan prominente.
- **Se eliminan de la home las secciones "Proveedores frecuentes" y "Actividad reciente"**.
- **La home NO muestra totales, contadores, gráficos ni estadísticas.** Esto es una restricción explícita, no una omisión: el motivo declarado para degradar la pestaña de Estadísticas es que "no muestra nada relevante — es información que ya vemos en otras vistas". Replicar esa información en la home reproduciría exactamente el error que este change existe para corregir.

### Las dos secciones se MUEVEN, no se borran

- "Proveedores frecuentes" y "Actividad reciente" pasan a la pantalla `/proveedores`, donde tienen contexto.
- Sus endpoints (`GET /api/proveedores?order_by=saldo`, `GET /api/actividad-reciente`) y el código de backend que los sirve **quedan intactos**. Este change no toca el backend.
- El directorio `features/home/api/` deja de tener dueño y se relocaliza (ver `design.md` D2).

### Orden de navegación

- Actual: `Home · Ventas · Estadísticas · Clientes · Proveedores · Facturas · Pagos · Perfil` (+ `Equipo`, solo admin).
- Objetivo: `Home · Ventas · Clientes · Proveedores · Facturas · Pagos · Estadísticas · Perfil` (+ `Equipo`, sin cambios).
- **Solo se mueve Estadísticas**, del tercer lugar a justo antes de Perfil. El resto conserva su orden relativo. La ruta `/estadisticas` y su pantalla no se tocan.

### Se retira el panel de compras de la ficha de proveedor

- Se elimina `PanelComprasProveedor` de `ProveedorDetailPage`, y con él **toda la ruta de datos de compras del frontend** (cliente HTTP, hook, parseo y sus tests). Un cliente de API probado que ningún componente consume es una suite que pasa sin proteger nada. Detalle y alternativa considerada en `design.md` D5.
- **BREAKING (a nivel spec, no de API):** C-38 fue archivado y su delta ya se fusionó en los specs principales. El requisito correspondiente se retira mediante un delta `REMOVED`, no editando el spec principal a mano.
- El endpoint `GET /api/estadisticas/compras` **sigue existiendo y especificado** por `estadisticas-backend`. Lo que se retira es su consumo desde el frontend.

### Corrección de conformidad descubierta (C-41)

`features/home/api/homeApi.ts` incumple hoy tres requisitos ya vigentes de `api-contract-types`:
- `ActividadRecienteItem` está transcripto a mano pese a existir el schema `ActividadRecienteItem` en el OpenAPI del backend.
- `ProveedorFrecuente` extiende `ProveedorListItem` con `ultima_factura_fecha`, campo que C-41 ya incorporó al tipo derivado: la extensión es un no-op.
- `getProveedoresFrecuentes` devuelve la respuesta cruda tipada como `ProveedorListItem[]`, cuyo `saldo` promete `number` mientras el wire manda `string`. El tipo miente y la home lo tapaba con un `Number(...)` en el render.

No requiere cambiar ningún requisito: el archivo simplemente no los cumple. Se corrige al relocalizarlo, porque mover un cliente que miente hacia dentro de un feature que sostiene el borde de parseo plantaría la inconsistencia en el peor lugar posible.

## Capabilities

### New Capabilities

- `home-y-navegacion`: la pantalla de inicio y el orden de la navegación principal del shell. Hoy ninguna capability las cubre — la home y el `AppLayout` llegaron con el rediseño de UX/UI, que se entregó fuera de la numeración de changes. Sin esta capability, los requisitos de este change no tendrían dónde vivir.

### Modified Capabilities

- `estadisticas-frontend`: se **retira** el requisito "Total comprado por proveedor en su ficha" (el panel de la ficha de proveedor). Se **modifican** otros dos cuyo texto depende de que ese panel exista: "Selector compartido de rango y granularidad" (habla de "las tres vistas"; quedan dos) y "El tope de períodos del backend se comunica como algo accionable" (su escenario "Proveedor ajeno al negocio" queda inalcanzable: los dos endpoints que siguen consumiéndose no reciben `proveedor_id`).
- `proveedores-frontend`: se **agrega** el requisito de que `/proveedores` aloje los paneles de proveedores frecuentes y actividad reciente, con sus datos cruzando el mismo borde de parseo que el resto del feature.
- `cuenta-corriente-frontend`: se **retira** el requisito "Home quick-access surfaces the cuenta-corriente view". Describe una `HomePage` inlineada en `router.tsx` con un enlace "Ver cuenta corriente" — una pantalla que ya no existe desde el rediseño. Este change es el que define qué es la home, así que dejarlo vigente pondría al conjunto de specs a contradecirse consigo mismo.

## Impact

**Frontend — modificado**
- `src/app/HomePage.tsx` + `HomePage.test.tsx` — reescritura del contenido
- `src/shared/components/AppLayout/AppLayout.tsx` + test — una sola posición en `NAV_ITEMS`
- `src/features/proveedores/ProveedoresPage.tsx` + test — monta los dos paneles relocalizados
- `src/features/proveedores/ProveedorDetailPage.tsx` + tests — deja de montar el panel de compras
- `src/features/estadisticas/api/*`, `utils/rangos.ts`, `utils/clasificarError.ts`, `components/EstadisticasError.tsx` + tests — poda de la ruta de compras
- `src/shared/api/api.d.ts` + `api.contract.test-d.ts` — `ActividadRecienteItem` derivado del schema

**Frontend — nuevo**
- `src/features/proveedores/components/ProveedoresFrecuentes.tsx`, `ActividadReciente.tsx` + tests
- `src/features/proveedores/api/actividadRecienteApi.ts`, `actividadRecienteHooks.ts` + tests

**Frontend — eliminado**
- `src/features/home/` completo
- `src/features/estadisticas/PanelComprasProveedor.tsx` + test

**Sin impacto**
- Backend: cero cambios. Ningún endpoint se agrega, se modifica ni se apaga.
- Rutas: el mapa de rutas queda idéntico. `/estadisticas` solo cambia de posición en el menú.
- Dependencias: `@visx/shape` y `@visx/scale` **siguen en uso** — `SerieBarras` los usa y `PanelVentas` sigue montándolo. No se desinstala nada.
- Ventas, Clientes, Facturas, Pagos, Perfil y Equipo: intactos.
