## 1. Red de seguridad

- [x] 1.1 Correr la suite del backend y registrar el baseline (esperado: 1009 passed). Un fallo previo se reporta como preexistente y NO se arregla acá.

## 2. Abstracción de correo

- [x] 2.1 Test: el proveedor se resuelve por `EMAIL_PROVIDER` y el **default es consola** (un default que intente enviar de verdad mandaría correos desde una máquina de desarrollo).
- [x] 2.2 Test: el proveedor de consola escribe el mensaje en el log y **no abre ninguna conexión de red**.
- [x] 2.3 Test: el doble de tests acumula los envíos en memoria, de modo que se pueda afirmar destinatario y contenido.
- [x] 2.4 Implementar `app/core/email.py`: interfaz `EmailSender`, `ConsoleEmailSender`, y la factory por env (patrón de D-07).

## 3. Modelo y migración 0009

- [x] 3.1 Test: `TokenReset` se persiste con `usuario_id`, `token_hash` único, `expira_en`, `usado_en` nullable; sin `deleted_at`.
- [x] 3.2 Test: la generación devuelve el crudo y persiste **solo el hash**; el crudo no aparece en ninguna columna.
- [x] 3.3 Test: el token nace con `expira_en` **una hora** después (D1), no 48 como la invitación.
- [x] 3.4 Crear `app/models/token_reset.py` y registrarlo en `app/models/__init__.py`.
- [x] 3.5 Test de migración `0009`: crea la tabla con sus índices, `downgrade` limpio, ciclo upgrade→downgrade→upgrade. Revisión fijada (`revision="0009"`, `down_revision="0008"`), nunca `head` (D-21).
- [x] 3.6 Escribir `alembic/versions/20240009_0009_token_reset.py`.

## 4. Repository

- [x] 4.1 Test: `get_valido_by_token` resuelve el crudo al token vivo e **ignora** vencidos y usados (predicado en el WHERE, no en el caller).
- [x] 4.2 Test: `invalidar_pendientes_de_usuario` marca los vivos de ese usuario y **no toca los de otro**.
- [x] 4.3 Test: contar pendientes por usuario, para el tope de D5.
- [x] 4.4 Implementar `app/repositories/token_reset_repository.py`.

## 5. Pedido de recuperación

- [x] 5.1 Test: email existente → se persiste un token y se envía **un** correo al destinatario correcto.
- [x] 5.2 Test: email inexistente → **cero** tokens persistidos y **cero** correos.
- [x] 5.3 Test (el central, D2): las respuestas de email existente e inexistente son **idénticas** en código y cuerpo.
- [x] 5.4 Test (D2): el tiempo de las dos ramas es comparable — la rama sin cuenta también genera y hashea un token descartable. Afirmar que el trabajo ocurre, no medir milisegundos (sería inestable en CI).
- [x] 5.5 Test: un usuario `desactivado` no recibe correo y la respuesta sigue siendo la misma. Recuperar la contraseña no puede esquivar una baja.
- [x] 5.6 Test (D5): pedidos repetidos de la misma cuenta no acumulan tokens vivos más allá del tope; el más reciente siempre funciona.
- [x] 5.7 Implementar `solicitar_reset(...)` en `usuario_service`.

## 6. Aplicar la contraseña nueva

- [x] 6.1 Test: token válido + contraseña ≥ 8 → cambia el hash, marca el token usado, y el usuario puede loguearse con la nueva.
- [x] 6.2 Test: la contraseña anterior deja de servir.
- [x] 6.3 Test (D4): contraseña demasiado corta → 422, la contraseña no cambia y **el token NO se consume**.
- [x] 6.4 Test: token inexistente, vencido y ya usado producen **idéntico** estado y mensaje.
- [x] 6.5 Test (D3): al resetear se revocan **todos** los refresh tokens del usuario; el que tenía sesión no puede renovar.
- [x] 6.6 Test (D3): al resetear se invalidan los **demás** tokens de reset pendientes de esa cuenta.
- [x] 6.7 Test (D3): las sesiones de **otros** usuarios no se tocan.
- [x] 6.8 Test (D7): el reset **no** deja sesión iniciada.
- [x] 6.9 Implementar `aplicar_reset(...)` en `usuario_service`.

## 7. Rutas y schemas

- [x] 7.1 Test de integración: `POST /api/auth/recuperar` y `/reset` funcionan **sin sesión** y tienen rate limiting (429).
- [x] 7.2 Test: `PATCH /api/me` sigue sin poder cambiar `password` ni `password_hash`.
- [x] 7.3 Test estructural: las únicas vías que escriben `password_hash` son registro, registro de empleado y reset.
- [x] 7.4 Implementar los schemas y las dos rutas en `app/routers/auth.py`, con `rate_limit`.
- [x] 7.5 Verificar que el enlace del correo se arme sobre `FRONTEND_ORIGIN` y contenga el token.

## 8. Frontend

- [x] 8.1 Baseline del frontend (`npm test`, `tsc --noEmit`).
- [x] 8.2 Test: la pantalla "Olvidé mi contraseña" muestra **el mismo mensaje** haya o no cuenta — la UI no puede delatar lo que el backend oculta.
- [x] 8.3 Test: la pantalla de contraseña nueva toma el token del enlace y valida el mínimo de 8 antes de enviar.
- [x] 8.4 Test: un token rechazado muestra un mensaje único que orienta a pedir otro enlace.
- [x] 8.5 Test: tras un reset exitoso se lleva al login, sin sesión iniciada.
- [x] 8.6 Implementar las dos pantallas, sus hooks y las rutas públicas; enlace desde el login.

## 9. Cierre

- [x] 9.1 Verificar que el guard de eje siga verde; si señala algo, **renombrar** en vez de ampliar la lista blanca.
- [x] 9.2 Correr backend y frontend completos; comparar contra los baselines. Reportar cualquier aserción debilitada.
- [x] 9.3 Probar el flujo real de punta a punta: pedir recuperación, tomar el enlace del log de consola, resetear, verificar que la sesión vieja murió y que la contraseña nueva entra.
- [x] 9.4 Registrar en `09_decisiones_y_supuestos.md`: vida de una hora y por qué es distinta de la invitación, igualar el tiempo y no solo el texto, revocación total al resetear, y el token que no se consume ante contraseña inválida.
- [x] 9.5 Actualizar `03_actores_y_roles.md` (rutas públicas nuevas) y `07_flujos_principales.md` (flujo de recuperación).
- [x] 9.6 Marcar C-31 en `CHANGES.md` y **cerrar la nota de D-40**: el riesgo de negocio huérfano queda mitigado.
