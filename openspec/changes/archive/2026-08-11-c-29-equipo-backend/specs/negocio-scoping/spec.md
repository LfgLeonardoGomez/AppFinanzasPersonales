## ADDED Requirements

### Requirement: Quién puede cambiar es_admin y desactivado

Los campos `es_admin` y `desactivado` SHALL ser modificables únicamente por las reglas que se enumeran acá, y SHALL NOT aceptarse nunca como dato de entrada en ningún payload. La capability `negocio-scoping` define los dos campos; este change fija **quién** puede cambiarlos.

- `desactivado` SHALL ser modificable únicamente por un `Usuario` con `es_admin = true` del **mismo negocio**, a través de los endpoints de equipo, y nunca por el propio interesado si eso dejara al negocio sin admin activo.
- `es_admin` SHALL NOT ser modificable por ninguna ruta de la API en este change. Se establece una sola vez, en el registro público, para quien crea el negocio.
- Ningún payload de negocio SHALL poder alterar estos campos: no son datos de entrada.

#### Scenario: un miembro común no puede desactivar a nadie

- **WHEN** un usuario con `es_admin = false` intenta desactivar a otro miembro de su negocio
- **THEN** la operación es rechazada y el estado del otro miembro no cambia

#### Scenario: es_admin no se puede alterar desde la API

- **WHEN** se envía `es_admin` en cualquier payload aceptado por la API
- **THEN** el valor persistido no cambia por efecto de ese payload

#### Scenario: los flags no cruzan negocios

- **WHEN** un admin del negocio A intenta modificar el estado de un usuario del negocio B
- **THEN** la respuesta es 404 y el usuario de B queda intacto
