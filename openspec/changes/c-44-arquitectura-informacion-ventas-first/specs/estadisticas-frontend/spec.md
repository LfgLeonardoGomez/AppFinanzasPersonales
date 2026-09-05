## MODIFIED Requirements

### Requirement: Selector compartido de rango y granularidad

Las vistas de estadísticas de la ruta `/estadisticas` SHALL compartir un único control de rango (`desde`/`hasta`) y granularidad (`dia` | `semana` | `mes`). El estado del selector SHALL vivir en los search params de la URL, de modo que una vista de estadísticas sea enlazable y sobreviva a un refresh.

Al cambiar cualquiera de los tres valores, la vista SHALL volver a pedir los datos al backend. El frontend NO SHALL recalcular, reagrupar ni reinterpretar una serie ya recibida para servir otra granularidad.

#### Scenario: Cambiar la granularidad dispara un refetch

- **WHEN** el usuario tiene una serie cargada en granularidad `mes` y selecciona `semana`
- **THEN** se emite una nueva request al endpoint correspondiente con `granularidad=semana`
- **AND** la serie mostrada es la que devolvió esa respuesta, no una reagrupación local de la anterior

#### Scenario: El rango y la granularidad se reflejan en la URL

- **WHEN** el usuario fija un rango y una granularidad
- **THEN** los search params de la URL contienen `desde`, `hasta` y `granularidad`
- **AND** al recargar la página con esa URL se muestra la misma selección sin pasar por valores por defecto

#### Scenario: El selector arranca con un rango por defecto válido

- **WHEN** el usuario entra a una vista de estadísticas sin search params
- **THEN** el selector se inicializa con un rango y una granularidad que el backend acepta
- **AND** se emite la request inicial con esos valores

#### Scenario: Un solo selector gobierna todas las vistas de la ruta

- **WHEN** el usuario abre `/estadisticas`
- **THEN** existe un único control de rango y granularidad en la pantalla
- **AND** todas las vistas que la pantalla muestra responden a ese mismo control

### Requirement: El tope de períodos del backend se comunica como algo accionable

Ante el **422** con el que el backend rechaza un rango que supera su tope de períodos (`MAX_PERIODOS`), la vista SHALL explicarle al usuario que el rango es demasiado grande para esa granularidad y SHALL indicarle la acción correctiva — achicar el rango o subir la granularidad. NO SHALL presentarlo como un error inesperado ni como una falla de la aplicación.

El backend informa en ese 422 el conteo estimado de períodos, y rechaza con **422** también el rango invertido.

La clasificación SHALL hacerse por la FORMA de la respuesta de error, nunca por el texto en prosa que la acompaña: un mensaje corregido en el backend cambiaría el texto sin cambiar la semántica, y la clasificación por texto rompería en silencio.

Un fallo que la clasificación no reconozca SHALL presentarse con el mensaje genérico. La vista NO SHALL ofrecer un diagnóstico específico que no corresponda a lo que efectivamente pidió: los endpoints que consume no reciben `proveedor_id`, de modo que un mensaje sobre un proveedor inexistente solo podría mostrarse como una afirmación falsa.

#### Scenario: Rango demasiado grande para la granularidad elegida

- **WHEN** el usuario pide un rango que el backend rechaza con 422 por exceder el tope de períodos
- **THEN** la vista muestra un mensaje que explica que el rango es demasiado grande para esa granularidad
- **AND** el mensaje indica achicar el rango o elegir una granularidad mayor
- **AND** la vista no muestra una serie parcial ni truncada

#### Scenario: Rango invertido

- **WHEN** el usuario deja `hasta` anterior a `desde` y el backend responde 422
- **THEN** la vista informa que el rango es inválido, sin presentarlo como error inesperado

#### Scenario: Un fallo no reconocido cae en el mensaje genérico

- **WHEN** una request de estadísticas falla con una respuesta que la clasificación no reconoce
- **THEN** la vista muestra el mensaje genérico de error
- **AND** no muestra ningún diagnóstico específico sobre proveedores

## REMOVED Requirements

### Requirement: Total comprado por proveedor en su ficha

**Reason**: El panel de compras por período de la ficha de proveedor se retira del producto. El dueño del negocio revisó la pantalla en producción y determinó que no aporta información útil: la cuenta corriente que está inmediatamente debajo, en la misma ficha, ya dice lo que ese panel intentaba decir, y lo dice mejor. Un panel que ocupa espacio sin informar empuja hacia abajo lo que sí informa.

**Migration**: No hay reemplazo ni ruta alternativa: la información que el panel mostraba se obtiene de la cuenta corriente del proveedor, en la misma ficha (`/proveedores/:id`). El endpoint `GET /api/estadisticas/compras` **sigue existiendo y especificado** por la capability `estadisticas-backend`; lo que se retira es su consumo desde el frontend. La ruta de datos de compras del frontend (cliente HTTP, hook, parseo y sus tests) se elimina junto con el panel, porque un cliente de API probado que ningún componente consume es una suite que pasa sin proteger nada. El rediseño futuro de la pantalla de estadísticas, si necesita compras, reconstruirá ese cliente con la forma que ese diseño pida.
