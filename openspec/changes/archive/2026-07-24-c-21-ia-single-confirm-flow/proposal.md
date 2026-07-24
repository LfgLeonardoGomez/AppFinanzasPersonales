## Why

Hoy el flujo de carga por IA obliga a **confirmar dos veces**: la IA lee la imagen y precarga un modal, el usuario confirma, y recae en un segundo formulario grande donde vuelve a confirmar. Dos interfaces distintas para el mismo acto de "aceptar lo que la IA leyó": molesto e impráctico. Peor aún, se pierde valor que la IA ya generó: la **foto que leyó se descarta** (no queda como comprobante) y el **proveedor sugerido no se pre-matchea** (el usuario tiene que buscarlo/tipearlo a mano). El objetivo es que **la IA deje todo listo y el usuario confirme UNA sola vez**, aplicando el mismo flujo a facturas y pagos.

## What Changes

- **Modal IA terminal (un solo confirmar).** `PropuestaIAModal` deja de ser una superficie de sólo-prefill: al confirmar **crea el recurso directamente** (`POST /api/facturas` o `POST /api/pagos`) reusando las mutations `useCreateFactura` / `useCreatePago`, con la imagen ya subida a Cloudinary. Para el camino IA se **elimina el segundo paso** por el formulario grande. **BREAKING (de decisión, no de API):** supersede D-19/RN-IA-04-frontend de C-15 ("el modal no hace POST, sólo lee y confirma; la persistencia ocurre en el form"). El **endpoint de extracción sigue sin persistir** (RN-IA-04 backend intacto); lo que cambia es que el **confirm humano** dentro del modal ahora dispara el create.
- **Auto-match de proveedor en el modal.** Al recibir la propuesta, se busca el `proveedor_nombre` sugerido contra los proveedores del usuario (reuso de `buscarProveedores` / `useBuscarProveedores`, RN-VINC): si hay match exacto normalizado → se pre-selecciona (confirm habilitado); si no hay match → opción **"Crear «X»" inline dentro del modal** (crea con sólo el nombre — `ProveedorCreate` sólo requiere `nombre`, `categoria` default `OTRO`, nombre editable antes de crear) y sigue el confirm sin salir del modal. La **confirmación humana se mantiene** (RN-IA-06 intacto: la IA propone, el humano fija y confirma).
- **Persistir la imagen leída por la IA.** El `File` que la IA leyó se sube a Cloudinary al confirmar y se persiste como `archivo_url` (Factura) / `comprobante_url` (Pago), reusando el preset firmado (`getCloudinaryPreset`). Hoy el `File` se descarta: `onConfirm(propuesta, proveedor)` no lo transporta.
- **Redirect a la cuenta corriente del proveedor tras crear** (`/proveedores/:id`). Factura ya lo hace; **pago falta** (`PagoFormPage` sigue navegando a `/pagos`) — se corrige usando el `proveedor_id` del pago creado.
- **Rate limit IA configurable por env.** `app/core/rate_limit_ia.py` tiene hoy `10/hora` HARDCODEADO — demasiado restrictivo para un MVP de un usuario y frena las pruebas. Se agregan settings `IA_RATE_MAX_REQUESTS` / `IA_RATE_WINDOW_SECONDS` en `app/core/config.py` con **default cómodo (~60/hora)**, aplicadas al limiter compartido (factura + pago).

## Capabilities

### New Capabilities
<!-- No new capabilities: this change modifies existing frontend/backend behavior. -->

### Modified Capabilities
- `ia-vision-frontend`: El modal de IA pasa a ser **terminal** (crea el recurso en un solo confirm), hace **auto-match** del proveedor sugerido, ofrece **creación inline** de proveedor sin salir del modal, y **persiste la imagen** leída a Cloudinary. Supersede la decisión C-15 de "modal no persiste; el form crea".
- `ia-vision-backend`: El rate limit por `usuario_id` (RN-IA-07) pasa de `10/hora` hardcodeado a **configurable por env** con default ~60/hora. La extracción sigue sin persistir.
- `pagos-frontend`: Tras crear un pago, redirigir a la **cuenta corriente del proveedor** (`/proveedores/:id`) en lugar de `/pagos`, alineando con el comportamiento de facturas.
- `facturas-frontend`: El camino IA de creación **ya no rutea al formulario grande**; el recurso se crea desde el modal. El camino manual permanece igual.

## Impact

- **Frontend** (`facturas-proveedores-web`):
  - `src/features/ia-vision/components/PropuestaIAModal.tsx` — vuelve terminal: crea recurso, sube imagen, orquesta match/creación de proveedor; el confirm ahora recibe el `File`.
  - `PropuestaFacturaFields.tsx` / `PropuestaPagoFields.tsx` — auto-match + crear proveedor inline (pago hoy no tiene selector de proveedor en el modal; se agrega).
  - `FacturaFormPage.tsx` / `PagoFormPage.tsx` — el camino IA deja de setear `mode='form'`; pago necesita el redirect a `/proveedores/:id`.
  - `iaVisionApi.ts` / `iaVisionHooks.ts` — sin cambio de contrato de extracción; se coordina el create desde el modal reusando `useCreateFactura` / `useCreatePago`.
  - Reuso: `FileUploadField`/`getCloudinaryPreset`/`useCloudinaryPreset` (upload), `useBuscarProveedores` + `buscarProveedores` (match), `useCreateProveedor` (creación inline).
- **Backend** (`facturas-proveedores-api`):
  - `app/core/config.py` — nuevas settings `IA_RATE_MAX_REQUESTS` (default 60) / `IA_RATE_WINDOW_SECONDS` (default 3600).
  - `app/core/rate_limit_ia.py` — leer las settings en vez de constantes de módulo. El endpoint `extraer-ia` y RN-IA-04 no cambian.
  - `.env.example` — documentar las dos variables nuevas.
- **KB**: `knowledge-base/05_reglas_de_negocio.md` (RN-IA-04/06/07 reflejan el nuevo flujo), `09_decisiones_y_supuestos.md` (nueva D-26 que supersede la decisión C-15 "modal no POST").
- **Invariantes preservadas:** no se persiste saldo/estado (on-demand); el pago no se vincula a factura (`PagoCreate` sin `factura_id`, `extra="forbid"`); filtrado por `usuario_id` en el service layer (404); la IA propone/el humano confirma; validación Pydantic en backend; TS estricto sin `any`; externos mockeados en tests, Postgres real por contenedor.
