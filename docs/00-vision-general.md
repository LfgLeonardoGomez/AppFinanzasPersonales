# Visión General — App de Gestión de Facturas y Pagos a Proveedores

## 1. Propósito

Aplicación personal para registrar facturas recibidas de proveedores/servicios y los pagos realizados, manteniendo el saldo de cuenta corriente de cada proveedor siempre actualizado, con carga asistida por IA (visión) para reducir la carga manual de datos.

No es un sistema de facturación (no emite comprobantes fiscales) ni un gateway de pagos (no transacciona dinero). Es un **registro contable simplificado** de cuentas a pagar.

## 2. Alcance completo del producto

Cada item incluye su estado actual de planificación. Esta tabla es la fuente de verdad sobre qué está dentro y qué está fuera de cada etapa.

| Feature | Estado |
|---|---|
| Autenticación de usuario único | MVP |
| Gestión de proveedores (CRUD) | MVP |
| Carga manual de facturas | MVP |
| Carga manual de pagos (con o sin factura asociada) | MVP |
| Cuenta corriente por proveedor (historial + saldo) | MVP |
| Búsqueda / filtro por proveedor | MVP |
| Tema claro/oscuro | MVP |
| Carga de facturas asistida por IA (foto → autocompletar formulario) | MVP — se implementa al final del desarrollo, sobre el flujo manual ya funcionando |
| Carga de pagos asistida por IA (foto de comprobante → autocompletar) | MVP — mismo criterio que arriba |
| Gestión de clientes / cuentas por cobrar (ventas) | FASE 2 — fuera del MVP |
| Dashboard / pantalla de inicio personalizable | FUTURO |
| Gráficos y métricas | FUTURO |
| Notificaciones / recordatorios de vencimiento | FUTURO — no especificado aún, no asumir nada |
| Badge de clima en la UI | FUTURO — decorativo, sin relación con el core, baja prioridad |
| App nativa (React Native) | FUTURO — condicionado a que existan usuarios reales más allá de Leo. El backend se diseña API-first para no requerir cambios cuando esto se active |
| Multi-usuario / roles | FUTURO — depende de si la app deja de ser de uso personal |
| Recuperación de contraseña por email | FUTURO — no bloqueante para el MVP, ver nota en spec funcional |
| Integración MercadoPago (Checkout Pro) | DESCARTADO para el módulo de proveedores. Candidato natural solo si se reactiva el módulo de clientes/ventas, porque ahí la dirección de cobro (vos cobrás) sí coincide con cómo funciona Checkout Pro |
| Pago automatizado de facturas de servicios con tarjeta vía código de barras | DESCARTADO. Requiere habilitación como entidad de pago regulada (vía Prisma/Interbanking, sujeto a aprobación de BCRA), fuera de alcance de un proyecto personal/indie |
| Facturación electrónica / integración AFIP | FUERA DE ALCANCE permanente. La app registra, no emite comprobantes fiscales |
| Multi-moneda | FUERA DE ALCANCE permanente |

## 3. Stack tecnológico definido

- **Backend:** FastAPI (Python) + PostgreSQL, SQLModel + Pydantic, patrón repository/service, UnitOfWork para operaciones atómicas (consistente con el approach ya usado en el proyecto FoodStore de Leo)
- **Frontend:** PWA — React + TypeScript + Vite, TanStack Query, Zustand, Axios, Tailwind CSS v4, estructura por features
- **Autenticación:** cookie httpOnly (no localStorage), single user en el MVP
- **Imágenes/archivos:** Cloudinary (almacenamiento y recuperación de URLs; no realiza el análisis)
- **IA de extracción:** **abstracción configurable** sobre un modelo de visión, seleccionable por configuración (Claude, OpenAI, etc.), para poder comparar modelos. Recibe la imagen, devuelve JSON estructurado (solo cabecera: proveedor, número, fecha, total) para precargar un formulario que el usuario confirma o corrige
- **Infraestructura:** backend dockerizado en VPS Oracle Cloud Free Tier (1GB RAM); frontend como build estático (Vercel o similar)
- **Repos:** backend y frontend en repositorios separados. Los tipos TypeScript del frontend se generan desde el schema OpenAPI que expone FastAPI automáticamente (`openapi-typescript`), para no duplicar definiciones a mano

## 4. Decisiones de negocio ya resueltas (no reabrir sin razón)

1. Las facturas y pagos se pueden **editar o eliminar libremente**, sin mecanismo de reversa obligatorio.
2. Las facturas registran **solo el monto total**, sin discriminar IVA. Todos los montos en **pesos argentinos (ARS)**, sin campo de moneda.
3. Un pago se asocia **a un proveedor, nunca a una factura puntual**. No existe vínculo pago–factura.
4. El **saldo del proveedor se calcula dinámicamente** en cada consulta (suma de facturas activas menos suma de pagos activos), nunca se persiste. Convención: saldo positivo = deuda, negativo = saldo a favor.
5. El **estado de cada factura** (pendiente/parcial/pagada) también es **derivado, no almacenado**: se calcula asignando el total de pagos del proveedor a sus facturas **de la más vieja a la más nueva (FIFO)**. Una factura cubierta en parte queda parcial; el sobrante de pagos por encima del total facturado queda como saldo a favor.
6. App **multi-usuario con datos aislados por cuenta**, sin roles ni datos compartidos en el MVP. Registro abierto y mínimo (email, nombre, contraseña); el resto del perfil se completa después dentro de la app.

Detalle completo del modelo de saldo y estado en `01-mvp-especificacion-funcional.md` y `02-modelo-datos.md`.

## 5. Notas de uso de este documento

Este documento describe el **alcance completo de la visión del producto**, no lo que se va a construir ahora. El detalle funcional y los límites estrictos del MVP están en `01-mvp-especificacion-funcional.md`, el modelo de datos en `02-modelo-datos.md`, la arquitectura en `03-arquitectura-tecnica.md`, el baseline de seguridad en `04-baseline-seguridad.md` y las convenciones de testing en `05-convenciones-testing.md`. Si un agente de IA está generando código a partir de esta documentación, debe ceñirse únicamente a lo marcado como "MVP" salvo instrucción explícita de avanzar a una fase posterior.
