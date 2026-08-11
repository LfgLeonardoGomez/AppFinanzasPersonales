## Context

C-28 dejó `es_admin` y `desactivado` en `Usuario`, con `get_current_user` rechazando a los desactivados. Los campos funcionan; lo que falta es la superficie para operarlos.

El patrón de auth ya existente que este change reusa:
- `RefreshToken` persiste **solo el hash** del valor opaco (D-17). La invitación aplica el mismo criterio, con la misma justificación: una filtración de la base no debe entregar códigos usables.
- `rate_limit` en `deps.py` es una ventana deslizante en memoria por IP (5/60s), usada hoy en registro y login.
- `get_current_user` hidrata el `Usuario` completo, así que `es_admin` está disponible sin consulta extra.

**Restricción de producto (decisión del usuario, 2026-08-09):** no hay promoción de admin en este change.

## Goals / Non-Goals

**Goals:**
- Que un admin pueda sumar y dar de baja gente sin tocar la base.
- Que el empleado elija su propia contraseña, para no arrastrar un flujo de "cambiar en el primer login" que hoy no existe.
- Que un negocio no pueda quedarse sin administración por accidente.
- Que el endpoint público de alta no sirva para sondear qué negocios existen.

**Non-Goals:**
- Promover o degradar admins; transferir la propiedad del negocio.
- Frontend (C-30).
- Invitar por email desde el sistema: el admin pasa el código por su propio canal. Mandar mails llega con C-31, que trae la infraestructura de correo.

## Decisions

### D1 — Una dependency `require_admin`, no un chequeo por endpoint

Se agrega `require_admin` en `deps.py`, construida sobre `get_current_user`, que levanta si `es_admin` es falso. Los cuatro endpoints de equipo la declaran.

**Alternativa considerada**: chequear `current_user.es_admin` dentro de cada handler. Se descarta porque el privilegio quedaría repetido en cuatro lugares y un endpoint nuevo podría olvidarlo en silencio. Como dependency, omitirla es visible en la firma.

### D2 — El código: 8 caracteres, alfabeto sin ambigüedades, 48 horas

El código viaja por WhatsApp o se dicta en persona, así que se excluyen los caracteres que se confunden al leer (`0/O`, `1/I/L`). Alfabeto de 32 símbolos, 8 posiciones ≈ 40 bits de entropía — suficiente dado que además hay un solo uso, vencimiento corto y rate limiting; no es un secreto de larga vida.

Se genera con `secrets.choice` (no `random`), y se persiste `sha256(codigo)` reutilizando el mismo helper que los refresh tokens.

**Alternativa considerada**: un UUID. Se descarta por hostil de dictar: 36 caracteres para algo que el admin le pasa a un empleado parado al lado.

### D3 — El error de código inválido es uno solo

Código inexistente, vencido y ya usado devuelven exactamente la misma respuesta. Distinguirlos convertiría el endpoint público en un oráculo para descubrir negocios y probar códigos.

La contrapartida es real: un empleado con un código vencido ve el mismo mensaje que con uno mal tipeado. Se acepta — el admin le genera otro en cinco segundos, y el costo de la alternativa es estructural.

### D4 — La transacción del alta cubre usuario e invitación

Crear el `Usuario` y marcar `usado_en` van en la misma transacción. Si el alta falla por email duplicado, la invitación **no** se consume: el empleado corrige el email y reusa el código. Consumirla en un fallo obligaría al admin a generar otra por un typo.

### D5 — Desactivar revoca los refresh tokens, aunque el acceso ya muera antes

`get_current_user` ya rechaza al desactivado en su request siguiente (C-28), así que el access token deja de servir de inmediato. La revocación del refresh cubre lo otro: impedir que renueve la sesión. Se agrega `revoke_all_for_usuario(usuario_id)` a `RefreshTokenRepository`.

Son dos capas para dos ventanas distintas, y hace falta que estén las dos.

### D6 — La guarda de último admin se evalúa en el service, contando activos

Antes de setear `desactivado = true`, el service cuenta cuántos `es_admin = true AND desactivado = false` quedarían. Si el resultado es cero, rechaza con un error explícito — **no** con 404, que ahí sería mentira: el recurso existe y el solicitante tiene permiso; lo que falla es una regla de negocio.

**Alternativa considerada**: un constraint en la base. Se descarta porque expresar "al menos una fila cumple X por negocio" requiere un trigger, y un trigger no puede devolver un mensaje que el usuario entienda.

### D7 — Sin promoción de admin (decisión del usuario)

No se expone ninguna ruta que otorgue `es_admin`. Es la decisión que mantiene C-29 chico.

**Lo que hay que tener presente**: convierte a **C-31 (recuperación de contraseña) en dependencia práctica**. Con un solo admin posible y sin reset por email, un fundador que olvida su clave deja al negocio sin administración y sin salida por software. Mientras C-31 no exista, ese caso se resuelve a mano sobre la base.

## Risks / Trade-offs

**[Un solo admin = punto único de falla]** → Mitigado parcialmente por RN-NEG-08 (no puede autodesactivarse). La mitigación real es C-31; hasta entonces, riesgo asumido y documentado.

**[El código se filtra en tránsito]** → Un solo uso + 48hs. Si se filtra después de usarse no sirve; si nunca se usa, muere. Lo que no se cubre: alguien que intercepte el código y lo use **antes** que el empleado. Se acepta — el admin ve en `GET /api/equipo` que apareció un miembro que no esperaba, y puede desactivarlo.

**[Rate limiting en memoria y por IP]** → Hereda la limitación de D-C03-7: con varios workers cada uno cuenta por su lado. Aceptable para el despliegue de una instancia; el camino de salida (Redis) no cambia los routers.

**[Enumeración de emails en el alta]** → El endpoint responde distinto ante email duplicado, igual que el registro público de C-03. No se endurece acá para no divergir del comportamiento existente; si se decide cambiar, debe cambiarse en ambas rutas a la vez.

## Migration Plan

Revisión Alembic `0007`: crea `invitacion_empleado` con índice único en `codigo_hash` e índice por `negocio_id`. Tabla nueva, sin backfill ni columnas alteradas — el `downgrade` la elimina y no toca nada más. Riesgo de datos: ninguno.

## Open Questions

Ninguna bloqueante. Para más adelante:

- ¿La invitación debería poder revocarse antes de usarse? Hoy solo vence sola. Un admin que se arrepiente no tiene forma de anularla dentro de las 48hs.
- ¿Conviene registrar quién desactivó a quién? Hoy queda el efecto, no el autor de la acción.
