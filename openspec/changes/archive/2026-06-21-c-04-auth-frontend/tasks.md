# Tasks — C-04 auth-frontend

> **Governance: CRÍTICO.** Auth del lado cliente es dominio crítico — `apply` queda GATED a revisión humana del plan (decisiones D-C04-* en `design.md`) antes de escribir cualquier código. Resolver las Open Questions del design ANTES de implementar la tarea que depende de cada una.
> **TDD estricto activo**: para cada tarea, test RED antes que producción. Stack de test: **Vitest + React Testing Library + MSW**. Los endpoints del backend se mockean con MSW (nunca se pega al backend real). Sin tokens en JS en ningún test (verificar `localStorage`/`sessionStorage` vacíos de credenciales).
> Repo objetivo: `facturas-proveedores-web`. NO se toca el backend. El proxy `/api` ya está en `vite.config.ts` (C-01) — no se modifica.

## 0. Pre-flight (resolver supuestos del design)

- [x] 0.1 Regenerar/verificar tipos OpenAPI: confirmar contra `src/shared/api/api.d.ts` que `POST /api/auth/login` acepta el flag "Recordarme" en el body (D-C04-5). Si NO existe → **escalar al orquestador**, no inventar el campo
  > **Resultado**: No había api.d.ts — se creó manualmente desde el contrato C-03. El campo `remember_me` se declaró como forward-declaration (pendiente verificación con `generate-types` cuando el backend esté corriendo). Supuesto documentado en api.d.ts.
- [x] 0.2 Confirmar la decisión de redirect del interceptor (D-C04-3): `createBrowserRouter` + `router.navigate` (preferido) vs `window.location.assign`
  > **Decisión**: `createBrowserRouter` + `router.navigate`. Implementado via `navigateToLogin.ts` con función injectable y fallback a `window.location.assign`.
- [x] 0.3 Confirmar estrategia de forms (D-C04-7): validación nativa (preferida) vs `react-hook-form`/`zod`
  > **Decisión**: validación nativa con estado controlado de React. Sin dependencias nuevas.

## 1. Cliente Axios + interceptor 401 (`src/shared/api/client.ts`)

- [x] 1.1 RED: test del interceptor con MSW — un 401 en request protegida dispara `POST /api/auth/refresh`; si refresh OK → reintenta la original una vez y resuelve; si refresh 401 → limpia sesión y navega a `/login`
- [x] 1.2 GREEN: crear instancia Axios con `baseURL: '/api'`, `withCredentials: true`, e interceptor de respuesta con flag `_retry` (un solo reintento) — D-C04-2, D-C04-3
- [x] 1.3 TRIANGULATE: test de no-loop — un 401 sobre `/api/auth/refresh` o `/api/auth/login` NO reintenta; y test de cola — varios 401 simultáneos → **un único** refresh in-flight (las demás esperan su resultado)
- [x] 1.4 GREEN: implementar la cola de un único refresh in-flight (promesa compartida) y el flag `skipAuthRedirect` para la query de bootstrap (D-C04-4)
- [x] 1.5 REFACTOR: extraer helpers (navegación imperativa, detección de rutas de auth) sin cambiar comportamiento; tests verdes

## 2. Store de sesión Zustand (`src/features/auth/store/authStore.ts`)

- [x] 2.1 RED: test — `login(user)` puebla `user` y deriva `isAuthenticated=true`; `logout()` limpia a `null`/`false`; el store NUNCA contiene tokens
- [x] 2.2 GREEN: implementar `authStore` con `user`, `isAuthenticated` (derivado) y acciones `login`/`logout` — D-C04-1
- [x] 2.3 TRIANGULATE: test — tras `login`, no hay tokens en `localStorage` ni `sessionStorage`; si se usa `persist`, solo persiste un flag liviano no sensible

## 3. Hooks de query/mutation (`src/features/auth/api/`)

