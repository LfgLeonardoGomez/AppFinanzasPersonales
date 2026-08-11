## Why

C-28 dejó los campos del equipo creados y con significado real: `es_admin` decide privilegio y `desactivado` corta el acceso en el request siguiente. Pero **no hay forma de usarlos**. Hoy la única manera de sumar a un empleado o de dar de baja a alguien es entrar a la base de datos a mano — que es exactamente lo que una app autoservicio existe para evitar.

Sin este change, la funcionalidad que motivó toda la etapa —dos personas del mismo local trabajando desde sus propios dispositivos— está construida pero es inalcanzable.

## What Changes

- **Entidad `InvitacionEmpleado`**: código de un solo uso con vencimiento, del que se persiste **solo el hash** (mismo criterio que `RefreshToken`, D-17). El valor legible se muestra **una sola vez** a quien lo genera y no se puede volver a ver.
- **`POST /api/auth/registro-empleado`** (ruta pública): el empleado se registra solo contra un código, eligiendo su propia contraseña. Hereda el `negocio_id` del código y nace con `es_admin = false`. Un código inválido, vencido o ya usado devuelve el **mismo error genérico** — no revela si el negocio existe.
- **`GET /api/equipo`**: lista los miembros del negocio con su estado. Solo `es_admin`.
- **`POST /api/equipo/invitaciones`**: genera un código. Solo `es_admin`.
- **`POST /api/equipo/{id}/desactivar` y `/reactivar`**: revocan o restauran el acceso. Solo `es_admin`.
- **Revocación de sesiones al desactivar**: `RefreshTokenRepository` gana `revoke_all_for_usuario`. El acceso ya muere en el request siguiente por el chequeo de C-28; esto además impide **renovar** la sesión.
- **Guarda de último admin (RN-NEG-08)**: se rechaza toda operación que deje al negocio sin ningún `es_admin = true AND desactivado = false`.
- **Rate limiting** en el registro de empleado y en la generación de invitaciones.

**Fuera de alcance, por decisión explícita del usuario (2026-08-09):** **no hay promoción de admin.** El único admin sigue siendo quien creó el negocio. Se evaluó agregar `POST /api/equipo/{id}/promover` y se descartó para mantener el change chico. Ver el riesgo asumido en "Impact".

También fuera: degradar admins, transferir la propiedad del negocio, y cualquier cosa de frontend (C-30).

## Capabilities

### New Capabilities
- `equipo-backend`: alta de miembros por invitación de un solo uso, listado del equipo, revocación y restauración de acceso, y las reglas que impiden que un negocio quede sin administración.

### Modified Capabilities
- `auth-backend`: se suma la ruta pública `POST /api/auth/registro-empleado`, que crea un `Usuario` contra un negocio **existente** en lugar de crear uno nuevo.
- `negocio-scoping`: la capability define `es_admin` y `desactivado`; acá se especifica **quién** puede cambiarlos y bajo qué reglas.

## Impact

**Backend**: modelo y migración `0007` para `invitacion_empleado`; router nuevo `app/routers/equipo.py`; `app/services/equipo_service.py`; extensión de `usuario_service` para el alta por código; `revoke_all_for_usuario` en `RefreshTokenRepository`. Sin cambios en proveedores, facturas ni pagos.

**Riesgo asumido — negocio huérfano.** Con un solo admin posible, si esa persona pierde el acceso el negocio queda sin quien invite ni reactive. Está mitigado por dos cosas y conviene tenerlas presentes: la guarda de RN-NEG-08 impide que el admin se autodesactive, y **C-31 (recuperación de contraseña) es la única salida real** si olvida su clave. Eso convierte a C-31 en dependencia práctica de este modelo, no en un "nice to have": hasta que exista, un admin bloqueado necesita intervención manual sobre la base.

**Riesgo — enumeración de negocios.** El endpoint de registro por código es público y sin sesión. Si distinguiera "código inexistente" de "código vencido", permitiría sondear. Por eso el error es único y el rate limiting no es opcional.

**Riesgo — el código en tránsito.** El admin se lo pasa al empleado por fuera del sistema (WhatsApp, en persona). Un solo uso y 48hs acotan la ventana: si se filtra después de usarse, no sirve; si nunca se usa, muere solo.

**Governance: CRITICO.** Es control de acceso: quién entra a un negocio y quién deja de entrar.
