## ADDED Requirements

### Requirement: El sistema expone totales de compra y de venta por período

El sistema SHALL exponer el total comprado y el total vendido de un negocio, agrupado por día, por semana o por mes según se pida, dentro de un rango de fechas.

Los totales SHALL calcularse **por agregación on-demand** sobre las filas existentes, y SHALL NOT persistirse, cachearse ni derivarse de ninguna columna de totales. Un total guardado es un número que puede quedar viejo sin que nada avise.

El total de compras SHALL poder acotarse a un proveedor.

#### Scenario: total vendido por mes

- **WHEN** se piden los totales de venta de un rango con granularidad mensual
- **THEN** la respuesta trae un total por cada mes del rango

#### Scenario: total comprado por semana

- **WHEN** se piden los totales de compra de un rango con granularidad semanal
- **THEN** la respuesta trae un total por cada semana del rango

#### Scenario: compras de un proveedor puntual

- **WHEN** se piden los totales de compra acotados a un proveedor
- **THEN** la respuesta incluye únicamente las compras a ese proveedor

### Requirement: Un período sin movimiento vale cero y aparece en la serie

La respuesta SHALL incluir **todos** los períodos comprendidos en el rango pedido, incluidos aquellos sin ningún movimiento, con total cero. SHALL NOT omitirse un período por no tener datos.

Una agregación devuelve, naturalmente, solo los períodos con filas. Emitir eso tal cual entrega una serie con huecos, y una serie temporal con huecos no se lee como un hueco: quien la grafica une dos fechas no consecutivas con una línea recta y obtiene una caída suave donde hubo un cero abrupto. El gráfico miente y no hay error visible en ningún lado.

El relleno SHALL ocurrir del lado del sistema y no delegarse a quien consume la respuesta: el sistema es el único que sabe qué períodos **debería** haber, porque quien consume solo ve lo que llegó.

#### Scenario: un período vacío en el medio del rango

- **WHEN** se piden totales de un rango en el que un período intermedio no tuvo movimientos
- **THEN** ese período aparece en la respuesta con total cero

#### Scenario: la serie tiene exactamente los períodos del rango

- **WHEN** se piden totales de un rango cualquiera
- **THEN** la cantidad de períodos devueltos es exactamente la que abarca el rango con esa granularidad

#### Scenario: un rango entero sin movimientos

- **WHEN** se piden totales de un rango en el que el negocio no registró nada
- **THEN** la respuesta trae todos los períodos del rango en cero, y no una respuesta vacía

### Requirement: El total de ventas cuenta cada operación exactamente una vez

El total de ventas SHALL sumar únicamente las ventas registradas, y SHALL NOT incluir los cobros de cuenta corriente.

Una venta fiada ya se registró como venta el día que salió la mercadería. El cobro posterior es **esa misma plata entrando**, no una operación nueva: sumarlo duplica la facturación del negocio. Es el error más fácil de cometer y el más difícil de detectar, porque el número resultante no se ve roto — se ve más alto, y plausible.

Simétricamente, el total de compras SHALL sumar únicamente las facturas de proveedor y SHALL NOT incluir los pagos: la factura es la compra, el pago es la cancelación de esa compra, y sumar ambos cuenta la misma operación dos veces.

Las dos agregaciones SHALL excluir las filas dadas de baja, por la misma razón por la que no cuentan en el saldo.

#### Scenario: un fiado cobrado se cuenta una sola vez

- **WHEN** se registra una venta en cuenta corriente y luego se cobra completa, y se piden los totales de venta del período
- **THEN** el total incluye el monto de esa venta una única vez, en el período de la venta

#### Scenario: un pago a proveedor no infla las compras

- **WHEN** se registra una factura de proveedor y luego se la paga, y se piden los totales de compra del período
- **THEN** el total incluye el monto de la factura una única vez, y el pago no lo altera

#### Scenario: una operación dada de baja no cuenta

- **WHEN** se da de baja una venta y se piden los totales del período que la contenía
- **THEN** el total ya no la incluye

### Requirement: Las ventas se desglosan por forma de pago y el desglose suma el total

El total de ventas de cada período SHALL venir acompañado de su desglose por forma de pago, y la suma del desglose SHALL ser igual al total de ese período.

La venta en cuenta corriente SHALL aparecer en el desglose como una forma de pago más. Fue una venta, esté cobrada o no; que siga impaga es asunto de la cuenta corriente y no del total vendido.

#### Scenario: el desglose reconcilia con el total

- **WHEN** se piden los totales de venta de un período con ventas de varias formas de pago
- **THEN** la suma de los montos del desglose es igual al total del período

#### Scenario: el fiado aparece en el desglose

- **WHEN** el período incluye ventas en cuenta corriente
- **THEN** el desglose las reporta bajo esa forma de pago

#### Scenario: una forma de pago sin ventas en el período

- **WHEN** un período no tuvo ventas de una forma de pago determinada
- **THEN** el desglose de ese período no la reporta con un monto distinto de cero

