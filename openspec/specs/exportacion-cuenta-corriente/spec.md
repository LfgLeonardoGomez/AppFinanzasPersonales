# exportacion-cuenta-corriente Specification

## Purpose
TBD - created by archiving change c-39-exportacion-pdf-xls. Update Purpose after archive.
## Requirements
### Requirement: Una cuenta corriente se puede exportar como documento descargable

El sistema SHALL permitir exportar la cuenta corriente de un cliente y la de un proveedor como archivo descargable, en formato **PDF** o **XLSX**, elegido por quien exporta.

Los dos formatos existen para usos distintos y no son intercambiables. El **XLSX** es un volcado tabular sin formato decorativo: está para seguir trabajando los números en una planilla. El **PDF** es un documento presentable: está para que el negocio se lo muestre a la persona que le debe.

La exportación SHALL ser de solo lectura: no persiste nada, no modifica la cuenta y no deja registro sobre el recurso exportado.

#### Scenario: exportar una cuenta como PDF

- **WHEN** se solicita la exportación de una cuenta corriente con formato `pdf`
- **THEN** la respuesta es un archivo PDF descargable

#### Scenario: exportar una cuenta como XLSX

- **WHEN** se solicita la exportación de la misma cuenta con formato `xlsx`
- **THEN** la respuesta es un archivo de planilla descargable

#### Scenario: un formato no soportado se rechaza

- **WHEN** se solicita un formato distinto de `pdf` o `xlsx`
- **THEN** la solicitud se rechaza con un error de validación y no se genera ningún documento

### Requirement: Los montos del documento son los mismos que muestra la pantalla

El documento exportado SHALL derivar su saldo y sus movimientos de la **misma composición on-demand** que sirve la vista de cuenta corriente, y SHALL NOT recalcularlos por una vía propia.

Esto no es una preferencia de implementación: es la única forma de que la coincidencia sea una propiedad del sistema y no una promesa que hay que vigilar. Dos caminos de cálculo que hoy dan lo mismo se desincronizan en el primer cambio de reglas que alguien aplique en un solo lado, y lo que se desincroniza es justo lo que no da síntoma — un desempate de orden, un borde, un redondeo. El día que un documento entregado a un cliente y la pantalla digan números distintos, nadie va a poder decir cuál tiene razón.

El saldo del encabezado SHALL ser el saldo de la cuenta **completa**, y SHALL NOT verse afectado por ningún filtro aplicado al historial.

#### Scenario: el documento coincide con la vista

- **WHEN** se exporta una cuenta que tiene movimientos de ambos tipos
- **THEN** el saldo del documento y cada movimiento coinciden con lo que devuelve la vista de cuenta corriente de esa misma cuenta

#### Scenario: un filtro de fechas no mueve el saldo del encabezado

- **WHEN** se exporta una cuenta acotando el historial a un rango de fechas
- **THEN** el saldo del encabezado sigue siendo el de la cuenta completa, no el del rango

### Requirement: El historial es opcional y su rango es elegible

El documento SHALL incluir el detalle cronológico de movimientos únicamente cuando se lo pida explícitamente, y SHALL admitir acotarlo a un rango de fechas: desde una fecha hasta hoy, o entre dos fechas cualesquiera.

Sin historial el documento es un comprobante de saldo de una carilla, que es lo que hace falta la mayoría de las veces. Con historial es un resumen de cuenta completo.

Pedir un rango de fechas sin pedir el historial SHALL rechazarse con un error de validación, y SHALL NOT ignorarse en silencio. Un documento sin filas devuelto ante un pedido de rango se lee como una falla del sistema, no como una respuesta.

#### Scenario: documento sin historial

- **WHEN** se exporta una cuenta sin pedir el historial
- **THEN** el documento contiene el encabezado y el saldo, y ninguna fila de movimientos

#### Scenario: documento con historial completo

- **WHEN** se exporta una cuenta pidiendo el historial sin acotar fechas
- **THEN** el documento contiene todos los movimientos activos de la cuenta

#### Scenario: documento con historial acotado

- **WHEN** se exporta una cuenta pidiendo el historial entre dos fechas
- **THEN** el documento contiene únicamente los movimientos cuya fecha cae dentro del rango

#### Scenario: un rango sin historial es contradictorio

- **WHEN** se pide un rango de fechas sin pedir el historial
- **THEN** la solicitud se rechaza con un error de validación

#### Scenario: un rango sin movimientos no es un error

- **WHEN** se exporta un rango en el que la cuenta no tuvo movimientos
- **THEN** el documento se genera con su encabezado y sin filas, informando que no hubo movimientos en el período

### Requirement: Un documento con rango acotado tiene que reconciliar consigo mismo

Cuando el historial se acota a un rango, el documento SHALL incluir una fila de apertura con el **saldo anterior** —el saldo acumulado inmediatamente previo al inicio del rango— antes de la primera fila de movimiento.

