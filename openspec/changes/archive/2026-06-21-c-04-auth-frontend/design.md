## Context

C-03 (`auth-backend`, archivada) dejó el contrato HTTP que este frontend consume (ver `openspec/specs/auth-backend/spec.md`):

- **Dos cookies** seteadas por el backend en login/refresh: `access_token` (JWT, TTL 30 min) y `refresh_token` (opaco, TTL 30 días), ambas `HttpOnly; Secure; SameSite=Lax`. La cookie de refresh está **scopeada por `Path` a `/api/auth/refresh`** (D-C03-3) para minimizar su exposición.
- **El frontend NUNCA ve los tokens desde JS** (son `HttpOnly`). El navegador los adjunta solo. Esto es un invariante de seguridad, no un detalle.
- Endpoints: `POST /api/auth/registro` (email/nombre/password ≥ 8; 422 si inválido; error de email-en-uso si duplicado), `POST /api/auth/login` (setea cookies; **error genérico** ante credenciales inválidas, sin revelar si falló email o password), `POST /api/auth/logout` (revoca refresh + borra cookies), `POST /api/auth/refresh` (rota el par de tokens), `GET /api/me` (perfil del usuario sin `password_hash`; **401** sin sesión válida).
- **Despliegue (D-C03-3)**: estrategia primaria = rewrite/proxy del frontend (`/api/*` → backend) → mismo origen aparente → cookie de **primera parte** `SameSite=Lax`, sin CORS en el camino primario. El `vite.config.ts` de C-01 **ya** implementa este proxy en dev (`/api → http://localhost:8000`).

El frontend (`facturas-proveedores-web`) está scaffoldeado (C-01) con React 18 + TS estricto + Vite + TanStack Query + Zustand + Axios + Tailwind v4 + `vite-plugin-pwa` + MSW. Estructura feature-based (`src/features/`, `src/shared/`, `src/app/`). Governance **CRÍTICO**: este es el límite de confianza del lado cliente.

## Goals / Non-Goals

**Goals:**

- Login y registro funcionales que consumen el contrato C-03 sin debilitarlo.
- Sesión basada **exclusivamente en la cookie `HttpOnly`** — cero tokens en `localStorage`/`sessionStorage`/memoria JS.
- Guard `RequireAuth` que protege el árbol de rutas privadas.
- Cliente Axios con `withCredentials: true` e interceptor que maneje 401 con un **refresh silencioso único** antes de redirigir.
- Bootstrap de sesión al cargar la app vía `GET /api/me`, sin parpadeo público→privado.
- Estado de UI (`user`, `isAuthenticated`) en Zustand, derivado del backend — nunca la fuente de verdad de la autenticación.
- Tests con MSW para los cinco caminos (registro OK/duplicado, login OK/inválido, redirect 401).

**Non-Goals:**

- Cualquier cambio en el backend (este change solo consume HTTP).
- Perfil editable, avatar, tema (C-05); recuperación de password (fuera del MVP).
- Refresh proactivo en background por timer (innecesario: el interceptor reactivo cubre el caso; ver D-C04-3).
- Persistencia de sesión en storage del cliente más allá de lo que el navegador hace con la cookie.

---

## Decisions (CRÍTICO — requieren aprobación humana antes de `apply`)

### D-C04-1: El token vive SOLO en la cookie `HttpOnly`; Zustand guarda únicamente estado de UI

`authStore` (Zustand) tiene **solo** `user: Usuario | null` e `isAuthenticated: boolean` (derivado: `user !== null`). **NO** guarda `access_token` ni `refresh_token` — son `HttpOnly`, JS no puede ni debe leerlos. Axios manda la cookie automáticamente con `withCredentials: true`.

- **Por qué**: el backend eligió `HttpOnly` precisamente para que un XSS no pueda exfiltrar el token. Si el frontend copiara el token a `localStorage` o a una variable JS, anularía esa protección. Regla dura del proyecto: *cookie httpOnly (never localStorage for tokens)*.
- **Trade-off aceptado**: el frontend no puede inspeccionar `exp` del access token para refrescar proactivamente. Lo asumimos: el refresh es **reactivo** ante un 401 (D-C04-3). Es la consecuencia directa de no leer el token, y es la correcta.
- **Implicación**: `isAuthenticated` es una señal de UI optimista. La autoridad real es la cookie + el backend; un `isAuthenticated=true` con cookie expirada se corrige solo en la primera request protegida (401 → refresh → o redirect).
- **`zustand/persist`**: si se usa, persistir **solo** un flag liviano (p. ej. `wasAuthenticated`) para decidir si vale la pena intentar `GET /api/me` al arrancar — **nunca** datos de sesión sensibles. Alternativa más simple y preferida: no persistir nada y siempre hacer el bootstrap `GET /api/me` (D-C04-4).

### D-C04-2: Cookie access/refresh consumida transparentemente por Axios (`withCredentials: true`)

Una sola instancia Axios en `src/shared/api/client.ts` con `baseURL: '/api'` y `withCredentials: true`. El split access/refresh del backend es **invisible** para el frontend: el navegador adjunta `access_token` en toda request a `/api/*` (porque la cookie tiene `Path=/`), y adjunta `refresh_token` **solo** cuando la URL matchea su `Path=/api/auth/refresh`. El frontend no orquesta nada de eso — solo llama al endpoint correcto.

