## ADDED Requirements

### Requirement: El frontend no depende de usuario_id en las respuestas

Los componentes SHALL NOT leer `usuario_id` de las respuestas de proveedores, facturas ni pagos: el backend dejó de devolverlo en C-28, donde el eje de pertenencia pasó a ser `negocio_id`. Los tipos generados desde OpenAPI (`src/shared/api/api.d.ts`) SHALL regenerarse contra el backend vigente, de modo que el compilador —y no el navegador— sea quien detecte cualquier uso remanente.

Hasta este change el proyecto compilaba contra un contrato que ya no existía, y el único uso de producción (`FacturaFormPage`) copiaba un `undefined` a un campo que nunca se renderiza. No fallaba a la vista, que es justamente lo que lo hacía peligroso.

#### Scenario: los tipos reflejan el backend real

- **WHEN** se regeneran los tipos desde el OpenAPI del backend vigente
- **THEN** las respuestas de proveedor, factura y pago declaran `negocio_id` y no declaran `usuario_id`

#### Scenario: el proyecto compila sin usos remanentes

- **WHEN** se corre la verificación de tipos con los tipos regenerados
- **THEN** no queda ningún error por `usuario_id` en código de producción

#### Scenario: el formulario de factura sigue mostrando el proveedor

- **WHEN** se abre la edición de una factura existente
- **THEN** el nombre del proveedor se muestra igual que antes, sin depender de `usuario_id`
