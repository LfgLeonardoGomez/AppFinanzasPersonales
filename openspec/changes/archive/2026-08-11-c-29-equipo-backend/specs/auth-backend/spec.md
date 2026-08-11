## ADDED Requirements

### Requirement: Registro de empleado contra un negocio existente

El sistema SHALL exponer `POST /api/auth/registro-empleado` como ruta pública, junto a `POST /api/auth/registro`. Ambas crean un `Usuario`, pero son semánticamente distintas y SHALL permanecer separadas: el registro público crea un `Negocio` nuevo y su primer admin (C-28, RN-NEG-03), mientras que el registro de empleado suma un miembro a un negocio **ya existente** identificado por un código de invitación (RN-NEG-04).

El usuario creado por esta ruta SHALL tener `es_admin = false` y elegir su propia contraseña. El endpoint SHALL validar email y longitud mínima de contraseña con Pydantic, SHALL rechazar un email ya en uso, y SHALL tener rate limiting.

#### Scenario: el empleado entra al negocio de su código

- **WHEN** alguien se registra por esta ruta con un código válido
- **THEN** queda como miembro del negocio de esa invitación, con `es_admin = false`, y no se crea ningún `Negocio` nuevo

#### Scenario: las dos rutas de registro no se pisan

- **WHEN** se compara el resultado de `POST /api/auth/registro` con el de `POST /api/auth/registro-empleado`
- **THEN** la primera crea un negocio con su admin y la segunda no crea ningún negocio

#### Scenario: sin código no hay alta de empleado

- **WHEN** se llama a `POST /api/auth/registro-empleado` sin `codigo`
- **THEN** la API responde 422 y no se crea ningún usuario

#### Scenario: rate limiting en el alta por código

- **WHEN** se superan los intentos permitidos desde el mismo origen
- **THEN** la API responde 429