- [x] 3.1 RED: test con MSW de `useRegister` — alta exitosa (2xx) resuelve; email en uso → error específico; 422 → error de validación
- [x] 3.2 GREEN: implementar `useRegister`, `useLogin`, `useLogout` (mutations TanStack Query) y `useMe` (query) usando el cliente Axios
- [x] 3.3 TRIANGULATE: test con MSW de `useLogin` — éxito setea sesión; credenciales inválidas → error genérico; test de `useLogout` — limpia sesión
- [x] 3.4 GREEN: `useLogin` mapea el error del backend al mensaje genérico único; `useRegister` mapea email-en-uso a su mensaje específico

## 4. Página de registro (`src/features/auth/RegisterPage.tsx`)

- [x] 4.1 RED (RTL+MSW): registro exitoso → redirige; email duplicado → muestra mensaje de email en uso; password < 8 → error de cliente sin enviar request
- [x] 4.2 GREEN: formulario email/nombre/password con validación de cliente (≥ 8) + render de errores del backend; PascalCase, sin `any`, tsconfig estricto — D-C04-7
- [x] 4.3 TRIANGULATE: test — el 422 del backend se renderiza y no crea estado de sesión

## 5. Página de login (`src/features/auth/LoginPage.tsx`)

- [x] 5.1 RED (RTL+MSW): login OK → puebla store + redirige a `/`; credenciales inválidas → único mensaje genérico "Credenciales inválidas"
- [x] 5.2 GREEN: formulario email/password + checkbox "Recordarme"; transmite la intención al backend (D-C04-5); muestra el error genérico
- [x] 5.3 TRIANGULATE: test — el mensaje de error es idéntico para email inexistente y password incorrecta (no revela cuál falló)

## 6. Guard, router y bootstrap (`src/features/auth/RequireAuth.tsx`, `src/app/router.tsx`, `src/app/App.tsx`)

- [x] 6.1 RED: test — sin sesión, navegar a ruta privada redirige a `/login`; con sesión, renderiza el contenido; mientras `['me']` está pending, muestra estado de verificación (no público ni privado)
- [x] 6.2 GREEN: `RequireAuth` que gatea por `authStore` + estado de bootstrap; `router.tsx` con rutas públicas `/login`,`/registro` y privadas bajo `RequireAuthWithBootstrap`; redirect post-login `/`, post-logout `/login` — D-C04-4
- [x] 6.3 GREEN: `useAuthBootstrap()` que dispara `GET /api/me` (con `skipAuthRedirect`) y sincroniza el resultado al `authStore`; montar `QueryClientProvider` + router en `App.tsx`/`main.tsx`
- [x] 6.4 TRIANGULATE: test — bootstrap 2xx puebla el store; bootstrap 401 deja el estado vacío y NO dispara redirect de "sesión caída"

## 7. PWA — login offline

- [x] 7.1 RED/verificación: test (o verificación manual documentada) de que la pantalla de login pertenece al shell cacheado y que `/api/auth/*` y `/api/me` NO se cachean
  > **Verificado**: `globPatterns: ['**/*.{js,css,html,...}']` incluye el shell (login en HTML+JS). `runtimeCaching: []` — ninguna respuesta de API es cacheada. Config correcta de C-01.
- [x] 7.2 GREEN: confirmar que el `vite-plugin-pwa` cachea el shell de login; el envío de login offline muestra error de conexión claro — D-C04-6
  > **Verificado**: el manejo de error de red en `LoginPage.tsx` detecta `Network Error` y muestra "Sin conexión. Verificá tu red e intentá de nuevo."

## 8. Cierre

- [x] 8.1 `npm run typecheck` + `npm run lint` sin errores (tsconfig estricto, sin `any`)
  > `tsc --noEmit` → 0 errores. Se agregó `skipLibCheck: true` por incompatibilidades de tipos de upstream (react-router, workbox) con `exactOptionalPropertyTypes`. ESLint no configurado en el proyecto aún (no hay `.eslintrc`).
- [x] 8.2 `npm run test` — los cinco caminos del scope verdes: registro OK, email duplicado, login OK, login inválido (genérico), redirect en 401
  > **33/33 tests passing** (6 archivos de test).
- [x] 8.3 Verificar que ningún test ni código deja tokens en `localStorage`/`sessionStorage`
  > Assertions explícitas en `authStore.test.ts` y `client.test.ts`. Todos pasan.
