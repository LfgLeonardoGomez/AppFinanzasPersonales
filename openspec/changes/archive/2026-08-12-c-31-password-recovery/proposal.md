## Why

Este change dejó de ser opcional por una decisión que tomamos nosotros. En C-29 se resolvió que **el único admin de un negocio es quien lo creó** (D-40), sin ruta de promoción. La consecuencia quedó escrita entonces y ahora hay gente real entrando por invitación: **si el fundador olvida su contraseña, el negocio queda sin nadie que pueda invitar ni reactivar, y sin salida por software.** Hoy eso se arregla metiendo mano en la base de datos, que es exactamente lo que una app autoservicio existe para evitar.

Para un empleado el problema es menor pero igual de tonto: pierde la contraseña que él mismo eligió y necesita que un admin le genere una invitación nueva... que no sirve, porque su email ya está registrado. Hoy no tiene ninguna salida.

## What Changes

- **Entidad `TokenReset`**: un solo uso, con vencimiento corto, del que se persiste **solo el hash** — mismo criterio que `RefreshToken` (D-17) y que las invitaciones (D-31).
- **`POST /api/auth/recuperar`** (público): recibe un email y, si corresponde a una cuenta, envía el enlace de reseteo. La respuesta es **idéntica exista o no la cuenta**, incluido el tiempo que tarda.
- **`POST /api/auth/reset`** (público): consume el token, valida la contraseña nueva y la aplica. **Revoca todas las sesiones activas** del usuario e **invalida los demás tokens de reset pendientes**.
- **Abstracción de envío de email** configurable por env, con una implementación de consola para desarrollo. En tests **siempre mockeada** — nunca se pega a un servicio real (regla dura #9).
- **Pantallas**: "Olvidé mi contraseña" y "Elegir contraseña nueva".
- **Migración `0009`** (número reservado desde C-32, D-46).

**Fuera de alcance**: cambiar la contraseña estando logueado (es otro flujo, con otra validación), verificación de email al registrarse, y segundo factor.

## Capabilities

### New Capabilities
- `password-recovery`: el ciclo completo de recuperación — pedido, entrega por email, consumo del token, y qué pasa con las sesiones abiertas.

### Modified Capabilities
- `auth-backend`: dos rutas públicas nuevas, y la contraseña deja de ser inmutable fuera del registro.

## Impact

**Backend**: `app/models/token_reset.py`, `app/repositories/token_reset_repository.py`, extensión de `usuario_service`, `app/core/email.py` (abstracción nueva), rutas en `app/routers/auth.py`, migración `0009`. **Frontend**: dos pantallas y sus hooks.

**Riesgo — enumeración de cuentas.** Es el riesgo central. Si la respuesta distinguiera "te mandamos el mail" de "ese email no existe", el endpoint sería un oráculo para descubrir quién tiene cuenta. Y no alcanza con igualar el texto: **si la rama que existe hashea y envía y la otra no hace nada, el tiempo delata**. El proyecto ya resolvió esto en login con `dummy_verify()` (D-C03-5) y acá hay que aplicar el mismo criterio.

**Riesgo — bombardeo de mails.** Un endpoint público que dispara correos hacia una dirección que el atacante elige puede usarse para inundarle la casilla a alguien. El rate limiting existente es **por IP**, así que no lo frena si rota IPs. Se acota limitando también cuántos resets pendientes puede tener una misma cuenta.

**Riesgo — el token viaja por email.** El correo no es un canal seguro: queda en servidores, en backups, en la pantalla del que mira por encima del hombro. Por eso el vencimiento es corto y el uso es único. Un token de reset es más peligroso que una invitación: la invitación crea una cuenta nueva, este **toma el control de una existente**.

**Riesgo — un reset no invalida las sesiones abiertas.** Si alguien resetea la contraseña porque sospecha que le entraron, y el intruso conserva su sesión, el reset no sirvió de nada. Revocar todo al aplicar el cambio no es un extra, es el punto.

**Governance: CRITICO.** Es el camino por el cual alguien toma control de una cuenta sin conocer la contraseña anterior. Cualquier error acá es una toma de cuenta.
