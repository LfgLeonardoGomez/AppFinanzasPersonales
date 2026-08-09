# 03 · Actores y Roles

> Fuente: `docs/01-mvp-especificacion-funcional.md`, `docs/04-baseline-seguridad.md` §4.

## Actores del sistema

| Actor | Descripción |
|---|---|
| **Admin del negocio** (`es_admin = true`) | Quien creó el negocio en el registro público. Además de operar como cualquier miembro, puede generar invitaciones, listar el equipo y desactivar/reactivar miembros. |
| **Miembro del negocio** (`es_admin = false`) | Empleado que se registró con un código de invitación. Opera **todos** los recursos del negocio —proveedores, facturas, pagos, clientes, ventas, cobros— sin restricción. Lo único que no puede es gestionar el equipo. |
| **Visitante (no autenticado)** | Solo puede registrarse (como negocio nuevo o como empleado con código) o iniciar sesión. Sin acceso a ningún recurso de negocio. |

> **No hay un sistema de roles: hay un booleano** (D-29). Existe exactamente una familia de operaciones privilegiadas —la gestión del equipo— y por eso no se justifica un RBAC con tablas de roles y permisos. El día que aparezca un tercer nivel, `es_admin` se convierte en enum.
>
> **Nota de evolución:** hasta C-27 el actor único era "usuario dueño de sus datos" y el aislamiento era por `usuario_id`. D-27 lo reemplazó por `negocio_id` para que varias personas puedan trabajar sobre el mismo local desde dispositivos distintos.

## Modelo de autorización (aislamiento por negocio)

No es un RBAC clásico: es **aislamiento horizontal por `negocio_id`**, más un único flag de privilegio. Todos los miembros de un negocio ven exactamente los mismos datos.

| Recurso | Quién accede | Regla |
|---|---|---|
| Proveedor / Factura / Pago | Cualquier miembro activo del negocio | Filtrado por `negocio_id` (denormalizado) en el service layer |
| Cliente / Venta / CobroCliente | Cualquier miembro activo del negocio | Filtrado por `negocio_id` (denormalizado) en el service layer |
| Perfil de usuario | El propio usuario | — |
| Equipo (invitar, listar, desactivar) | **Solo `es_admin`** | Además del filtro por `negocio_id` |

### Reglas de aislamiento (críticas)

- **Toda** consulta de negocio se filtra por el `negocio_id` del usuario autenticado, en el **service layer** (no en el router).
- Acceder a un recurso de otro negocio devuelve **404** (no 403), para no revelar la existencia del recurso.
- Invariantes: `Factura.negocio_id == Proveedor.negocio_id`, `Pago.negocio_id == Proveedor.negocio_id`, `Venta.negocio_id == Cliente.negocio_id`, `CobroCliente.negocio_id == Cliente.negocio_id`. Validadas en el service layer.
- Un usuario con `desactivado = true` no autentica y sus refresh tokens se revocan (RN-NEG-07).
- `creado_por_usuario_id` es **autoría, no autorización**: nunca se usa para filtrar acceso.

## Rutas públicas (sin autenticación)

| Ruta | Propósito |
|---|---|
| Registro de negocio | Alta de cuenta + creación del negocio en una transacción (email, nombre, contraseña, nombre del negocio). `es_admin = true`. Rate limiting (RN-AUTH-06). |
| Registro de empleado | Alta de cuenta contra un **código de invitación** de un solo uso (RN-NEG-05). El empleado elige su propia contraseña; hereda `negocio_id`, `es_admin = false`. Rate limiting. Error genérico si el código es inválido, vencido o ya usado. |
| Login | Inicio de sesión. Con rate limiting (RN-AUTH-06). Mensaje de error genérico. |
| Solicitud de recuperación de contraseña | Envía el mail de reset. Respuesta **siempre idéntica** exista o no el email (D-38). Rate limiting. |
| Reset de contraseña | Consume el token de reset (un solo uso, con vencimiento) y setea la nueva contraseña. |

Todo el resto de los endpoints requiere sesión válida (cookie httpOnly). El `usuario_id` y el `negocio_id` se obtienen vía la dependency `get_current_user` (RN-AUTH-08, RN-NEG-09), y el filtro por `negocio_id` se aplica en el **service layer** en cada operación de negocio.

## Endpoints autenticados (resumen)

| Endpoint | Método | Propósito | Spec |
|---|---|---|---|
| `/api/auth/refresh` | POST | Rota el refresh token (RN-AUTH-04) | auth-backend |
| `/api/auth/logout` | POST | Revoca el refresh y borra cookies (RN-AUTH-05) | auth-backend |
| `/api/me` | GET | Perfil del usuario autenticado (sin `password_hash`) | auth-backend |
| `/api/me` | PATCH | Actualiza `telefono`, `nombre_negocio`, `tema_preferido` (subset, no toca `email`/`nombre`/`password`) | perfil-usuario-api |
| `/api/me/avatar` | POST | Setea `avatar_url` desde una URL Cloudinary validada | perfil-usuario-api |
| `/api/cloudinary/preset-firmado?tipo=avatar\|factura\|comprobante` | GET | Devuelve un upload preset firmado de Cloudinary (secret nunca expuesto) | perfil-usuario-api |
| `/api/proveedores/*` | CRUD | Aislado por `negocio_id` | proveedores-api |
| `/api/facturas/*` | CRUD + `extraer-ia` | Aislado por `negocio_id`; el `/extraer-ia` no persiste (RN-IA-04) | facturas-api, ia-vision-backend |
| `/api/pagos/*` | CRUD + `extraer-ia` | Aislado por `negocio_id`; sin `factura_id` (RN-PAG-01) | pagos-backend, ia-vision-backend |
| `/api/cuenta-corriente/proveedores/{id}` | GET | Saldo, estado FIFO, historial cronológico (todo on-demand) | cuenta-corriente-backend |
| `/api/equipo` | GET | Lista miembros del negocio. **Solo `es_admin`** (RN-NEG-06) | equipo-backend |
| `/api/equipo/invitaciones` | POST | Genera un código de un solo uso; el valor legible se devuelve **una sola vez** (RN-NEG-05). **Solo `es_admin`** | equipo-backend |
| `/api/equipo/{id}/desactivar` | POST | Revoca acceso sin borrar datos (RN-NEG-07). **Solo `es_admin`**; rechaza dejar al negocio sin admin activo (RN-NEG-08) | equipo-backend |
| `/api/clientes/*` | CRUD + `buscar` | Aislado por `negocio_id`; alta inline y unicidad normalizada (RN-CLI-01/03) | clientes-backend |
| `/api/ventas/*` | CRUD | Aislado por `negocio_id`; invariante `cliente_id ⟺ CUENTA_CORRIENTE` (RN-VTA-03) | ventas-backend |
| `/api/cobros/*` | CRUD | Aislado por `negocio_id`; sin `venta_id`, no puede superar el saldo (RN-CCC-03/04) | cuenta-corriente-clientes-backend |
| `/api/cuenta-corriente/clientes/{id}` | GET | Saldo, estado FIFO de ventas fiadas, historial (todo on-demand) | cuenta-corriente-clientes-backend |
| `/api/estadisticas/*` | GET | Agregaciones de compras y ventas por período (RN-VTA-05) | estadisticas-backend |
