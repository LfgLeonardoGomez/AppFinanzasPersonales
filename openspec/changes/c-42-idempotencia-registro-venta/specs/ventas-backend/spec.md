## ADDED Requirements

### Requirement: Registrar una venta es una escritura protegida por clave de idempotencia

`POST /api/ventas` SHALL aceptar el header opcional `Idempotency-Key` y SHALL honrar el contrato completo de la capacidad `escritura-idempotente`: una repetición con los mismos datos devuelve la venta original, una clave reutilizada con datos distintos es `409`, la unicidad la garantiza la base y la búsqueda por clave se filtra por `negocio_id`.

Esta es la única escritura del sistema donde un duplicado se convierte en la deuda de un tercero. Una venta fiada **es** el cargo en la cuenta corriente del cliente (D-33): registrarla dos veces le cobra dos veces a una persona real, y el número duplicado es el que se le muestra cuando pregunta cuánto debe. Este requisito protege en la capa de transporte la garantía que D-33 dio en el modelo.

La comparación entre el pedido repetido y la venta guardada SHALL hacerse sobre `monto`, `fecha`, `forma_pago`, `cliente_id` y `notas`, después de la normalización de Pydantic.

#### Scenario: el reintento de una venta al contado no crea una segunda

- **WHEN** se postea dos veces la misma venta en efectivo con la misma clave de idempotencia
- **THEN** existe una sola venta, y la segunda respuesta es `200` con esa misma venta y el header `Idempotent-Replay: true`

#### Scenario: el reintento de un fiado no duplica la deuda del cliente

- **WHEN** se postea dos veces la misma venta con `forma_pago = CUENTA_CORRIENTE` y el mismo cliente, usando la misma clave
- **THEN** el cliente tiene un solo cargo, y su saldo pendiente refleja el monto una sola vez

#### Scenario: dos ventas iguales sin clave siguen siendo dos ventas

- **WHEN** se postean dos ventas con idéntico monto, fecha y forma de pago, sin `Idempotency-Key`
- **THEN** se crean las dos, porque la granularidad de carga es libre (RN-VTA-06) y dos ventas iguales son un caso normal

#### Scenario: una clave con un monto corregido no se traga la corrección

- **WHEN** se repite el POST con la misma clave y un monto distinto
- **THEN** la respuesta es `409`, el `detail` incluye la venta existente, y la venta guardada conserva su monto original

#### Scenario: la clave de una venta eliminada no crea una segunda venta

- **WHEN** una venta creada con clave se elimina y luego llega un reintento con esa misma clave
- **THEN** la respuesta es `409` y no aparece una nueva venta en el listado

#### Scenario: la misma clave en dos negocios no cruza datos

- **WHEN** dos negocios postean una venta con la misma clave de idempotencia
- **THEN** cada negocio obtiene su propia venta creada, y el listado de cada uno muestra solo la suya

#### Scenario: la validación de negocio sigue corriendo antes de la idempotencia

- **WHEN** se postea con una clave nueva una venta con `forma_pago = CUENTA_CORRIENTE` y sin cliente
- **THEN** la respuesta es `422` por la invariante de RN-VTA-03, no se persiste nada, y la clave queda libre para un envío corregido

### Requirement: La clave de idempotencia se persiste en la venta y no altera su significado

El modelo `Venta` SHALL incorporar una columna `idempotency_key` (uuid, nullable) y un índice único `(negocio_id, idempotency_key)` restringido a las filas con clave presente. La columna SHALL ser exclusivamente un registro de qué operación creó la fila y SHALL NOT participar de ningún cálculo de negocio.

No se persiste ningún valor derivado: la clave no es un saldo ni un estado, y las invariantes de D-01 quedan intactas. La respuesta pública de una venta SHALL NOT exponer la clave — es un detalle del transporte, no del dominio.

La columna es nullable porque todas las ventas ya existentes no tienen clave y porque el header es opcional: una venta sin clave es una venta válida.

#### Scenario: el índice existe y rechaza el duplicado a nivel de base

- **WHEN** se insertan directamente en la tabla dos filas del mismo negocio con la misma `idempotency_key`
- **THEN** la base rechaza la segunda

#### Scenario: varias ventas sin clave conviven

- **WHEN** se insertan varias ventas del mismo negocio con `idempotency_key` nula
- **THEN** la base las acepta todas

#### Scenario: la respuesta de la API no expone la clave

- **WHEN** se lee una venta creada con clave de idempotencia
- **THEN** el cuerpo de la respuesta no incluye ningún campo de clave de idempotencia

#### Scenario: la venta sigue sin columnas derivadas

- **WHEN** se inspecciona el esquema de `venta` después de la migración
- **THEN** no existe columna de saldo ni de estado, igual que antes