- **Por qué**: el `Path`-scoping del refresh (D-C03-3) hace que la cookie de refresh viaje únicamente al endpoint que la necesita. El frontend lo "consume" simplemente haciendo `POST /api/auth/refresh` a esa URL; el navegador se encarga del resto. No hay que leer, almacenar ni reenviar tokens manualmente.
- **`baseURL: '/api'`**: en dev, el proxy de Vite (C-01) reescribe `/api → :8000`. En prod, el rewrite de Vercel (D-C03-3) hace lo mismo → mismo origen → cookie de primera parte `SameSite=Lax`, sin preflight CORS. **Decisión de despliegue heredada de C-03, no se re-decide acá.**
- **Fallback cross-origin** (orígenes separados, `SameSite=None; Secure`): documentado en C-03 como fallback. Si se activara, el frontend **no cambia** (`withCredentials` ya cubre el caso); solo cambia config de servidor/CORS. Lo registramos como supuesto, no se implementa acá.

### D-C04-3: Interceptor 401 → refresh silencioso ÚNICO → redirect (con cola anti-tormenta)

El interceptor de **respuesta** de Axios captura `401`. Lógica:

1. Si la request fallida **es** `/api/auth/refresh` o `/api/auth/login` → no reintentar; propagar el error (evita loop infinito).
2. Si ya se reintentó esta request (`config._retry === true`) → no reintentar; disparar logout local + redirect a `/login`.
3. Caso normal: marcar `_retry`, intentar **una vez** `POST /api/auth/refresh`.
   - Refresh **OK** (200, backend rotó y reseteó cookies) → reintentar la request original una vez.
   - Refresh **falla** (401: refresh expirado/revocado) → limpiar `authStore` (`logout()` local, sin llamar al endpoint) + redirect a `/login`.
4. **Cola de concurrencia**: si llegan varios 401 simultáneos (varias queries en paralelo), un **único** refresh in-flight; las demás requests esperan su resolución y reintentan/abortan según el resultado. Evita N refreshes paralelos que rotarían el token N veces y se invalidarían entre sí (el backend rota en cada refresh, D-C03-1).

- **Por qué silencioso y único**: el access expira a los 30 min; sin refresh transparente, el usuario sería expulsado a login en medio de una sesión activa de 30 días. Un único refresh evita la "tormenta de refresh" que la rotación del backend volvería destructiva.
- **Trade-off**: el primer request tras expirar el access paga un round-trip extra (refresh + reintento). Aceptable y poco frecuente (cada 30 min como máximo).
- **Redirect desde un interceptor (fuera de React)**: el interceptor no tiene acceso al `useNavigate` de React Router. **Decisión**: exponer un navegador imperativo — o bien `window.location.assign('/login')` (simple, recarga la app y re-bootstrappea limpio), o bien un router con `createBrowserRouter` cuyo objeto `router.navigate` se importe en el cliente. **Preferencia: `createBrowserRouter` + `router.navigate('/login')`** para no perder el estado de la SPA; `window.location` queda como fallback si complica el setup. *(Supuesto a confirmar — ver Riesgos.)*

### D-C04-4: Bootstrap de sesión vía `GET /api/me` al cargar la app (sin parpadeo)

Al montar la app, antes de decidir qué ruta renderizar, se dispara `GET /api/me`:

- **200** → hay sesión válida (la cookie viajó y el backend la aceptó); se puebla `authStore.user` → `isAuthenticated = true`.
- **401** → no hay sesión; `authStore` queda vacío; las rutas privadas redirigen a `/login`.

Mientras la query está `pending`, `RequireAuth` (y el router) muestran un estado **"verificando sesión"** (spinner/placeholder), **no** la pantalla pública ni la privada. Esto evita el parpadeo "se ve el login por un frame y después entra al home" (o viceversa).

- **Por qué `GET /api/me` y no leer una cookie/flag**: el token es `HttpOnly` (D-C04-1) → JS no puede saber si hay sesión sin preguntarle al backend. `GET /api/me` es la única fuente de verdad de "¿estoy logueado?".
- **Implementación**: `useQuery(['me'], fetchMe, { retry: false, staleTime: ... })` a nivel app. Un `useAuthBootstrap()` que sincroniza el resultado al `authStore`. El interceptor 401 (D-C04-3) **no** debe disparar redirect para la query de bootstrap (un 401 acá es esperado = no logueado, no un error de sesión caída); se distingue por flag en la config de esa request (p. ej. `skipAuthRedirect: true`).
- **Trade-off**: un round-trip extra en cada carga de la app. Es barato y necesario; cachear el resultado en TanStack Query lo amortigua durante la sesión.

### D-C04-5: "Recordarme" — semántica delegada al backend

El checkbox "Recordarme" del login se manda como parte del payload de `POST /api/auth/login`. La **diferencia de duración de sesión la decide el backend** (F-AUTH-03: activado → refresh persistente ~30 días; desactivado → cookie de sesión que muere al cerrar el navegador + access corto). El frontend **no** maneja TTLs de cookie — son `HttpOnly`, no las puede tocar.

