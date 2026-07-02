# 06 · Funcionalidades

> Fuente: `docs/01-mvp-especificacion-funcional.md`. Organizadas por épica. Solo MVP.

## Épica: Registro y Autenticación

- **F-AUTH-01 · Registro mínimo** — Alta con email, nombre y contraseña (nada más). Email único. Contraseña con hash (argon2id preferido, bcrypt aceptable).
- **F-AUTH-02 · Login** — Email + contraseña. Mensaje de error genérico ("credenciales inválidas").
- **F-AUTH-03 · "Recordarme"** — Activado → sesión persistente (~30 días, refresh token httpOnly). Desactivado → cookie de sesión (se borra al cerrar el navegador) + access token corto.
- **F-AUTH-04 · Logout** — Invalida la sesión.
- *Fuera del MVP:* recuperación de contraseña por email (durante el MVP se resuelve manualmente en base de datos).

## Épica: Perfil de usuario

- **F-PERF-01 · Completar perfil** — Dentro de la app: teléfono, avatar (Cloudinary), nombre del negocio, tema. Todos **opcionales**; su ausencia no bloquea nada.
- **F-PERF-02 · Tema claro/oscuro** — Persistido en el perfil (backend, no localStorage), consistente entre celular y PC.

## Épica: Proveedores

- **F-PROV-01 · CRUD de proveedores** — Crear/editar sin restricciones más allá de la tabla de campos. Servicios = `categoria SERVICIO`.
- **F-PROV-02 · Eliminar con confirmación** — Soft delete; si tiene facturas/pagos, modal de confirmación (RN-PROV-04).
- **F-PROV-03 · Listado ordenable** — Paginado, ordenable por nombre o por **saldo actual** calculado.

## Épica: Facturas

- **F-FAC-01 · Carga manual de factura** — Con campos obligatorios (proveedor, fecha_emisión, monto_total) e items opcionales.
- **F-FAC-02 · Editar/eliminar factura** — Todos los campos editables; eliminar = soft delete.
- **F-FAC-03 · Listado filtrable** — Por proveedor, **estado** (calculado en service, RN-FAC-09) y rango de fechas.
- **F-FAC-04 · Carga asistida por IA** ✅ *(implementada, c-14 backend + c-15 frontend)* — Botón "Cargar con imagen (IA)" en `FacturaFormPage` (modo crear, oculto en edit) → `PropuestaIAModal` (bloqueante, RN-IA-08) → `POST /api/facturas/extraer-ia` → preview de cabecera editable → confirmar llena el form, el POST de persistencia es el existente (RN-IA-04). El cliente envía `origen='IA'` (D-18, Path B) en el `POST /api/facturas` final.

## Épica: Pagos

- **F-PAG-01 · Carga manual de pago** — Asociado a proveedor (RN-PAG-01), con método obligatorio.
- **F-PAG-02 · Editar/eliminar pago** — Libre; recalcula saldo y estados.
- **F-PAG-03 · Carga asistida por IA** ✅ *(implementada, c-14 backend + c-15 frontend)* — Mismo patrón que F-FAC-04, sobre `PagoFormPage` y `POST /api/pagos/extraer-ia`. `PagoCreate` mantiene `extra="forbid"` (RN-PAG-01), pero `origen` ya es un campo conocido y opcional.

## Épica: Cuenta corriente

- **F-CC-01 · Saldo del proveedor** — Número calculado on-demand (RN-SALDO).
- **F-CC-02 · Estado de facturas** — PENDIENTE/PARCIAL/PAGADA por FIFO (RN-FIFO).
- **F-CC-03 · Historial cronológico** — Vista debe/haber con saldo acumulado (RN-HIST).

## Épica: Búsqueda y navegación

- **F-BUS-01 · Filtro por proveedor** — Autocomplete por nombre.
- **F-BUS-02 · Filtro de facturas** — Por estado (post-cálculo) y rango de fechas.

## Épica: Pantalla de inicio (MVP)

- **F-HOME-01 · Inicio limpio** — Sin gráficos ni dashboard. Saludo (nombre del usuario) + accesos rápidos: "Cargar factura", "Cargar pago", "Ver proveedores".
- *Futuro:* personalización del inicio (fondo, widgets).

## Vinculación de proveedor (transversal a IA y carga manual)

- **F-VINC-01 · Sugerencia y selección de proveedor** — Búsqueda automática normalizada, sugerencias, "Buscar proveedor", "Crear nuevo" (RN-VINC). La IA nunca asigna proveedor sola.

## Épica: Carga con IA — modal y estados de error (c-15)

- **F-IA-MODAL-01 · Modal bloqueante con 3 estados** — `idle` (image picker), `extracting` (spinner, no se puede cerrar), `proposal` (form prellenado editable). La extracción se hace vía las mutations `useExtraerFacturaIA` / `useExtraerPagoIA` (TanStack Query + Axios + `multipart/form-data`).
- **F-IA-MODAL-02 · Cuatro estados de error manejados** — `error_422` (formato/tamaño en backend, no retry), `error_429` (countdown con `Retry-After`, no auto-retry), `error_extractor` (respuesta con `error: true`, RN-IA-05 → "Cargar manualmente" / "Reintentar con otra foto"), `error_generic` (5xx/red → "Reintentar" / "Cargar manualmente").
- **F-IA-MODAL-03 · Confirmar llena el form, NO persiste** — "Confirmar" en el modal solo setea form state (RN-IA-04). El POST de persistencia lo dispara el botón "Confirmar" del `FacturaFormPage` / `PagoFormPage` (mutaciones existentes de c-09 / c-11), pasando `origen='IA'` en el body (D-18).
- **F-IA-MODAL-04 · Supplier matching vía `SupplierSearch` compartido** — El modal pasa `proveedor_nombre` como string al `SupplierSearch` (C-07), que arranca sin proveedor seleccionado (RN-IA-06). El usuario puede aceptar sugerencia, buscar en la lista completa o crear uno nuevo en el momento.

## Épica: Testing (c-16, c-17)

- **F-TEST-01 · Suite de regresión para inter-file test pollution** ✅ *(c-17, archivado 2026-06-29)* — `facturas-proveedores-api/tests/test_pollution_fix.py` (13 tests): 1 invariante de module-identity (routers conservan `get_db` viejo tras reload de `app.core.deps`) + 6 fixture contracts (AST inspection sobre los 6 archivos pollutos) + 6 isolation regressions (cada archivo polluto corre en suite sin fallar). Si un PR revierte el import en cualquiera de los 6 archivos, la regresión falla en CI.
