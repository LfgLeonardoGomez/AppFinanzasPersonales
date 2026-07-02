# Knowledge Base — App de Facturas y Pagos a Proveedores

Base de conocimiento estructurada del proyecto. Esta KB es la **fuente de verdad navegable** para agentes y personas. Los documentos originales en `docs/` son la fuente histórica de la ingesta inicial; la fuente de verdad operacional de los cambios es `openspec/`.

## Índice

| # | Archivo | Contenido |
|---|---|---|
| 01 | [01_vision_y_objetivos.md](01_vision_y_objetivos.md) | Propósito, objetivos por actor, alcance MVP, fuera de alcance |
| 02 | [02_descripcion_general.md](02_descripcion_general.md) | Stack, arquitectura general, integraciones, despliegue, estado de testing |
| 03 | [03_actores_y_roles.md](03_actores_y_roles.md) | Actores, aislamiento por cuenta, rutas públicas + endpoints autenticados |
| 04 | [04_modelo_de_datos.md](04_modelo_de_datos.md) | Entidades, ERD, relaciones, invariantes (incluye `RefreshToken` post-C-03) |
| 05 | [05_reglas_de_negocio.md](05_reglas_de_negocio.md) | Reglas codificadas (RN-XX): saldo, FIFO, IA, vinculación, auth, testing |
| 06 | [06_funcionalidades.md](06_funcionalidades.md) | Features por épica (MVP completo) |
| 07 | [07_flujos_principales.md](07_flujos_principales.md) | Flujos extremo a extremo (incluye IA implementada + auth refresh) |
| 08 | [08_arquitectura_propuesta.md](08_arquitectura_propuesta.md) | Patrones, estructura, seguridad, env vars, testing + pollution fix |
| 09 | [09_decisiones_y_supuestos.md](09_decisiones_y_supuestos.md) | Decisiones (D-01..D-24) + supuestos inferidos |
| 10 | [10_preguntas_abiertas.md](10_preguntas_abiertas.md) | Inconsistencias y decisiones pendientes (Q-XX) |
| — | [CHANGELOG.md](CHANGELOG.md) | Registro de updates de la KB (no del código) |

## Resumen en una línea

Registro contable simplificado de **cuentas a pagar** a proveedores, con **saldo y estado de facturas calculados on-demand** (nunca persistidos), **carga asistida por IA de visión** ✅ implementado, **FastAPI + PWA React**, multi-usuario con datos aislados por cuenta. Todo en ARS, **MVP completo al 2026-06-29**.

## Conceptos núcleo (leer primero)

1. **Saldo y estado derivados** (RN-SALDO, RN-FIFO) — nada se persiste; todo se calcula. Es el corazón del sistema.
2. **Pago → proveedor, nunca factura** (RN-PAG-01) — no existe `factura_id`. Reforzado por `PagoCreate.extra="forbid"`.
3. **Aislamiento por `usuario_id`** en el service layer; recurso ajeno → 404.
4. **IA propone, el humano confirma** (RN-IA-04, RN-IA-06) — nunca inventa, nunca persiste desde el modal, nunca asigna proveedor sola. El cliente envía `origen='IA'` en el POST de persistencia (D-18, Path B).
5. **Refresh tokens opacos con hash + rotación** (RN-AUTH-02..05, D-17) — el server solo guarda el hash; logout y rotación invalidan inmediatamente.

## Fuente y mantenimiento

- Ingesta inicial: `kb-creator` (modo ingest) a partir de los 6 documentos de `docs/` (2026-06-19).
- **Sync post-MVP:** 2026-06-29 con `chronicle` (modo Update) tras archivar c-01..c-17. Ver `CHANGELOG.md` para el delta exacto.
- Próxima operación de mantenimiento: `/active-orchestrator:kb` (regeneración) o `chronicle` (sync incremental).
