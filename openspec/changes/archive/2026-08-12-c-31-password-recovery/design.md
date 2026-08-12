## Context

Tres patrones del proyecto se reusan tal cual acá, y conviene nombrarlos porque ahorran discusión:

- **Secreto opaco con hash-only** (D-17 para refresh tokens, D-31 para invitaciones): se genera un valor de alta entropía, se persiste solo su SHA-256, el crudo viaja una vez y no se guarda.
- **Respuesta indistinguible** (D-C03-5 en login, D-41 en códigos de invitación): cuando un endpoint público puede usarse para averiguar si algo existe, todas las ramas responden igual.
- **Abstracción seleccionable por env** (D-07 para el proveedor de visión): la integración externa vive detrás de una interfaz, se elige por variable de entorno y en tests siempre está mockeada.

Lo que hace a este change distinto de C-29, pese al parecido: una invitación **crea una cuenta nueva**, un token de reset **toma control de una que ya existe**. Todo lo que sigue —vida más corta, revocación de sesiones, límite por cuenta— sale de esa diferencia.

## Goals / Non-Goals

**Goals:**
- Que un fundador bloqueado pueda volver sin que nadie toque la base.
- Que el endpoint público no sirva para averiguar quién tiene cuenta, ni por el texto ni por el tiempo.
- Que un reset cierre de verdad: sesiones abiertas y otros tokens pendientes.
- Que los tests nunca manden un correo real.

**Non-Goals:**
- Cambiar la contraseña estando logueado. Es otro flujo: hay sesión, así que se pide la actual y no hace falta ningún token.
- Verificar el email al registrarse.
- Segundo factor.
- Elegir proveedor de correo de producción. Este change entrega la abstracción y la implementación de consola; conectar un servicio real es configuración de despliegue.

## Decisions

### D1 — El token es opaco y URL-safe, con una hora de vida

`secrets.token_urlsafe(32)` — el mismo generador que los refresh tokens, con salida apta para viajar en un query string. Se persiste `sha256(token)`.

**Por qué una hora y no 48 como la invitación**: la invitación crea una cuenta nueva; si se filtra, alguien entra a un negocio y el admin lo ve aparecer en la lista y lo desactiva. Un token de reset **se apodera de una cuenta existente**, incluida la del único admin. La ventana tiene que ser la mínima que siga siendo usable por una persona que abre el mail cuando puede.

**No se reusa el alfabeto legible de las invitaciones** (D2 de C-29): aquel existe para dictarse por teléfono. Este viaja en un enlace y nadie lo lee, así que se prioriza entropía.

### D2 — Igualar el tiempo, no solo el texto

La rama "el email existe" hace: buscar usuario, generar token, hashear, insertar, componer y despachar el correo. La rama "no existe" no hacía nada, y esa diferencia es medible desde afuera.

Se ejecuta trabajo equivalente en ambas: cuando no hay cuenta, se genera y hashea un token igual y **se descarta sin persistir ni enviar**. El proyecto ya usa esta idea en login con `dummy_verify()` (D-C03-5), así que hay precedente y nombre.

**Alternativa considerada**: encolar el envío en background para que ninguna rama espere al correo. Resolvería el timing de forma más limpia, pero mete una cola donde hoy no hay ninguna. Se descarta por desproporcionado.

### D3 — El reset revoca todas las sesiones y los demás tokens pendientes

Al aplicar la contraseña nueva se llama a `revoke_all_for_usuario` (ya existe desde C-29) y se marcan como usados los otros tokens de reset vivos de esa cuenta.

Esto no es prolijidad. Alguien resetea porque cree que le entraron; si la sesión del intruso sobrevive, el reset fue decorativo. Y si queda un token viejo vivo, alcanza para repetir la jugada.

### D4 — Una contraseña inválida NO consume el token

Si el usuario tipea una contraseña de 6 caracteres, la validación falla **antes** de marcar el token como usado. Consumirlo lo obligaría a pedir otro correo por un error de tipeo, que es la clase de fricción que hace que la gente abandone justo cuando ya está frustrada.

Es la misma decisión que D-42 tomó para las invitaciones, por la misma razón.

### D5 — Límite de tokens pendientes por cuenta, no solo por IP

El rate limiting existente es por IP (D-C03-7) y no frena a alguien que rote direcciones para llenarle la casilla a otra persona. Se agrega un tope de tokens **pendientes** por cuenta: al superarlo, el pedido nuevo invalida el más viejo en vez de acumularlo.

No elimina el bombardeo —el correo se manda igual— pero acota la cantidad de tokens vivos a la vez, que es el daño que sí depende de nosotros.

### D6 — La abstracción de correo, con implementación de consola por defecto

`EmailSender` con `enviar(destinatario, asunto, cuerpo)`. Implementaciones: `ConsoleEmailSender` (escribe en el log) y el hueco para una SMTP/API real. Se elige con `EMAIL_PROVIDER`, igual que `VISION_PROVIDER`.

El default es consola **a propósito**: un default que intente enviar de verdad falla ruidoso en cualquier entorno sin credenciales, y peor, podría mandar correos desde una máquina de desarrollo.

En tests se inyecta un doble que acumula los envíos en memoria, de modo que se puede afirmar **qué** se mandó y **a quién** sin red de por medio.

### D7 — El reset no inicia sesión

Tras cambiar la contraseña, el usuario va al login. Autologuear ahorraría un paso y convertiría el enlace del correo en una sesión directa: quien intercepte el mail entra sin escribir nada. Como además acabamos de revocar todo, iniciar sesión ahí sería contradictorio.

## Risks / Trade-offs

**[Enumeración por tiempo]** → Mitigado por D2. Lo que **no** cubre: si el proveedor de correo real es lento y sincrónico, la rama que envía va a tardar más igual. Cuando se conecte un proveedor real hay que revisarlo; queda anotado.

**[Bombardeo de casilla]** → Acotado por D5 y por el rate limit por IP, no eliminado. Un atacante decidido con muchas IPs puede seguir generando correos. La defensa completa exige rate limiting por email con memoria compartida, que hoy no hay (el store es en memoria y por proceso).

**[El correo es un canal inseguro]** → Vida de una hora, un solo uso, y sin autologin. No se puede hacer mucho más sin agregar un segundo factor.

**[El enlace queda en el historial del navegador]** → El token va en el query string, así que sobrevive en el historial aunque ya no sirva. Aceptado: es de un solo uso y expira en una hora. La alternativa (POST con el token en el cuerpo desde un formulario) complicaría el flujo del correo sin ganar mucho.

**[`token_reset` crece sin límite]** → Los tokens usados y vencidos quedan en la tabla. Con el volumen de este proyecto es irrelevante por años; una limpieza periódica queda anotada como deuda, no como trabajo de este change.

## Migration Plan

Revisión Alembic `0009` (número reservado desde C-32, D-46): crea `token_reset` con índice único en `token_hash` e índice por `usuario_id`. Tabla nueva, sin backfill, sin tocar nada existente. `downgrade` la elimina.

## Open Questions

- ¿Conviene avisarle al usuario por correo **después** de un reset exitoso ("tu contraseña cambió")? Es la señal que le permite reaccionar si el reset no lo pidió él. Cuesta poco, pero suma un segundo envío y este change ya trae la infraestructura de cero. Anotado para cuando haya proveedor real.
- ¿Limpieza periódica de tokens usados y vencidos? Innecesario al volumen actual.
