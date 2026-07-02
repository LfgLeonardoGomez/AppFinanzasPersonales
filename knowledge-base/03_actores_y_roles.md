# 03 · Actores y Roles

> Fuente: `docs/01-mvp-especificacion-funcional.md`, `docs/04-baseline-seguridad.md` §4.

## Actores del sistema

| Actor | Descripción |
|---|---|
| **Usuario autenticado** | Único rol del MVP. Dueño de sus propios proveedores, facturas y pagos. Opera exclusivamente sobre sus datos. |
| **Visitante (no autenticado)** | Solo puede registrarse o iniciar sesión. Sin acceso a ningún recurso de negocio. |

> **No hay roles ni jerarquía de permisos en el MVP.** Multi-usuario significa "varios usuarios con datos aislados", NO "roles, permisos diferenciados o datos compartidos". Roles son **FUTURO**, condicionados a que la app deje de ser de uso personal.

## Modelo de autorización (aislamiento por cuenta)

No es un RBAC clásico: es **aislamiento horizontal por `usuario_id`**. Cada usuario ve y opera únicamente sus propios recursos.

| Recurso | Quién accede | Regla |
|---|---|---|
| Proveedor | Su dueño | Filtrado por `usuario_id` en el service layer |
| Factura | Su dueño | Filtrado por `usuario_id` (denormalizado) |
| Pago | Su dueño | Filtrado por `usuario_id` (denormalizado) |
| Perfil de usuario | El propio usuario | — |

### Reglas de aislamiento (críticas)

- **Toda** consulta de negocio se filtra por el `usuario_id` del usuario autenticado, en el **service layer** (no en el router).
- Acceder a un recurso de otro usuario devuelve **404** (no 403), para no revelar la existencia del recurso.
- Invariantes: `Factura.usuario_id == Proveedor.usuario_id` y `Pago.usuario_id == Proveedor.usuario_id`. Validadas en el service layer.

## Rutas públicas (sin autenticación)

| Ruta | Propósito |
|---|---|
| Registro | Alta de cuenta (email, nombre, contraseña). Con rate limiting (RN-AUTH-06). |
| Login | Inicio de sesión. Con rate limiting (RN-AUTH-06). Mensaje de error genérico. |

Todo el resto de los endpoints requiere sesión válida (cookie httpOnly). El `usuario_id` se obtiene vía la dependency `get_current_user` (RN-AUTH-08), y se filtra en el **service layer** en cada operación de negocio.

## Endpoints autenticados (resumen)

| Endpoint | Método | Propósito | Spec |
|---|---|---|---|
| `/api/auth/refresh` | POST | Rota el refresh token (RN-AUTH-04) | auth-backend |
| `/api/auth/logout` | POST | Revoca el refresh y borra cookies (RN-AUTH-05) | auth-backend |
| `/api/me` | GET | Perfil del usuario autenticado (sin `password_hash`) | auth-backend |
| `/api/me` | PATCH | Actualiza `telefono`, `nombre_negocio`, `tema_preferido` (subset, no toca `email`/`nombre`/`password`) | perfil-usuario-api |
| `/api/me/avatar` | POST | Setea `avatar_url` desde una URL Cloudinary validada | perfil-usuario-api |
| `/api/cloudinary/preset-firmado?tipo=avatar\|factura\|comprobante` | GET | Devuelve un upload preset firmado de Cloudinary (secret nunca expuesto) | perfil-usuario-api |
| `/api/proveedores/*` | CRUD | Aislado por `usuario_id` | proveedores-api |
| `/api/facturas/*` | CRUD + `extraer-ia` | Aislado por `usuario_id`; el `/extraer-ia` no persiste (RN-IA-04) | facturas-api, ia-vision-backend |
| `/api/pagos/*` | CRUD + `extraer-ia` | Aislado por `usuario_id`; sin `factura_id` (RN-PAG-01) | pagos-backend, ia-vision-backend |
| `/api/cuenta-corriente/proveedores/{id}` | GET | Saldo, estado FIFO, historial cronológico (todo on-demand) | cuenta-corriente-backend |
