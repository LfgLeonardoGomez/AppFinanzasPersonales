# home-y-navegacion Specification

## Purpose
TBD - created by archiving change c-44-arquitectura-informacion-ventas-first. Update Purpose after archive.
## Requirements
### Requirement: La pantalla de inicio ofrece registrar una venta como acción primaria

La pantalla de inicio SHALL ofrecer una acción primaria para registrar una venta, que SHALL llevar al formulario de venta nueva (`/ventas/nueva`).

Esa acción SHALL ser la primera acción del contenido principal en el orden del DOM, y SHALL recibir el tratamiento visual de acción primaria. La entrada de carga asistida por IA SHALL conservarse, y NO SHALL presentarse con más prominencia que la venta.

La app es el sistema de un negocio que vende en el mostrador: la operación que genera ingresos es la venta, no el registro de deuda con proveedores. Que la pantalla de inicio no ofreciera ninguna forma de registrar una venta era un resto de la etapa en la que el producto era solamente un registro de facturas de proveedores.

#### Scenario: La acción de venta es la primera del contenido principal

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** la primera acción del contenido principal en el orden del DOM es la de registrar una venta

#### Scenario: La acción de venta lleva al formulario de venta nueva

- **WHEN** el usuario activa la acción de registrar una venta desde la pantalla de inicio
- **THEN** la aplicación navega a `/ventas/nueva`
- **AND** se monta el formulario de venta

#### Scenario: La carga con IA sigue disponible en la pantalla de inicio

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** existe una entrada visible hacia la carga asistida por IA
- **AND** su activación abre el mismo flujo de carga que ofrecía antes de este cambio

### Requirement: La pantalla de inicio no muestra datos de negocio

La pantalla de inicio SHALL NOT mostrar montos, totales, contadores, gráficos, listados de movimientos ni ninguna otra representación de datos del negocio. SHALL NOT emitir ninguna request a la API.

En particular, SHALL NOT alojar las secciones de proveedores frecuentes ni de actividad reciente, que pasan a vivir en la pantalla de proveedores.

Esto es una restricción activa, no una omisión. El motivo por el que las estadísticas dejan de ocupar un lugar destacado en la navegación es que repiten información que ya se ve en otras vistas; reproducirla en la pantalla de inicio cometería exactamente ese error otra vez. La pantalla de inicio es un trampolín hacia la tarea, no un destino donde leer números.

#### Scenario: La pantalla de inicio no muestra ningún monto

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** no se renderiza ningún texto con formato de moneda

#### Scenario: La pantalla de inicio no muestra ningún gráfico

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** no se renderiza ningún gráfico ni ninguna imagen que represente una serie de datos

#### Scenario: La pantalla de inicio no consulta la API

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** no se emite ninguna request HTTP a la API

#### Scenario: Los proveedores frecuentes ya no están en la pantalla de inicio

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** no se muestra la sección de proveedores frecuentes

#### Scenario: La actividad reciente ya no está en la pantalla de inicio

- **WHEN** un usuario autenticado abre la pantalla de inicio
- **THEN** no se muestra la sección de actividad reciente

### Requirement: El orden de la navegación principal refleja la operación del negocio

La navegación principal SHALL ofrecer sus entradas en este orden: Home, Ventas, Clientes, Proveedores, Facturas, Pagos, Estadísticas, Perfil.

La entrada de Equipo SHALL seguir ofreciéndose únicamente a los administradores, y SHALL conservar su ubicación actual al final de la lista. Ocultarla al resto es cortesía, no control de acceso: la API responde 403 igual.

El cambio respecto del orden anterior SHALL limitarse al desplazamiento de Estadísticas, que pasa del tercer lugar a la posición previa a Perfil. Las demás entradas SHALL conservar su orden relativo. La ruta `/estadisticas` y su pantalla NO SHALL modificarse.

#### Scenario: El menú ofrece las entradas en el orden definido

- **WHEN** un usuario autenticado sin privilegios de administrador ve la navegación principal
- **THEN** las entradas aparecen exactamente en el orden Home, Ventas, Clientes, Proveedores, Facturas, Pagos, Estadísticas, Perfil

#### Scenario: Estadísticas queda entre Pagos y Perfil

- **WHEN** se lee la navegación principal
- **THEN** la entrada de Estadísticas aparece después de la de Pagos
- **AND** aparece antes de la de Perfil

#### Scenario: La entrada de Equipo sigue siendo solo para administradores

- **WHEN** un usuario administrador ve la navegación principal
- **THEN** la entrada de Equipo aparece al final de la lista
- **AND** para un usuario no administrador esa entrada no se ofrece

#### Scenario: La ruta de estadísticas no cambia

- **WHEN** el usuario activa la entrada de Estadísticas desde su nueva posición
- **THEN** la aplicación navega a `/estadisticas`
- **AND** se monta la misma pantalla que antes de este cambio

### Requirement: Las dos superficies de navegación se alimentan de una única definición

La navegación de escritorio y la de dispositivo móvil SHALL derivarse de una única definición del conjunto de entradas y de su orden. NO SHALL existir una segunda lista que pueda divergir de la primera.

Dos listas paralelas divergen en silencio: un cambio de orden aplicado a una sola de ellas produce dos menús distintos según el ancho de pantalla, sin ningún error que lo delate.

#### Scenario: Ambas superficies ofrecen la misma secuencia de entradas

- **WHEN** se leen las dos superficies de navegación principal
- **THEN** ambas presentan las mismas entradas en el mismo orden

#### Scenario: Reordenar en un solo lugar alcanza para ambas

- **WHEN** se modifica el orden en la definición única de la navegación
- **THEN** el cambio se refleja en las dos superficies sin editarlas por separado
