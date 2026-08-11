# clientes-backend Specification

## Purpose

Own the `Cliente` entity and, above all, what makes two typed names the same person (shipped by C-32). This is the mirror of `Proveedor` with one structural difference that drives everything: a supplier's name is a label and two suppliers may share it, while a customer's name identifies an **account** — two equivalent rows split one person's debt across two balances and destroy the only guarantee the feature has to make. Hence a `nombre_normalizado` derived in the service layer (never accepted from a payload) and a **partial** unique index over `(negocio_id, nombre_normalizado) WHERE deleted_at IS NULL`, so equivalent names cannot coexist while a soft-deleted customer still releases its name for reuse. The normalization is deliberately conservative — casing, accents and whitespace, but no phonetic matching, no word reordering, and `ñ` is not an `n` — because merging two different people is worse than allowing a duplicate. Also owns the minimal alta (only `nombre`, because it happens at the counter), the accent- and case-insensitive search that feeds the autocomplete, and the 409 that names the existing customer so the caller can offer it instead of creating a second account. Sales and running balances are NOT here (C-33, C-35).

## Requirements

### Requirement: Entidad Cliente aislada por negocio

El sistema SHALL definir un modelo SQLModel `Cliente` (tabla `cliente`) con `negocio_id` (FK → `negocio`, obligatorio), `nombre` (string, máximo 120, obligatorio), `nombre_normalizado` (string, máximo 120, obligatorio, indexado), `telefono` (nullable), `notas` (nullable), `creado_por_usuario_id` (FK → `usuario`, nullable) y `deleted_at` (soft delete), más el mixin base.

Toda consulta y mutación de `Cliente` SHALL filtrarse por el `negocio_id` del usuario autenticado, en el service layer. Un cliente de otro negocio SHALL responder **404**, nunca 403.

#### Scenario: el cliente nace en el negocio de quien lo crea

- **WHEN** un usuario autenticado crea un cliente
- **THEN** se persiste con el `negocio_id` de su sesión y con `creado_por_usuario_id` igual a su propio id

#### Scenario: cliente de otro negocio devuelve 404

- **WHEN** un usuario del negocio A intenta leer, modificar o eliminar un cliente del negocio B
- **THEN** cada operación responde 404 y el cliente de B queda sin modificar

#### Scenario: los compañeros de negocio comparten la cartera

- **WHEN** un miembro del negocio crea un cliente y otro miembro activo lista clientes
- **THEN** el cliente aparece en el listado del compañero

#### Scenario: el payload no puede fijar el negocio

- **WHEN** un payload de alta incluye un `negocio_id` distinto del de la sesión
- **THEN** el cliente se persiste con el `negocio_id` de la sesión

### Requirement: Alta mínima con solo el nombre

El sistema SHALL exponer `POST /api/clientes` aceptando `nombre` como **único campo obligatorio**. `telefono` y `notas` SHALL ser opcionales y editables después. El endpoint SHALL responder 201 con el cliente creado.

Pedir más datos en el momento de la venta rompe el flujo del mostrador; todo lo demás se completa cuando haga falta.

#### Scenario: alta solo con nombre

- **WHEN** se hace `POST /api/clientes` con únicamente `nombre`
- **THEN** el cliente queda creado con 201, y `telefono` y `notas` en `null`

#### Scenario: nombre vacío rechazado

- **WHEN** se envía un `nombre` vacío o compuesto solo por espacios
- **THEN** la API responde 422 y no se crea ningún cliente

### Requirement: Normalización derivada, nunca recibida

El sistema SHALL derivar `nombre_normalizado` a partir de `nombre` en el **service layer**, aplicando exactamente: pasar a minúsculas, quitar acentos y diacríticos, recortar los extremos y colapsar espacios internos múltiples en uno solo. El sistema SHALL NOT aceptar `nombre_normalizado` desde ningún payload.

La normalización SHALL mantenerse **conservadora**: no SHALL alterar el orden de las palabras, ni eliminar palabras, ni aplicar coincidencia fonética. Fusionar dos clientes realmente distintos es peor que permitir un duplicado — un duplicado se ve y se corrige, una fusión silenciosa mezcla la deuda de dos personas.

#### Scenario: mayúsculas y acentos no distinguen

- **WHEN** se normalizan "Juan Pérez", "juan perez" y "JUAN PEREZ"
- **THEN** las tres producen el mismo `nombre_normalizado`

#### Scenario: los espacios sobrantes no distinguen

