## Why

C-29 dejó la gestión de equipo funcionando y **sin cara**. Hoy, para sumar a un empleado, el dueño tendría que hacer un POST a mano. La funcionalidad que motivó toda la etapa —dos personas del mismo local trabajando desde sus propios dispositivos— está completa en el backend y es inalcanzable desde la app.

Hay una segunda razón para que este change sea el próximo del frontend: **paga la deuda que dejó C-28**. Los tipos TypeScript se generan desde el OpenAPI del backend (`npm run generate-types`), y hoy siguen siendo los viejos: `api.d.ts` todavía declara `usuario_id` en proveedores, facturas y pagos, campo que el backend ya no devuelve. El proyecto compila por casualidad, contra un contrato que dejó de existir.

## What Changes

- **Registro con dos caminos visibles**: "Crear mi negocio" y "Sumarme a un negocio" (con campo de código). Hoy `RegisterPage` solo conoce el primero, así que un empleado con código no tiene por dónde entrar.
- **Pantalla de equipo** (`/equipo`): lista de miembros con su estado, acción de invitar, y desactivar/reactivar con confirmación.
- **El código de invitación se muestra una sola vez**, con copia al portapapeles y un aviso explícito de que no se puede volver a ver. Si la UI no lo deja claro, el admin cierra el modal y pierde el código.
- **La sección Equipo solo se renderiza para `es_admin`** — el backend ya lo bloquea con 403; esto evita ofrecer algo que va a fallar.
- **Mensajes accionables** para los dos errores propios del dominio: código inválido (genérico a propósito) y último admin (409, con la explicación de por qué no se puede).
- **Regeneración de los tipos OpenAPI** y corrección de lo que rompa. El único uso de producción de `usuario_id` es `FacturaFormPage.tsx:55`; el resto son fixtures de test.

**Fuera de alcance**: clientes y ventas (C-34), recuperación de contraseña (C-31), y cualquier cosa de promoción de admin, que no existe en el backend por decisión (D-40).

## Capabilities

### New Capabilities
- `equipo-frontend`: las pantallas de gestión de equipo y el camino de alta por invitación, incluida la entrega única del código.

### Modified Capabilities
- `auth-frontend`: el registro deja de tener un solo camino y pasa a ofrecer dos, con semántica distinta.
- `facturas-frontend`: `FacturaFormPage` deja de leer `usuario_id` de la factura, que ya no viene en la respuesta.

## Impact

**Frontend**: `RegisterPage`, `src/features/equipo/` (nuevo), `src/app/router.tsx`, `AppLayout` (entrada de navegación condicionada a `es_admin`), `src/shared/api/api.d.ts` regenerado, y `FacturaFormPage.tsx`. Backend: **cero cambios**.

**Riesgo — la regeneración de tipos toca todo el repo a la vez.** `api.d.ts` se regenera entero, así que el diff va a incluir cambios que no son de este change (nombres de operaciones, campos nuevos de C-29). Hay que separarlo en su propio commit para que el resto sea revisable.

**Riesgo — la regeneración necesita el backend corriendo.** `generate-types` apunta a `http://localhost:8000/openapi.json`. Si se corre contra un backend desactualizado, los tipos quedan peor que antes. Hay que verificar que el contenedor esté con el código de C-29 antes de regenerar.

**Riesgo — el código de invitación mostrado una sola vez.** Es la parte donde un error de UX se traduce en fricción real: el admin cierra el diálogo, pierde el código y tiene que generar otro. No es catastrófico —generar otro es gratis— pero es la clase de detalle que hace que la gente desconfíe de la app.

**Riesgo — 43 fixtures de test declaran `usuario_id`.** Al regenerar, TypeScript va a marcarlos todos. La corrección es mecánica, pero es superficie grande y hay que revisar que ningún test pierda su aserción en el camino.

**Governance: ALTO.** No toca datos ni auth del lado servidor, pero es la puerta de entrada de gente nueva al sistema: si el registro por código queda mal, o la sección de equipo se le muestra a quien no debe, el problema es de control de acceso aunque el backend aguante.
