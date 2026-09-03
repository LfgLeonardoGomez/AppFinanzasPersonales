# api-contract-types Specification

## Purpose
TBD - created by archiving change c-41-api-types-generated. Update Purpose after archive.

## Requirements

### Requirement: Las formas del contrato se derivan del OpenAPI del backend

Los tipos del frontend que describen datos provenientes de la API SHALL derivarse del esquema OpenAPI que publica el backend, y SHALL NOT transcribirse a mano.

El artefacto generado SHALL vivir en un archivo propio, marcado como derivado, y SHALL NOT editarse a mano. El script de generación SHALL escribir sobre ese archivo y SHALL NOT sobrescribir ningún archivo escrito a mano.

#### Scenario: El script de generación no destruye trabajo hecho a mano

- **WHEN** se ejecuta el script de generación de tipos con el backend disponible
- **THEN** se reescribe únicamente el archivo generado
- **AND** el archivo de tipos públicos escrito a mano queda intacto

#### Scenario: Los tipos públicos conservan sus nombres

- **WHEN** un módulo del frontend importa un tipo del contrato por su nombre público
- **THEN** ese nombre sigue estando exportado desde el mismo módulo que antes
- **AND** el proyecto compila sin que ese módulo haya cambiado su import

### Requirement: La divergencia entre el contrato y los tipos públicos falla en tiempo de compilación

Cada tipo público derivado de un schema del backend SHALL estar cubierto por una aserción de compilación que verifique su correspondencia con ese schema.

Si el contrato del backend cambia de forma incompatible con un tipo público, la verificación de tipos SHALL fallar. La divergencia SHALL NOT poder quedar sin detectar hasta que un usuario la encuentre en pantalla.

#### Scenario: Un campo que desaparece del contrato rompe la compilación

- **WHEN** un schema del backend deja de exponer un campo que el tipo público declara
- **AND** se regeneran los tipos
- **THEN** la verificación de tipos falla señalando ese tipo

#### Scenario: Un tipo que ya no corresponde a su schema rompe la compilación

- **WHEN** un schema del backend cambia el tipo de uno de sus campos
- **AND** se regeneran los tipos
- **THEN** la verificación de tipos falla señalando ese tipo

### Requirement: Los decimales del contrato se convierten a número en el borde de la API

El backend serializa todo valor decimal como cadena de texto. Los tipos públicos SHALL exponer esos valores como número, y esa conversión SHALL realizarse en el cliente de API que recibe la respuesta.

Un tipo público SHALL NOT declarar un valor monetario como número sin que exista una conversión que lo produzca. Ningún componente SHALL recibir un decimal codificado como cadena bajo un tipo que promete un número.

La conversión SHALL aplicarse a campos nombrados explícitamente. El sistema SHALL NOT convertir valores por inferencia sobre su forma o su nombre, porque hay cadenas de dígitos —el CUIT entre ellas— que deben permanecer como texto y que una conversión automática corrompería.

#### Scenario: Un monto llega como cadena y se consume como número

- **WHEN** el backend responde con un valor decimal serializado como cadena
- **THEN** el cliente de API lo convierte a número antes de entregarlo
- **AND** el consumidor recibe un número, sin necesidad de convertirlo

#### Scenario: El CUIT no se convierte

- **WHEN** una respuesta incluye un CUIT junto a campos monetarios
- **THEN** los campos monetarios se convierten a número
- **AND** el CUIT se conserva como texto, sin alteración

#### Scenario: Un decimal malformado interrumpe en vez de inventar un cero

- **WHEN** una respuesta trae un valor decimal que no se puede convertir
- **THEN** la conversión falla de forma explícita
- **AND** la vista queda en estado de error
- **AND** no se muestra un cero ni ningún otro valor sustituto

### Requirement: Los datos simulados en las pruebas reproducen la forma del wire

Las pruebas que simulan respuestas de la API SHALL entregar los valores decimales con la misma forma con que los entrega el backend.

Una prueba SHALL NOT simular una respuesta con los decimales ya convertidos, porque eso saltea la conversión que la prueba debería estar ejercitando y la deja pasar sin verificar nada.

#### Scenario: Una prueba de un cliente de API ejercita la conversión

- **WHEN** una prueba simula una respuesta con un valor decimal
- **THEN** el valor simulado tiene la forma que entrega el backend
- **AND** la prueba verifica el valor ya convertido que devuelve el cliente

### Requirement: Los tipos que no provienen del contrato están rotulados como tales

Los tipos que el frontend construye por su cuenta y que no corresponden a ningún schema del backend —filtros de consulta, envoltorios de paginación y formas de error propias— SHALL agruparse bajo un rótulo que los identifique como escritos a mano y explique por qué no se generan.

Un lector SHALL poder distinguir, sin salir del archivo, qué tipos son contrato del backend y cuáles son construcción del frontend.

#### Scenario: Un tipo local es distinguible de uno del contrato

- **WHEN** alguien abre el archivo de tipos públicos
- **THEN** los tipos que no provienen del backend están agrupados bajo un rótulo explícito
- **AND** el rótulo indica por qué no se generan

#### Scenario: Agregar un tipo obliga a elegir un lado

- **WHEN** se agrega un tipo nuevo al archivo de tipos públicos
- **THEN** queda derivado de un schema del backend o dentro de la sección rotulada
- **AND** no existe un tercer lugar donde un tipo pueda quedar sin clasificar
