# Auth Frontend Specification

## Purpose

Provide the client-side authentication layer of the PWA (`facturas-proveedores-web`) that consumes the `auth-backend` (C-03) HTTP contract without weakening it:
- Login and registration pages with backend-faithful error semantics
- Session state held only as derived UI state (no tokens in JS — cookies are `HttpOnly`)
- An Axios client with `withCredentials` and a 401 → silent-refresh → redirect interceptor
- A `RequireAuth` route guard and public/private routing
- Session bootstrap on app load via `GET /api/me`

## Requirements

### Requirement: Página de registro con validación y error de email en uso

El frontend SHALL exponer una página de registro en la ruta pública `/registro` con un formulario de `email`, `nombre` y `password`. El cliente SHALL validar `password` con longitud mínima de 8 caracteres y `email` con formato, mostrando feedback antes de enviar, pero la validación de cliente SHALL NOT ser la única barrera: la autoridad es el backend (Pydantic). Ante un alta exitosa (`POST /api/auth/registro` 2xx) el frontend SHALL llevar al usuario al login o a la sesión iniciada. Ante un email ya existente el frontend SHALL mostrar un mensaje específico de email en uso, y ante un 422 del backend SHALL renderizar el error de validación sin crear estado de sesión.

#### Scenario: registro exitoso

- **WHEN** el usuario completa email nuevo, nombre y password de ≥ 8 caracteres y envía el formulario, y el backend responde 2xx
- **THEN** el frontend lo redirige al flujo autenticado o al login, sin exponer ningún token en JS

#### Scenario: email ya registrado

- **WHEN** el backend responde que el email está en uso al hacer `POST /api/auth/registro`
- **THEN** el formulario muestra un mensaje específico de email en uso y no inicia sesión

#### Scenario: password demasiado corta validada en cliente

- **WHEN** el usuario ingresa una password de menos de 8 caracteres
- **THEN** el formulario muestra un error de validación de cliente y no envía la request

### Requirement: Página de login con error genérico y "Recordarme"

El frontend SHALL exponer una página de login en la ruta pública `/login` con un formulario de `email`, `password` y un checkbox "Recordarme". En éxito (`POST /api/auth/login` 2xx) el frontend SHALL poblar el estado de sesión y redirigir al home `/`. Ante credenciales inválidas el frontend SHALL mostrar **un único mensaje genérico** ("Credenciales inválidas") que no revela si falló el email o la password, reflejando el contrato del backend. La intención de "Recordarme" SHALL transmitirse al backend, que decide la duración de la sesión; el frontend SHALL NOT administrar la duración ni los valores de las cookies de sesión.

#### Scenario: login exitoso redirige al home

- **WHEN** el usuario ingresa credenciales correctas y el backend responde 2xx seteando las cookies de sesión
- **THEN** el frontend puebla `authStore.user`, marca `isAuthenticated`, y redirige a `/`

#### Scenario: credenciales inválidas con mensaje genérico

- **WHEN** el backend rechaza el login por credenciales inválidas
- **THEN** el formulario muestra el único mensaje genérico "Credenciales inválidas", sin revelar si falló el email o la password

#### Scenario: "Recordarme" se delega al backend

- **WHEN** el usuario marca o desmarca "Recordarme" y envía el login
- **THEN** la intención viaja en la request y el frontend no setea ni lee TTLs de cookie por su cuenta

### Requirement: Store de sesión sin tokens en JS

El frontend SHALL mantener el estado de sesión en un store Zustand (`authStore`) con `user` e `isAuthenticated`, y acciones `login` (puebla `user`) y `logout` (limpia `user`). El store SHALL NOT almacenar el access token ni el refresh token: las credenciales viven exclusivamente en cookies `HttpOnly` y JS no las lee ni las copia a `localStorage`/`sessionStorage`. `isAuthenticated` SHALL derivarse de la presencia de `user`.

#### Scenario: el store no contiene tokens

- **WHEN** la sesión está activa tras un login exitoso
- **THEN** `authStore` contiene los datos del usuario pero ningún token, y no hay tokens en `localStorage` ni `sessionStorage`

#### Scenario: logout limpia el estado de sesión

- **WHEN** el usuario hace logout
- **THEN** `authStore.user` queda en `null`, `isAuthenticated` es `false`, y el frontend redirige a `/login`

### Requirement: Cliente Axios con credenciales e interceptor 401

El frontend SHALL exponer una única instancia Axios (`src/shared/api/client.ts`) con `baseURL` `/api` y `withCredentials: true`, de modo que el navegador adjunte automáticamente las cookies de sesión en cada request. La instancia SHALL incluir un interceptor de respuesta que, ante un `401` en una request protegida, intente **una sola vez** `POST /api/auth/refresh`; si el refresh tiene éxito SHALL reintentar la request original una vez, y si el refresh falla SHALL limpiar el estado de sesión y redirigir a `/login`. El interceptor SHALL NOT reintentar sobre las propias rutas `/api/auth/login` ni `/api/auth/refresh` (evita loops), y SHALL garantizar **un único refresh in-flight** cuando varias requests fallan con 401 en paralelo.

