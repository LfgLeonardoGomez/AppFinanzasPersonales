## ADDED Requirements

### Requirement: La contraseña deja de ser inmutable fuera del registro

El sistema SHALL permitir escribir `password_hash` únicamente en tres lugares: el registro público, el registro de empleado, y `POST /api/auth/reset` mediante un token de un solo uso entregado por correo. Hasta C-31 el hash solo se escribía en el alta —el perfil lo excluye explícitamente— y este change abre exactamente **una** vía adicional, no más.

El sistema SHALL NOT permitir cambiar la contraseña por ningún otro endpoint. En particular, `PATCH /api/me` SHALL seguir sin aceptar `password` ni `password_hash`.

#### Scenario: el perfil sigue sin poder cambiar la contraseña

- **WHEN** se envía `password` o `password_hash` en un `PATCH /api/me`
- **THEN** el hash almacenado no cambia

#### Scenario: la única vía es el token de reset

- **WHEN** se inspeccionan las rutas que escriben `password_hash`
- **THEN** son el registro (alta), el registro de empleado (alta) y el reset — ninguna más

### Requirement: Las rutas públicas de recuperación

El sistema SHALL sumar `POST /api/auth/recuperar` y `POST /api/auth/reset` al conjunto de rutas que **no** requieren sesión, junto a registro, registro de empleado y login. Ambas SHALL tener rate limiting.

Todo el resto de los endpoints SHALL seguir requiriendo sesión válida.

#### Scenario: se puede recuperar sin sesión

- **WHEN** se llama a `/api/auth/recuperar` o `/api/auth/reset` sin cookie de sesión
- **THEN** la API responde según su propia lógica, nunca con 401 por falta de sesión

#### Scenario: el resto sigue protegido

- **WHEN** se llama a cualquier endpoint de negocio sin sesión
- **THEN** la respuesta sigue siendo 401
