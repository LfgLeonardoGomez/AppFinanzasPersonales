# exportacion-cuenta-corriente-frontend Specification

## Purpose
TBD - created by archiving change c-39-exportacion-pdf-xls. Update Purpose after archive.
## Requirements
### Requirement: Las dos vistas de cuenta corriente ofrecen exportar

La vista de cuenta corriente de cliente y la de proveedor SHALL ofrecer una acción de exportación que permita elegir el formato, decidir si se incluye el historial y, en ese caso, acotarlo a un rango de fechas.

La acción SHALL estar disponible aunque la cuenta esté en cero: un comprobante de que no se debe nada es información que el negocio puede querer entregar.

#### Scenario: exportar desde la cuenta de un cliente

- **WHEN** se abre la cuenta corriente de un cliente
- **THEN** hay una acción visible para exportarla

#### Scenario: exportar desde la cuenta de un proveedor

- **WHEN** se abre la cuenta corriente de un proveedor
- **THEN** hay una acción visible para exportarla

#### Scenario: una cuenta sin deuda también se exporta

- **WHEN** se abre la cuenta corriente de una cuenta con saldo cero
- **THEN** la acción de exportar sigue disponible

### Requirement: El rango de fechas solo se ofrece cuando tiene sentido

El formulario de exportación SHALL ofrecer el rango de fechas únicamente cuando el historial está incluido, y SHALL impedir enviar una combinación que el backend va a rechazar.

Ofrecer un control cuyo efecto es un error es peor que no ofrecerlo: la persona lo completa, lo envía y recibe un rechazo por algo que la pantalla le permitió hacer.

El formulario SHALL impedir además un rango invertido, con la fecha de inicio posterior a la de fin.

#### Scenario: sin historial no hay rango que elegir

- **WHEN** el historial no está incluido
- **THEN** los controles de rango de fechas no están disponibles

#### Scenario: al incluir el historial aparece el rango

- **WHEN** se marca la inclusión del historial
- **THEN** los controles de rango de fechas quedan disponibles, vacíos por defecto

#### Scenario: un rango invertido no se puede enviar

- **WHEN** la fecha de inicio es posterior a la de fin
- **THEN** el formulario lo señala y no envía la solicitud

### Requirement: El cliente descarga el documento, no lo construye

El frontend SHALL limitarse a solicitar el documento y entregarlo al navegador para su descarga, y SHALL NOT componer el documento ni calcular, sumar o reformatear ninguno de sus montos.

Los montos son verdad del backend. Un total compuesto del lado del cliente es una segunda fuente de verdad que puede diferir de la pantalla y del propio backend, sobre un documento que además sale del sistema y queda en manos de un tercero.

El nombre del archivo descargado SHALL ser el que indica el backend.

#### Scenario: la descarga se dispara

- **WHEN** se confirma la exportación
- **THEN** el navegador recibe el archivo con el nombre que indicó el backend

### Requirement: La exportación informa que está trabajando y cuando falla

Mientras la exportación está en curso, la interfaz SHALL indicarlo y SHALL impedir dispararla otra vez; ante un rechazo del backend SHALL mostrar el motivo que el backend informó, en lugar de un error genérico.

El caso que más importa es el de la cuenta demasiado grande: el backend responde diciendo cuántos movimientos tiene y sugiriendo acotar el rango, y esa respuesta está escrita para que la persona pueda actuar sobre ella. Reemplazarla por "no se pudo exportar" convierte un problema con solución en una pared.

Generar un documento puede tardar; sin señal de que está en curso, la persona vuelve a apretar y dispara un trabajo pesado por segunda vez sobre un proceso de memoria acotada.

#### Scenario: mientras genera, avisa

- **WHEN** la exportación está en curso
- **THEN** la interfaz lo indica y la acción de exportar no se puede volver a disparar

#### Scenario: una cuenta demasiado grande explica cómo seguir

- **WHEN** el backend rechaza la exportación por exceder el tope de movimientos
- **THEN** se muestra el motivo informado por el backend, incluida la sugerencia de acotar el rango

#### Scenario: la falla no deja la acción bloqueada

- **WHEN** una exportación falla por cualquier motivo
- **THEN** la acción de exportar vuelve a quedar disponible con las opciones elegidas intactas

