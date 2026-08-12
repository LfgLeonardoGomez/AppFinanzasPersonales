# 07 · Flujos Principales

> Fuente: `docs/01-mvp-especificacion-funcional.md`, `docs/03-arquitectura-tecnica.md`.

## Flujo 1: Registro y login

```
1. Visitante → Registro (email, nombre, contraseña)
2. Backend: valida email único, hashea contraseña (argon2id), crea Usuario
3. Visitante → Login (email + contraseña)
4. Backend: verifica credenciales
   - OK   → setea cookie httpOnly (access + refresh según "Recordarme")
   - Fail → mensaje genérico "credenciales inválidas"
5. Usuario autenticado opera sobre sus datos
6. Logout → invalida sesión
```

## Flujo 2: Carga manual de factura

```
1. Usuario → "Cargar factura"
2. Elige/crea proveedor (flujo de vinculación, RN-VINC)
3. Completa: fecha_emision (no futura), monto_total (>0), [numero, fecha_venc, items, archivo]
4. (opcional) sube archivo → Cloudinary (preset firmado) → archivo_url
5. Confirmar → backend valida (Pydantic), origen=MANUAL, persiste
6. El saldo y estados del proveedor quedan recalculados on-demand en la próxima consulta
```

## Flujo 3: Carga manual de pago

```
1. Usuario → "Cargar pago"
2. Elige/crea proveedor (RN-VINC) — NUNCA se asocia a una factura
3. Completa: monto (>0), fecha (no futura, informativa), metodo
4. (opcional) sube comprobante → Cloudinary → comprobante_url
5. Confirmar → origen=MANUAL, persiste
6. Recalcula saldo y reasigna pool FIFO del proveedor
```

## Flujo 4: Carga asistida por IA (factura o pago) — ✅ implementado (c-14 backend + c-15 frontend)

```
1. Usuario en FacturaFormPage / PagoFormPage (modo crear) → click "Cargar con imagen (IA)"
2. Se abre PropuestaIAModal (bloqueante, RN-IA-08, D-19):
   - estado idle: ImagePicker (drag-and-drop, JPEG/PNG/WebP, ≤ 10 MB cliente)
3. Usuario selecciona imagen → mutation useExtraerFacturaIA / useExtraerPagoIA
   → POST /api/facturas/extraer-ia | /api/pagos/extraer-ia (multipart)
4. Backend (rate limit 10/hora/usuario, RN-IA-07):
   - 422 → modal muestra error_422, sin retry
   - 429 + Retry-After → modal muestra countdown, sin auto-retry
   - 200 + error:true → error_extractor, "Cargar manualmente" / "Reintentar"
   - 200 con propuesta → estado proposal del modal
5. En estado proposal:
   - campos no leídos se renderizan vacíos (RN-IA-03)
   - SupplierSearch arranca SIN proveedor seleccionado (RN-IA-06);
     el nombre detectado va como query inicial
   - usuario confirma proveedor, edita campos, click "Confirmar" del MODAL
6. Confirmar del modal solo setea form state (NO dispara POST de persistencia, RN-IA-04)
7. El modal se cierra; el form queda prellenado. Usuario revisa y click "Confirmar" del FORM
8. POST /api/facturas | /api/pagos con origen='IA' en el body (D-18, Path B)
9. El service persiste datos.origen or MANUAL → fila con origen=IA
10. Cache de cuenta-corriente se invalida (c-09/c-11 hooks ya lo hacían)
```

## Flujo 5: Consulta de cuenta corriente de un proveedor

```
1. Usuario abre un proveedor
2. Backend calcula on-demand:
   - Saldo (RN-SALDO): SUM(facturas activas) − SUM(pagos activos)
   - Estado de cada factura (RN-FIFO): asignación virtual del pool, vieja → nueva
   - Historial cronológico (RN-HIST): debe/haber con saldo acumulado
3. Frontend muestra saldo (con signo: deuda / al día / a favor), lista de facturas con estado, e historial
```

## Flujo 6: Listado de proveedores ordenado por saldo