- **WHEN** se normaliza "  Juan   Pérez  "
- **THEN** el resultado es idéntico al de "Juan Pérez"

#### Scenario: el nombre original se conserva tal cual se tipeó

- **WHEN** se crea un cliente con `nombre = "Juan Pérez"`
- **THEN** `nombre` persiste exactamente así, con sus mayúsculas y acentos, y solo `nombre_normalizado` está normalizado

#### Scenario: nombres distintos siguen siendo distintos

- **WHEN** se normalizan "Juan Perez" y "Juan Peres"
- **THEN** producen valores diferentes: la normalización no aplica coincidencia fonética

#### Scenario: el orden de las palabras importa

- **WHEN** se normalizan "Juan Pérez" y "Pérez Juan"
- **THEN** producen valores diferentes

#### Scenario: el payload no puede inyectar la normalización

- **WHEN** un payload de alta incluye `nombre_normalizado`
- **THEN** el valor persistido es el derivado de `nombre`, ignorando el del payload

### Requirement: Unicidad normalizada por negocio

La base de datos SHALL imponer un índice **único** sobre `(negocio_id, nombre_normalizado)` entre los clientes activos. Un alta que colisione SHALL responder **409** e incluir en la respuesta el **id y el nombre del cliente existente**, para que el llamador pueda ofrecerlo en lugar de crear un duplicado.

Dos clientes equivalentes en un mismo negocio partirían la deuda en dos cuentas, que es exactamente lo que una libreta no puede permitirse.

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

### Requirement: Búsqueda para autocompletado

El sistema SHALL exponer `GET /api/clientes?buscar=` que normaliza el texto recibido con la misma función que el alta y devuelve los clientes activos del negocio, ordenando **primero la coincidencia exacta normalizada** y luego las que contienen el fragmento. Sin el parámetro, SHALL devolver el listado del negocio.

#### Scenario: la coincidencia exacta va primero

- **WHEN** existen "Juan" y "Juan Pérez" y se busca "juan"
- **THEN** ambos aparecen y "Juan" encabeza el resultado

#### Scenario: la búsqueda ignora acentos y mayúsculas

- **WHEN** se busca "perez" y existe "Juan Pérez"
- **THEN** el cliente aparece en el resultado

#### Scenario: la búsqueda no cruza negocios

- **WHEN** un usuario del negocio A busca un nombre que solo existe en el negocio B
- **THEN** el resultado es vacío

#### Scenario: los eliminados no aparecen

- **WHEN** un cliente fue eliminado y se busca su nombre
- **THEN** no aparece en el resultado

### Requirement: Edición y eliminación del cliente

El sistema SHALL exponer `PATCH /api/clientes/{id}` para `nombre`, `telefono` y `notas`, y `DELETE /api/clientes/{id}` como **soft delete**. Al cambiar `nombre`, el sistema SHALL recalcular `nombre_normalizado`. Ambos endpoints SHALL responder 404 ante un cliente de otro negocio.

#### Scenario: renombrar recalcula la normalización

- **WHEN** se cambia el `nombre` de un cliente
- **THEN** `nombre_normalizado` queda derivado del nombre nuevo

#### Scenario: el soft delete preserva la fila

- **WHEN** se elimina un cliente
- **THEN** la fila sigue en la base con `deleted_at` poblado y desaparece de listados y búsquedas

#### Scenario: eliminar un cliente ajeno devuelve 404

- **WHEN** un usuario del negocio A intenta eliminar un cliente del negocio B
- **THEN** la respuesta es 404 y el cliente de B no se modifica

### Requirement: Todos los endpoints de clientes requieren sesión

Todo endpoint bajo `/api/clientes` SHALL requerir una sesión válida y SHALL rechazar con **401** a los usuarios sin sesión y a los `desactivado`. Las rutas de colección SHALL responder igual con y sin barra final, **sin redirect 307** (contrato de C-27).

#### Scenario: sin sesión no hay acceso

- **WHEN** se llama a cualquier endpoint de `/api/clientes` sin cookie válida
- **THEN** la respuesta es 401

#### Scenario: usuario desactivado rechazado

- **WHEN** un usuario con `desactivado = true` y token vigente llama a `/api/clientes`
- **THEN** la respuesta es 401

#### Scenario: la barra final no redirige

- **WHEN** se llama a `/api/clientes` y a `/api/clientes/` con la misma sesión
- **THEN** ambas responden 200 con el mismo cuerpo, sin 307