Sin esa fila el documento miente por omisión. El saldo acumulado de la primera fila del rango arrastra todo lo que pasó antes, así que aparece como un número salido de la nada que no se explica con nada visible. Quien recibe el resumen hace la cuenta, no le da, y deja de creerle al documento entero — o peor, cree que las filas del rango suman el saldo del encabezado. Un resumen de cuenta que no cierra es peor que no tener resumen.

Cuando el rango termina antes de hoy, el documento SHALL rotular además el saldo al cierre del rango, y SHALL indicar a qué fecha corresponde cada uno de los dos saldos. Dos números con su fecha son honestos; un número sin fecha es una trampa.

Cuando no hay ningún movimiento anterior al inicio del rango, el saldo anterior SHALL ser cero.

#### Scenario: la fila de apertura permite reconciliar

- **WHEN** se exporta una cuenta con historial acotado a un rango que tiene movimientos previos
- **THEN** el documento abre con el saldo anterior, y ese saldo más los movimientos del rango dan el saldo acumulado de la última fila

#### Scenario: sin movimientos previos el saldo anterior es cero

- **WHEN** se exporta un rango que empieza antes del primer movimiento de la cuenta
- **THEN** el saldo anterior del documento es cero

#### Scenario: un rango cerrado en el pasado distingue los dos saldos

- **WHEN** se exporta una cuenta con un rango que termina antes de hoy
- **THEN** el documento muestra el saldo al cierre del rango y el saldo actual, cada uno con su fecha

### Requirement: La exportación respeta el aislamiento por negocio

El sistema SHALL responder **404** al exportar una cuenta que pertenece a otro negocio, esté borrada o no exista, y SHALL NOT responder 403 ni distinguir esos casos entre sí.

Un 403 confirma que el recurso existe, que es exactamente la filtración que el 404 evita. La exportación no puede ser la puerta de atrás por la que se enumera lo que el resto del sistema oculta.

La verificación SHALL ocurrir antes de generar el documento: un recurso ajeno no llega a producir bytes.

#### Scenario: cuenta de otro negocio

- **WHEN** se exporta la cuenta corriente de un cliente que pertenece a otro negocio
- **THEN** la respuesta es 404 y no se genera ningún documento

#### Scenario: cuenta inexistente

- **WHEN** se exporta una cuenta corriente cuyo identificador no existe
- **THEN** la respuesta es 404, indistinguible del caso anterior

#### Scenario: sin sesión

- **WHEN** se solicita una exportación sin sesión válida
- **THEN** la respuesta es 401 antes de cualquier otra verificación

### Requirement: Una cuenta demasiado grande falla diciendo qué hacer

El sistema SHALL imponer un tope de movimientos por documento y SHALL rechazar con un error explicativo la exportación que lo exceda, informando la cantidad real de movimientos y sugiriendo acotar el rango.

La generación de un documento con miles de filas dentro de un proceso de memoria acotada puede llevarse puesta la API entera, para todos los usuarios del sistema, no solo para quien exportó. La salida ortodoxa —encolar el trabajo y avisar cuando esté listo— exige infraestructura que este despliegue no tiene.

El tope SHALL definirse por formato, porque los dos formatos no consumen igual. El rechazo SHALL ser un error de validación explícito y SHALL NOT manifestarse como un tiempo de espera agotado, un error de servidor, ni un documento truncado en silencio. Un documento al que le faltan filas sin avisar es la peor de las salidas posibles: se ve bien y está mal.

#### Scenario: una cuenta que excede el tope

- **WHEN** se exporta una cuenta cuyo historial supera el tope del formato pedido
- **THEN** la solicitud se rechaza con un error que informa la cantidad de movimientos y sugiere acotar el rango

#### Scenario: acotar el rango destraba la exportación

- **WHEN** se reintenta esa misma exportación acotada a un rango que cae por debajo del tope
- **THEN** el documento se genera normalmente

#### Scenario: el tope nunca produce un documento incompleto

- **WHEN** una exportación excede el tope
- **THEN** no se devuelve ningún documento, ni siquiera parcial

### Requirement: El archivo descargado se identifica solo

El sistema SHALL entregar el documento como descarga con un nombre de archivo que incluya el tipo de documento, el nombre de la cuenta y la fecha de emisión.

Bajar tres resúmenes del mismo cliente en semanas distintas y que el navegador los deje como el mismo nombre con un número entre paréntesis es cómo se termina mandando el mes equivocado. El nombre SHALL estar normalizado para ser un nombre de archivo válido en cualquier sistema.

#### Scenario: el archivo llega nombrado

- **WHEN** se exporta la cuenta corriente de un cliente
- **THEN** la respuesta indica descarga con un nombre que contiene el nombre del cliente y la fecha de emisión

#### Scenario: un nombre con acentos o espacios se normaliza

- **WHEN** se exporta la cuenta de un cliente cuyo nombre tiene acentos o espacios
- **THEN** el nombre del archivo resultante es válido y no los contiene

