## MODIFIED Requirements

### Requirement: Unicidad normalizada por negocio

La base de datos SHALL imponer un índice **único** sobre `(negocio_id, nombre_normalizado)` entre los clientes activos. Un alta que colisione SHALL responder **409** e incluir en la respuesta el **id y el nombre del cliente existente**, para que el llamador pueda ofrecerlo en lugar de crear un duplicado.

Dos clientes equivalentes en un mismo negocio partirían la deuda en dos cuentas, que es exactamente lo que una libreta no puede permitirse.

El `409` SHALL emitirse únicamente cuando la restricción violada sea efectivamente la del nombre normalizado, comprobando el **nombre de la constraint** que la base reporta. Cualquier otra violación de integridad SHALL propagarse como el error que es y SHALL NOT reportarse como nombre duplicado.

Hoy el sistema captura la violación sin mirar cuál fue, y acierta por accidente porque `cliente` tiene un solo índice único. Esa suposición se rompe sola en cuanto exista un segundo, y su modo de falla es el peor posible: un error real disfrazado de mensaje de usuario razonable, sobre el que nadie va a investigar. La misma comprobación SHALL aplicarse en el alta y en la edición, que hoy comparten el defecto.

#### Scenario: nombre equivalente rechazado

- **WHEN** existe "Juan Pérez" y se intenta crear "juan perez" en el mismo negocio
- **THEN** la respuesta es 409 y no se crea un segundo cliente

#### Scenario: el conflicto identifica al cliente existente

- **WHEN** un alta es rechazada por colisión
- **THEN** la respuesta incluye el `id` y el `nombre` del cliente ya existente

#### Scenario: dos negocios pueden tener el mismo nombre

- **WHEN** el negocio A y el negocio B crean cada uno un cliente "Juan Pérez"
- **THEN** ambos se crean sin conflicto: la unicidad es por negocio

#### Scenario: renombrar hacia una colisión también se rechaza

- **WHEN** se intenta renombrar un cliente al nombre equivalente de otro del mismo negocio
- **THEN** la respuesta es 409 y ningún cliente queda modificado

#### Scenario: el nombre se libera al eliminar

- **WHEN** un cliente es eliminado (soft delete) y se crea otro con el mismo nombre
- **THEN** el alta se acepta: la unicidad aplica solo entre clientes activos

#### Scenario: una violación de otra restricción no se reporta como nombre duplicado

- **WHEN** un alta de cliente falla por una restricción de integridad distinta de la del nombre normalizado
- **THEN** el error se propaga como corresponde a esa restricción y la respuesta no dice que el nombre ya existe

#### Scenario: la edición aplica la misma comprobación

- **WHEN** una edición de cliente falla por una restricción de integridad distinta de la del nombre normalizado
- **THEN** el error se propaga y la respuesta no dice que el nombre ya existe
