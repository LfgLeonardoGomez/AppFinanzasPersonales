## Why

C-03 (`auth-backend`, archivada) dejó el portón de entrada del lado servidor: `POST /api/auth/registro`, `/login`, `/logout`, `/refresh`, `GET /api/me`, y la dependency `get_current_user` que provee el `usuario_id` autenticado al resto del backend. Pero hoy **no hay forma de usarlo desde el producto**: el frontend (`facturas-proveedores-web`, scaffoldeado en C-01) no tiene ni login, ni registro, ni guard de rutas, ni cliente HTTP que mande las cookies de sesión. Sin este change, la PWA no puede autenticar a nadie y todo C-05+ (perfil, proveedores, facturas, pagos, cuenta corriente) queda inaccesible: **C-04 es el gate que abre la cara de usuario del sistema**.

Es governance **CRÍTICO**: este es el límite de confianza del lado cliente. Un error acá (token expuesto en JS, redirect mal manejado, bootstrap de sesión inseguro) compromete todas las cuentas. El backend ya garantiza el aislamiento por `usuario_id` y la cookie `HttpOnly`; este change debe **consumir ese contrato sin debilitarlo** — nunca tocar el token desde JS, nunca usar `localStorage` para credenciales, confiar en la cookie de primera parte.

## What Changes

- **`src/features/auth/`** — nueva feature de autenticación:
  - `LoginPage.tsx`: formulario email + password + checkbox "Recordarme". Error genérico único ("Credenciales inválidas") — refleja el contrato del backend que no revela si falló email o password.
  - `RegisterPage.tsx`: formulario email + nombre + password (mín 8 chars, validado en cliente **y** backend). Error específico de email en uso.
  - `RequireAuth.tsx`: guard de rutas privadas; redirige a `/login` si no hay sesión.
- **`src/features/auth/store/authStore.ts`** (Zustand): estado `user` y `isAuthenticated`; acciones `login` / `logout`. **NO guarda tokens** (viven en cookie `HttpOnly`) — solo el estado de UI derivado del usuario.
- **TanStack Query mutations**: `useRegister`, `useLogin`, `useLogout` (en `src/features/auth/api/`).
- **`src/shared/api/client.ts`** (Axios): instancia con `withCredentials: true` (manda/recibe la cookie), `baseURL` `/api` (mismo origen vía proxy/rewrite), e **interceptor de respuesta 401** → intento silencioso de `POST /api/auth/refresh` una vez; si falla → limpia `authStore` y redirige a `/login`.
- **`src/app/router.tsx`**: rutas públicas `/login` y `/registro`; rutas privadas envueltas en `RequireAuth`; redirect post-login al home `/`, post-logout a `/login`.
- **Bootstrap de sesión**: al cargar la app, `GET /api/me` decide si hay sesión válida (cookie presente) → puebla `authStore`. Estado de "verificando" para evitar parpadeo público→privado.
- **PWA**: la página de login queda en el shell cacheado para ser visible offline (login en sí requiere red).
- **Tests** (Vitest + RTL + MSW): registro exitoso, email duplicado, login OK, login inválido (mensaje genérico), redirect en 401.

**Fuera de alcance**: perfil editable / avatar / tema (C-05), recuperación de contraseña por email (fuera del MVP), cualquier feature de negocio (proveedores C-07+). No se modifica el backend: este change solo **consume** el contrato `auth-backend` ya archivado.

## Capabilities

### New Capabilities
- `auth-frontend`: autenticación del lado cliente de la PWA — páginas de login y registro, guard `RequireAuth`, store Zustand de sesión (sin tokens en JS), mutations TanStack Query (`useRegister`/`useLogin`/`useLogout`), cliente Axios con `withCredentials` e interceptor 401→refresh→redirect, ruteo público/privado y bootstrap de sesión vía `GET /api/me`.

### Modified Capabilities
<!-- Ninguna. auth-backend (C-03) está archivada; este change la consume vía HTTP sin alterar sus requisitos. -->

## Impact

- **Repositorio afectado**: `facturas-proveedores-web` (la API queda intacta).
- **Código nuevo**: `src/features/auth/` (páginas, guard, store, hooks/mutations, schemas de form), `src/shared/api/client.ts` (instancia Axios + interceptor), `src/app/router.tsx`, y los tests con MSW.
- **Código modificado**: `src/app/App.tsx` y `src/app/main.tsx` (montar router + `QueryClientProvider` + bootstrap de sesión). El `vite.config.ts` **ya** trae el proxy `/api → :8000` (C-01) — no se toca.
- **Dependencias**: `react-router-dom`, `@tanstack/react-query`, `axios`, `zustand`, `msw` ya están declaradas (C-01). Tipos consumidos desde `src/shared/api/api.d.ts` (generados de OpenAPI vía `npm run generate-types`).
- **Consumidores aguas abajo**: C-05 (perfil) usa `authStore` y `RequireAuth`; C-07+ montan sus rutas dentro del árbol privado.
- **Dependencia previa**: C-03 (archivada). Sin bloqueos de implementación.
- **Governance**: CRÍTICO — `apply` queda GATED a revisión humana del plan (ver decisiones D-C04-* en `design.md`) antes de escribir cualquier código.
