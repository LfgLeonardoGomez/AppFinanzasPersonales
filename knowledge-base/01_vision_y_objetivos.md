# 01 · Visión y Objetivos

> Fuente: `docs/00-vision-general.md`, `docs/01-mvp-especificacion-funcional.md`.

## Propósito

Aplicación personal para registrar **facturas recibidas de proveedores/servicios** y los **pagos realizados**, manteniendo el **saldo de cuenta corriente de cada proveedor** siempre actualizado, con **carga asistida por IA de visión** (foto → autocompletar) para reducir la carga manual de datos.

Es un **registro contable simplificado de cuentas a pagar**. Explícitamente **NO** es:
- Un sistema de facturación (no emite comprobantes fiscales).
- Un gateway de pagos (no transacciona dinero).

## Objetivos por actor

| Actor | Objetivo |
|---|---|
| Usuario (dueño de comercio chico, ej. "Leo") | Registrar facturas y pagos rápido, ver cuánto le debe a cada proveedor y el estado de cada factura, con la mínima carga manual posible. |
| Sistema | Mantener el saldo y el estado de las facturas siempre consistentes calculándolos on-demand, garantizando aislamiento total de datos entre usuarios. |

## Alcance del MVP (lo que se construye ahora)

**Estado: ✅ MVP completo el 2026-06-29** (c-13 archivado 2026-06-27 marca la funcionalidad core; c-15 archivado 2026-06-29 cierra la IA-frontend; c-17 archivado 2026-06-29 sanea la suite de tests).

- Autenticación de usuario (registro + login, multi-usuario con datos aislados). ✅ c-03/c-04
- Perfil de usuario (completable después del registro). ✅ c-05
- Gestión de proveedores (CRUD, incluye servicios como categoría). ✅ c-06/c-07
- Carga manual de facturas (con items opcionales). ✅ c-08/c-09
- Carga manual de pagos (asociados a proveedor, nunca a factura puntual). ✅ c-10/c-11
- Cuenta corriente por proveedor: saldo + estado FIFO + historial cronológico (todo calculado). ✅ c-12/c-13
- Búsqueda / filtro por proveedor, estado y rango de fechas. ✅ c-09/c-11
- Tema claro/oscuro persistido en backend. ✅ c-05
- **Carga asistida por IA** de facturas y pagos. ✅ c-14 (backend) + c-15 (frontend, 2026-06-29) — implementado sobre el flujo manual ya funcionando, tal como se planeó.
- Test pollution regression suite (housekeeping de infra de tests). ✅ c-17 (2026-06-29)

## Alcance de la evolución post-MVP (decidido 2026-08-09 — ver D-27 a D-38)

> El sistema deja de ser "registro de facturas y pagos a proveedores" para volverse un **mini sistema de gestión para negocios chicos**: compras, ventas y las dos cuentas corrientes. El proyecto se renombrará cuando esta etapa esté encaminada.

- **Negocio como entidad de aislamiento** y equipo multi-usuario: varias personas del mismo local, cada una con su cuenta y su dispositivo (D-27 a D-32). Un solo nivel de privilegio, `es_admin`.
- **Registro autoservicio**: alta de negocio sin intervención manual + alta de empleado por código de invitación de un solo uso.
- **Recuperación de contraseña por email** (D-38) — sale de "Futuro" y entra al alcance: es la red de seguridad del modelo de equipo.
- **Clientes y cuenta corriente / fiados** (D-36, D-37): la libreta del negocio, reutilizando el motor de saldo y FIFO de proveedores. Sin saldo a favor.
- **Registro de ventas** (D-33 a D-35): una fila por operación, con forma de pago. El fiado es una venta, no una entidad aparte.
- **Estadísticas**: compras por proveedor y ventas por período (día/semana/mes), con desglose por forma de pago, y contraste compras-vs-ventas.
- **Exportación PDF / XLS** de cuentas corrientes y proveedores. XLS = tabla de movimientos para seguir trabajando en Excel; PDF = resumen de cuenta prolijo, presentable al cliente del negocio.

## Fuera del alcance actual (Futuro)

- Dashboard/inicio personalizable, notificaciones de vencimiento, badge de clima, app nativa (React Native).
- Roles con permisos granulares (más allá del booleano `es_admin` — ver D-29).
- Un usuario operando **dos negocios** con la misma cuenta (hoy: dos cuentas, ver D-28).
- Facturación / control de stock e inventario. El registro de ventas es de **montos**, no de items: no es un POS.

## Fuera de alcance — permanente o descartado

| Ítem | Razón |
|---|---|
| Integración MercadoPago (módulo proveedores) | La dirección de cobro no coincide con Checkout Pro. Solo candidato si se reactiva el módulo de clientes/ventas. |
| Pago automatizado de servicios con tarjeta vía código de barras | Requiere habilitación como entidad de pago regulada (BCRA). Fuera de alcance de proyecto personal. |
| Facturación electrónica / integración AFIP | La app registra, no emite comprobantes fiscales. **Permanente.** |
| Multi-moneda | **Permanente.** Todo en ARS. |
| Discriminación de IVA | Las facturas registran solo monto total. |
| Extracción por IA de items / sobre PDF | En MVP la IA solo extrae cabecera, y solo sobre imágenes. |

## Regla de oro para agentes de IA

Si se genera código a partir de esta documentación, ceñirse **únicamente a lo marcado como "MVP"**, salvo instrucción explícita de avanzar a una fase posterior. Todo lo que no esté descrito explícitamente en la spec funcional se considera fuera de alcance: **no asumir ni inventar**.
