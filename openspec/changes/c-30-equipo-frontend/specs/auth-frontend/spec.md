## ADDED Requirements

### Requirement: El registro distingue crear un negocio de sumarse a uno

`RegisterPage` SHALL dejar de asumir un único camino de alta. SHALL ofrecer explícitamente la creación de un negocio nuevo y el ingreso a uno existente mediante código, enviando cada uno al endpoint que le corresponde (`/api/auth/registro` y `/api/auth/registro-empleado`).

Un empleado que use el camino equivocado no recibe un error: se queda con un negocio propio y vacío, convencido de haber entrado al de su jefe. Por eso la distinción tiene que estar en la interfaz y no depender de que el usuario sepa cuál le toca.

#### Scenario: el camino elegido determina el endpoint

- **WHEN** el usuario completa el formulario por el camino de negocio nuevo o por el de invitación
- **THEN** la petición se envía al endpoint correspondiente a ese camino, nunca al otro

#### Scenario: el nombre del negocio solo aplica al camino de creación

- **WHEN** el usuario está en el camino de sumarse con código
- **THEN** no se le pide el nombre de un negocio: el negocio ya existe

#### Scenario: la sesión queda iniciada por cualquiera de los dos caminos

- **WHEN** un alta se completa correctamente por cualquiera de los dos caminos
- **THEN** el usuario termina autenticado dentro del negocio que le corresponde
