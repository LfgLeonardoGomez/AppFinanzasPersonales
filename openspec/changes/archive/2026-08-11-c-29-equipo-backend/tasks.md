## 1. Red de seguridad

- [x] 1.1 Correr la suite completa y registrar el baseline (esperado: 902 passed). Un fallo previo se reporta como preexistente y NO se arregla acá.

## 2. Modelo y migración

- [x] 2.1 Test: `InvitacionEmpleado` se persiste con `negocio_id`, `codigo_hash` único, `creado_por_usuario_id`, `expira_en` y `usado_en` nullable; sin `deleted_at`.
- [x] 2.2 Test: dos invitaciones con el mismo `codigo_hash` son rechazadas por la restricción de unicidad.
- [x] 2.3 Crear `app/models/invitacion_empleado.py` y registrarlo en `app/models/__init__.py`.
- [x] 2.4 Test de migración `0007`: `upgrade` crea la tabla con sus índices; `downgrade` la elimina sin tocar `usuario`, `negocio` ni las tablas de negocio; ciclo upgrade→downgrade→upgrade limpio. Revisión fijada (`revision="0007"`, `down_revision="0006"`), nunca `head` (D-21).
- [x] 2.5 Escribir `alembic/versions/20240007_0007_invitacion_empleado.py`.

## 3. Generación del código

- [x] 3.1 Test: el código generado tiene 8 caracteres, sale del alfabeto sin ambigüedades (sin `0`, `O`, `1`, `I`, `L`) y dos generaciones consecutivas difieren.
- [x] 3.2 Test: se persiste el hash y NO el valor crudo; el mismo código produce siempre el mismo hash.
- [x] 3.3 Implementar el generador en `app/core/security.py` reusando el helper de hashing de los refresh tokens, con `secrets.choice` (nunca `random`).

## 4. Dependency de privilegio

- [x] 4.1 Test: `require_admin` deja pasar a un `es_admin = true` activo y rechaza a un `es_admin = false`.
- [x] 4.2 Test: `require_admin` rechaza también a un admin `desactivado` (hereda el chequeo de `get_current_user`).
- [x] 4.3 Implementar `require_admin` en `app/core/deps.py` sobre `get_current_user` (D1).

## 5. Service de equipo

- [x] 5.1 Test: `listar_miembros` devuelve solo los del `negocio_id` dado, incluidos los desactivados, sin `password_hash`.
- [x] 5.2 Test: `crear_invitacion` persiste con el `negocio_id` y el autor correctos, y devuelve el código legible una sola vez.
- [x] 5.3 Test: `desactivar` setea el flag y revoca los refresh tokens activos del usuario.
- [x] 5.4 Test: `desactivar` sobre un usuario de otro negocio levanta 404.
- [x] 5.5 Test (guarda RN-NEG-08): desactivar al único admin activo es rechazado con un error **explícito y distinto de 404**; con dos admins activos se permite.
- [x] 5.6 Test: `reactivar` devuelve el acceso y respeta el aislamiento por negocio.
- [x] 5.7 Implementar `app/services/equipo_service.py` con esos métodos; toda la autorización vive acá, nunca en el router.
- [x] 5.8 Agregar `revoke_all_for_usuario(usuario_id)` a `RefreshTokenRepository` + su test (revoca los activos, no toca los de otro usuario, es idempotente).

## 6. Alta de empleado por código

- [x] 6.1 Test: alta exitosa → usuario en el negocio de la invitación, `es_admin = false`, invitación marcada como usada, sin `Negocio` nuevo.
- [x] 6.2 Test: el mismo código no sirve dos veces.
- [x] 6.3 Test: código vencido rechazado.
- [x] 6.4 Test (D3): código inexistente, vencido y usado producen **idéntico** estado y mensaje.
- [x] 6.5 Test (D4): si el alta falla por email duplicado, la invitación NO se consume y sigue usable.
- [x] 6.6 Test: `es_admin = true` en el payload es ignorado; el usuario nace como miembro común.
- [x] 6.7 Test: el empleado puede loguearse con la contraseña que eligió, sin paso intermedio.
- [x] 6.8 Implementar `registrar_empleado(...)` en `usuario_service`, en una sola transacción.
- [x] 6.9 Schema `RegistroEmpleadoRequest` (email, nombre, password ≥ 8, codigo) — sin `es_admin` ni `negocio_id`.

## 7. Router

- [x] 7.1 Test de integración: `GET /api/equipo` como admin lista el equipo; como miembro común es rechazado; no cruza negocios.
- [x] 7.2 Test de integración: `POST /api/equipo/invitaciones` solo admin; devuelve el código una vez.
- [x] 7.3 Test de integración: desactivar → el siguiente request del afectado da 401; su refresh ya no renueva; sus facturas y pagos siguen visibles para el equipo.
- [x] 7.4 Test de integración: reactivar restaura el acceso.
- [x] 7.5 Test de integración: `POST /api/auth/registro-empleado` extremo a extremo, incluido el rate limiting (429).
- [x] 7.6 Implementar `app/routers/equipo.py` y registrarlo en `app/main.py`; agregar la ruta de registro de empleado en `app/routers/auth.py` con `rate_limit`.
- [x] 7.7 Verificar que las rutas de colección respondan igual con y sin barra final (contrato de C-27, sin `307`).

## 8. Cierre

- [x] 8.1 Test: ninguna ruta expuesta permite modificar `es_admin` (D7). Recorrer las rutas registradas y afirmarlo.
- [x] 8.2 Correr la suite completa y comparar contra el baseline de 1.1; reportar cualquier aserción debilitada con su justificación.
- [x] 8.3 Actualizar `knowledge-base/03_actores_y_roles.md` con las rutas nuevas y `04_modelo_de_datos.md` si el modelo se apartó de lo documentado.
- [x] 8.4 Registrar en `09_decisiones_y_supuestos.md` la decisión de **no** incluir promoción de admin, con el riesgo asumido y la dependencia práctica de C-31.
- [x] 8.5 Marcar C-29 en `CHANGES.md` y anotar en C-31 que deja de ser opcional: es la única salida ante un fundador bloqueado.