### Requirement: El corte de período no aplica ninguna conversión de zona horaria

El agrupamiento por día, semana o mes SHALL operar directamente sobre la fecha registrada del movimiento, y SHALL NOT aplicar ninguna conversión de zona horaria.

Las fechas de los movimientos son fechas calendario, sin hora ni zona. Convertirlas desplazaría de período a los movimientos cercanos a los bordes, produciendo totales que no coinciden con lo que la persona cargó — y el desplazamiento sería sistemático e invisible.

La zona horaria SHALL seguir aplicándose donde ya se aplica: para decidir si una fecha es futura al registrar un movimiento. Eso no cambia y no es asunto de las estadísticas.

La semana SHALL empezar el **lunes**.

#### Scenario: un movimiento del primer día del período

- **WHEN** existe un movimiento fechado exactamente el primer día de un período y se piden los totales
- **THEN** ese movimiento cuenta en ese período y no en el anterior

#### Scenario: un movimiento del último día del período

- **WHEN** existe un movimiento fechado exactamente el último día de un período
- **THEN** ese movimiento cuenta en ese período y no en el siguiente

#### Scenario: la semana arranca el lunes

- **WHEN** se piden totales con granularidad semanal
- **THEN** cada período empieza un lunes

### Requirement: El contraste entre compras y ventas usa los mismos totales que los endpoints individuales

El sistema SHALL exponer un contraste entre lo comprado y lo vendido en un mismo rango, y ese contraste SHALL derivarse de las mismas agregaciones que sirven a los totales individuales, sin un camino de cálculo propio.

Un tercer lugar donde esté definido "cuánto vendí" es un tercer número que puede diferir. La única forma de que dos respuestas coincidan siempre es que sean el mismo número, no dos números que hoy dan igual.

El contraste SHALL reportar compras, ventas y su diferencia con el nombre de lo que son, y SHALL NOT presentarlos como margen, rentabilidad ni ganancia. El sistema no sabe cuánto costó la mercadería que vendió: una factura de proveedor es una compra del negocio, no el costo de una venta puntual. Un número con nombre contable que no está calculado como tal se usa para tomar decisiones y no debería.

#### Scenario: el contraste coincide con los totales individuales

- **WHEN** se piden el contraste y los totales individuales para el mismo rango
- **THEN** las compras y las ventas del contraste son idénticas a las de los endpoints individuales

#### Scenario: el contraste nombra lo que reporta

- **WHEN** se pide el contraste de un período
- **THEN** la respuesta expone compras, ventas y la diferencia, sin presentarla como margen ni rentabilidad

### Requirement: Las estadísticas están aisladas por negocio

El sistema SHALL agregar únicamente los movimientos del negocio de la sesión, y SHALL NOT incluir datos de ningún otro negocio en ninguna de las agregaciones.

Un total es un agregado, así que una filtración acá no se ve: no aparece un registro ajeno en pantalla, aparece un número más alto. Es la forma más silenciosa posible de perder el aislamiento.

Pedir estadísticas acotadas a un proveedor de otro negocio SHALL responder **404**, nunca 403.

#### Scenario: los totales no incluyen otro negocio

- **WHEN** dos negocios registran ventas el mismo día y se piden los totales de uno
- **THEN** el total refleja únicamente las ventas de ese negocio

#### Scenario: proveedor de otro negocio

- **WHEN** se piden estadísticas de compra acotadas a un proveedor que pertenece a otro negocio
- **THEN** la respuesta es 404

#### Scenario: sin sesión

- **WHEN** se piden estadísticas sin sesión válida
- **THEN** la respuesta es 401 antes de cualquier otra verificación

### Requirement: Un rango que produce demasiados períodos se rechaza explicando cómo achicarlo

El sistema SHALL imponer un tope a la cantidad de períodos de una respuesta y SHALL rechazar con un error explicativo el pedido que lo exceda, informando cuántos períodos produciría y sugiriendo una granularidad más gruesa o un rango más corto.

Como todo período del rango viaja aunque esté vacío, un rango largo con granularidad fina no sale barato: es justamente el relleno lo que impide que lo sea. El rechazo SHALL ser un error de validación explícito y SHALL NOT manifestarse como una respuesta truncada ni como un tiempo de espera agotado.

El tope SHALL definirse sobre la cantidad de períodos y no sobre la longitud del rango: cinco años agrupados por mes son sesenta filas y no molestan a nadie.

#### Scenario: rango largo con granularidad fina

- **WHEN** se piden totales de un rango de varios años con granularidad diaria
- **THEN** la solicitud se rechaza informando cuántos períodos produciría y sugiriendo achicar el pedido

#### Scenario: el mismo rango con granularidad gruesa funciona

- **WHEN** se pide ese mismo rango con granularidad mensual
- **THEN** la respuesta se devuelve normalmente

#### Scenario: nunca una respuesta parcial

- **WHEN** un pedido excede el tope de períodos
- **THEN** no se devuelve ninguna serie, ni siquiera recortada