```
1. Usuario → "Ver proveedores"
2. Backend: query agregada GROUP BY proveedor (un solo query, no uno por fila)
   calcula el saldo de cada proveedor
3. Frontend: listado paginado, ordenable por nombre o saldo
```

## Flujo 7: Rotación de refresh token (C-03)

```
1. Access token expira (TTL corto, default sugerido 30 min)
2. Cliente (Axios interceptor C-04) hace POST /api/auth/refresh con la cookie de refresh
3. Backend (RN-AUTH-04):
   - lee refresh cookie → busca fila refresh_token por token_hash
   - verifica: revoked_at IS NULL AND expires_at > now() (RN-AUTH-03)
   - marca la fila usada como revoked (revoked_at = now())
   - emite nuevo access (JWT) + nuevo refresh (opaco)
   - persiste fila nueva con token_hash = sha256(refresh_nuevo)
4. Set-Cookie: access + refresh (HttpOnly, Secure, SameSite=Lax)
5. Cliente reintenta el request original con el nuevo access
```

> **Caso de fallo:** si el refresh está revocado o expirado → 401. El cliente limpia cookies y redirige a login. Si el refresh es **inválido a la primera** (no existe, no es nuestro), el backend responde 401 sin revelar por qué.

## Flujo 8: Falla del extractor IA — manejo en modal (RN-IA-05)

```
1. Usuario sube imagen al modal
2. POST /api/facturas/extraer-ia → 200 con error:true, error_message:"<razón>"
3. Modal transiciona a estado error_extractor:
   - Muestra "No se pudo leer la imagen. La IA no pudo extraer los datos. Podés cargar manualmente."
   - Botón "Cargar manualmente" → cierra el modal, deja el form vacío (RN-IA-05)
   - Botón "Reintentar con otra foto" → vuelve a estado idle
4. La falla NO persiste nada (RN-IA-04: el modal nunca llama a POST /api/facturas)
5. El listener before_flush en el backend asegura 0 INSERT/UPDATE/DELETE en la request IA,
   incluso si el extractor devolvió error:true
```

## Flujo cross-origin de autenticación (despliegue)

```
Front (Vercel) y back (VPS Oracle) en dominios distintos → cookie de terceros
→ Safari/iOS la bloquea por defecto.

Recomendado:  rewrite/proxy en el frontend (/api/* → backend)
              → navegador ve mismo origen → cookie de primera parte, sin CORS
Fallback:     SameSite=None; Secure; HttpOnly + CORS con origen explícito
              + credentials:true (nunca wildcard con credenciales) + HTTPS en ambos
```

## Flujo 8: Alta de empleado por invitación *(C-29 backend + C-30 frontend)*

1. El **admin** entra a `/equipo` y toca "Invitar". El backend genera un código de 8 caracteres, persiste solo su hash y lo devuelve **una única vez**.
2. La app lo muestra en un diálogo que **no se cierra ni con backdrop ni con Escape**, con botón de copiar y el aviso de que no se puede recuperar. Si se pierde, se genera otro: es gratis.
3. El admin le pasa el código al empleado **fuera del sistema** (WhatsApp, en persona). El sistema no manda mails hasta C-31.
4. El **empleado** entra a `/registro`, elige "Sumarme a uno", completa sus datos y el código, y **elige su propia contraseña**. El admin nunca toca credenciales ajenas.
5. El backend valida el código (`usado_en IS NULL AND expira_en > now()`), crea el `Usuario` con el `negocio_id` de la invitación y `es_admin = false`, y marca la invitación como usada — todo en una transacción.
6. Si el código es inexistente, vencido o ya usado, la respuesta es **la misma en los tres casos** (D-41): es un endpoint público y distinguirlos permitiría sondear qué negocios existen.
7. Si el alta falla por email duplicado, **la invitación NO se consume** (D-42): un typo no obliga al admin a generar otra.

**Baja de un miembro:** el admin toca "Quitar acceso" y confirma. El backend setea `desactivado` y revoca los refresh tokens activos: pierde el acceso en su request siguiente y tampoco puede renovar. **Sus facturas y pagos siguen visibles** para el resto del equipo, atribuidos a él. Si sería el último admin activo, se rechaza con **409** y un mensaje que explica por qué (RN-NEG-08).