- **Por qué**: coherente con D-C04-1 — el frontend no administra cookies de sesión. Solo transmite la intención del usuario; el backend setea `Max-Age`/`Expires` en consecuencia.
- **Supuesto**: el endpoint `POST /api/auth/login` de C-03 acepta el flag "recordarme" en el body. *(A verificar contra el schema OpenAPI generado — ver Riesgos. Si C-03 no lo expone, queda como gap a resolver: o se agrega al backend, o "Recordarme" no altera la duración en el MVP.)*

### D-C04-6: PWA — login en el shell offline, pero el login requiere red

La página de login forma parte del **app shell** cacheado por el service worker (`vite-plugin-pwa`, C-01 cachea `**/*.{js,css,html,...}`) → la pantalla de login es **visible offline**. Pero la **acción** de login (`POST /api/auth/login`) requiere red: offline, el formulario se renderiza y muestra un error claro de "sin conexión" al enviar.

- **Por qué**: requisito de scope ("login page visible offline"). No implica login offline real (imposible sin red ni almacenar credenciales — prohibido).
- **Decisión**: no cachear respuestas de `/api/auth/*` ni `/api/me` (son sensibles y dinámicas). El `runtimeCaching` de C-01 está vacío; se mantiene así para auth. Los datos de negocio definirán sus estrategias en changes posteriores.

### D-C04-7: Validación de formularios — cliente por UX, backend como autoridad

Validación en cliente (email con formato, password ≥ 8) **solo para feedback inmediato**; la autoridad es Pydantic en el backend (regla dura #6: *never trust frontend-only validation*). El form muestra el error de cliente antes de enviar, pero también renderiza correctamente los errores del backend (422 de registro, email-en-uso, credenciales inválidas).

- **Decisión de librería de forms**: el scope no fija una. **Preferencia: estado controlado nativo de React + helpers de validación mínimos**, sin agregar `react-hook-form`/`zod` salvo que el revisor lo pida (mantener bundle chico — `bundle-*` del skill Vercel). *(Supuesto: sin dep nueva de forms. A confirmar.)*

---

## Risks / Trade-offs

- **[Supuesto] "Recordarme" en el contrato C-03 (D-C04-5)**: depende de que `POST /api/auth/login` acepte el flag en el body. **Mitigación**: verificar contra `src/shared/api/api.d.ts` (OpenAPI generado) en la primera tarea de apply; si no existe, escalar — no inventar el campo. CRÍTICO para no asumir contrato.
- **[Supuesto] Redirect imperativo desde interceptor (D-C04-3)**: `createBrowserRouter` + `router.navigate` vs `window.location`. **Mitigación**: decidir en apply con el patrón más simple que no rompa la SPA; ambos son seguros. Bajo riesgo.
- **[Supuesto] Sin librería de forms (D-C04-7)**: si la validación nativa se vuelve verbosa, podría justificarse `react-hook-form`. **Mitigación**: empezar nativo; el revisor decide si el costo de bundle vale.
- **Tormenta de refresh / rotación (D-C04-3)**: la cola de un único refresh in-flight es **obligatoria** dada la rotación del backend (cada refresh invalida el anterior). Si se implementa mal, sesiones legítimas se romperían con N requests paralelas. **Mitigación**: test explícito de concurrencia (varias queries → un solo refresh).
- **Parpadeo de bootstrap (D-C04-4)**: si el estado "verificando" no se maneja, el usuario ve un flash público↔privado. **Mitigación**: `RequireAuth` y el router gatean el render hasta que `['me']` resuelve.
- **Cookie de primera parte vs Safari/iOS**: cubierto por la estrategia de proxy heredada de C-03 (mismo origen). Si se cayera al fallback cross-origin, Safari podría bloquear cookies de terceros — pero eso es decisión/riesgo de C-03, no de este change.

## Migration Plan

No hay migración de datos (es frontend nuevo). Orden de implementación seguro:

1. Cliente Axios + interceptor (`src/shared/api/client.ts`) y tipos OpenAPI → base para todo lo demás.
2. `authStore` (Zustand) y hooks de query/mutation (`useRegister`/`useLogin`/`useLogout`/`useMe`).
3. Páginas `LoginPage` / `RegisterPage` + validación de forms.
4. `RequireAuth` + `router.tsx` + bootstrap de sesión en `App.tsx`/`main.tsx`.
5. PWA: confirmar login en shell offline.
6. Tests MSW de los cinco caminos.

Cada paso es verificable de forma aislada con MSW; no requiere el backend corriendo.

## Open Questions

1. ¿`POST /api/auth/login` de C-03 acepta el flag "Recordarme" en el body? (D-C04-5 — verificar OpenAPI; bloqueante para esa semántica).
2. ¿Redirect del interceptor con `router.navigate` (preferido) o `window.location.assign`? (D-C04-3 — decisión menor de implementación).
3. ¿Se agrega `react-hook-form`/`zod` o validación nativa? (D-C04-7 — preferencia: nativa; el revisor decide).