#### Scenario: 401 dispara refresh silencioso y reintento exitoso

- **WHEN** una request protegida responde 401 y el refresh subsiguiente responde 2xx
- **THEN** la request original se reintenta una vez y el usuario permanece autenticado sin ver la pantalla de login

#### Scenario: refresh fallido redirige a login

- **WHEN** una request protegida responde 401 y el refresh subsiguiente también responde 401
- **THEN** el frontend limpia `authStore` y redirige a `/login`

#### Scenario: 401 simultáneos comparten un único refresh

- **WHEN** varias requests protegidas responden 401 al mismo tiempo
- **THEN** se ejecuta un único `POST /api/auth/refresh` y las demás requests esperan su resultado en lugar de disparar refreshes paralelos

### Requirement: Guard RequireAuth y ruteo público/privado

El frontend SHALL definir un guard `RequireAuth` que envuelve el árbol de rutas privadas y redirige a `/login` cuando no hay sesión válida. El router (`src/app/router.tsx`) SHALL declarar `/login` y `/registro` como rutas públicas y el resto bajo `RequireAuth`. Tras un login exitoso el frontend SHALL redirigir al home `/`; tras logout SHALL redirigir a `/login`. Mientras el estado de sesión no esté resuelto, `RequireAuth` SHALL mostrar un estado de verificación en lugar de renderizar contenido público o privado.

#### Scenario: acceso a ruta privada sin sesión redirige a login

- **WHEN** un usuario sin sesión navega a una ruta privada
- **THEN** `RequireAuth` lo redirige a `/login`

#### Scenario: acceso a ruta privada con sesión renderiza el contenido

- **WHEN** un usuario autenticado navega a una ruta privada
- **THEN** `RequireAuth` renderiza el contenido protegido sin redirigir

### Requirement: Bootstrap de sesión vía GET /api/me

Al cargar la aplicación el frontend SHALL consultar `GET /api/me` para determinar si existe una sesión válida: ante `2xx` SHALL poblar `authStore.user`, y ante `401` SHALL dejar el estado sin sesión. La query de bootstrap SHALL NOT disparar el redirect del interceptor 401 (un 401 acá significa "no logueado", no "sesión caída"). Mientras el bootstrap está pendiente, el frontend SHALL mostrar un estado de verificación que evita el parpadeo entre vistas pública y privada.

#### Scenario: bootstrap con sesión válida puebla el store

- **WHEN** la app carga y `GET /api/me` responde 2xx con el perfil del usuario
- **THEN** `authStore.user` queda poblado e `isAuthenticated` es `true`

#### Scenario: bootstrap sin sesión deja el estado vacío sin error de sesión caída

- **WHEN** la app carga y `GET /api/me` responde 401
- **THEN** `authStore` queda sin usuario y el frontend no ejecuta un redirect de "sesión caída" por ese 401 de bootstrap

### Requirement: Página de login visible offline (PWA)

El frontend SHALL incluir la página de login en el app shell cacheado por el service worker, de modo que sea visible sin conexión. El frontend SHALL NOT cachear las respuestas de `/api/auth/*` ni `/api/me` (datos sensibles y dinámicos), y SHALL mostrar un error claro de falta de conexión cuando se intenta enviar el login estando offline.

#### Scenario: login renderiza offline

- **WHEN** el dispositivo está sin conexión y el usuario abre la app instalada
- **THEN** la pantalla de login se renderiza desde el shell cacheado

#### Scenario: enviar login offline muestra error de conexión

- **WHEN** el usuario envía el formulario de login estando offline
- **THEN** el frontend muestra un error de falta de conexión y no crea estado de sesión falso
### Requirement: El registro distingue crear un negocio de sumarse a uno

`RegisterPage` SHALL dejar de asumir un único camino de alta. SHALL ofrecer explícitamente la creación de un negocio nuevo y el ingreso a uno existente mediante código, enviando cada uno al endpoint que le corresponde (`/api/auth/registro` y `/api/auth/registro-empleado`).

Un empleado que use el camino equivocado no recibe un error: se queda con un negocio propio y vacío, convencido de haber entrado al de su jefe. Por eso la distinción tiene que estar en la interfaz y no depender de que el usuario sepa cuál le toca.

#### Scenario: el camino elegido determina el endpoint

- **WHEN** el usuario completa el formulario por el camino de negocio nuevo o por el de invitación
- **THEN** la petición se envía al endpoint correspondiente a ese camino, nunca al otro

#### Scenario: el nombre del negocio solo aplica al camino de creación

- **WHEN** el usuario está en el camino de sumarse con código
- **THEN** no se le pide el nombre de un negocio: el negocio ya existe

#### Scenario: la sesión queda iniciada por cualquiera de los dos caminos

- **WHEN** un alta se completa correctamente por cualquiera de los dos caminos
- **THEN** el usuario termina autenticado dentro del negocio que le corresponde
