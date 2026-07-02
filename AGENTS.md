# App de Facturas y Pagos a Proveedores — Instrucciones para Agentes

> Registro contable simplificado de cuentas a pagar a proveedores, con **saldo y estado de factura calculados on-demand** (nunca persistidos), **carga asistida por IA de visión**, **FastAPI + PWA React**, multi-usuario con datos aislados por cuenta. Todo en ARS, MVP.

## Stack Tecnológico

| Capa | Tecnología |
|---|---|
| Backend | FastAPI (Python) + PostgreSQL, SQLModel + Pydantic, patrón Repository/Service/Router, UnitOfWork |
| Frontend | PWA: React + TypeScript + Vite, TanStack Query, Zustand, Axios, Tailwind CSS v4, estructura por features |
| Auth | Cookie httpOnly (no localStorage), access token corto + refresh, multi-usuario con datos aislados |
| Archivos | Cloudinary (upload preset firmado desde backend) |
| IA extracción | Abstracción configurable (`VISION_PROVIDER`): Claude/OpenAI. Solo cabecera, solo imágenes |
| Infra | Backend dockerizado en VPS Oracle Cloud Free Tier (1GB RAM); frontend build estático (Vercel) |
| Contratos | Tipos TS generados desde OpenAPI (`openapi-typescript`); back y front en repos separados |

## Base de Conocimiento

La fuente de verdad estructurada vive en [`knowledge-base/`](knowledge-base/README.md). Leer ANTES de codear:

| Archivo | Cuándo leerlo |
|---|---|
| [01_vision_y_objetivos.md](knowledge-base/01_vision_y_objetivos.md) | Alcance MVP vs fuera de alcance |
| [02_descripcion_general.md](knowledge-base/02_descripcion_general.md) | Stack, integraciones, despliegue |
| [03_actores_y_roles.md](knowledge-base/03_actores_y_roles.md) | Aislamiento por `usuario_id`, rutas públicas |
| [04_modelo_de_datos.md](knowledge-base/04_modelo_de_datos.md) | Entidades, ERD, invariantes |
| [05_reglas_de_negocio.md](knowledge-base/05_reglas_de_negocio.md) | **Reglas RN-XX: saldo, FIFO, IA, vinculación** |
| [06_funcionalidades.md](knowledge-base/06_funcionalidades.md) | Features por épica |
| [07_flujos_principales.md](knowledge-base/07_flujos_principales.md) | Flujos extremo a extremo |
| [08_arquitectura_propuesta.md](knowledge-base/08_arquitectura_propuesta.md) | Capas, estructura, seguridad, env vars |
| [09_decisiones_y_supuestos.md](knowledge-base/09_decisiones_y_supuestos.md) | Decisiones D-XX + supuestos |
| [10_preguntas_abiertas.md](knowledge-base/10_preguntas_abiertas.md) | **⚠️ Inconsistencias y decisiones pendientes (Q-XX)** |

## Skills Disponibles

| Agente / Rol | Skills que carga |
|---|---|
| Backend Core (FastAPI/SQLModel/UoW) | `fastapi`, `supabase-postgres-best-practices` |
| Backend Aux (seguridad/multi-tenant/infra) | `saas-multi-tenant`, `devops-engineer` |
| Frontend (React/TS/PWA/Tailwind) | `vercel-react-best-practices`, `frontend-design`, `high-end-visual-design`, `emil-design-eng` |
| Frontend QA / motion review | `review-animations`, `typescript-e2e-testing`, `webapp-testing` |
| Entrega / PRs | `work-unit-commits`, `branch-pr`, `chained-pr` |
| Documentación | `cognitive-doc-design` |

> Los compact rules de cada skill los resuelve el orquestador desde `.atl/skill-registry.md` (generado por `skill-registry`; no versionado — no está en el repo).

## Roadmap de Changes

15 changes en 9 fases — índice completo en [`CHANGES.md`](CHANGES.md).

**Camino crítico:** `C-01 foundation → C-02 core-models → C-03 auth-back → C-04 auth-front → C-07 proveedores-front → C-08 facturas-back → C-09 facturas-front → C-10 pagos-back → C-11 pagos-front → C-12 cc-back → C-13 cc-front → [C-14 · C-15 IA al final]`.

El sistema es funcional en producción desde **C-13** (cuenta corriente completa). La IA de visión (C-14/C-15) se implementa al final, sobre el flujo manual ya funcionando.

**Primer change:** `C-01-foundation-setup` → `/opsx:propose C-01-foundation-setup`.

## Reglas Duras (específicas del proyecto)

> Reglas globales ya definidas en `~/.claude/CLAUDE.md` (orquestador, governance, TDD estricto, engram, conventional commits, no co-autoría, response-length): el proyecto las **hereda**. Acá viven solo las reglas específicas de este proyecto.

**🔴 Invariantes de negocio (violarlas rompe el sistema):**
1. **NUNCA** persistir `saldo` ni `estado` de factura → siempre calcular on-demand (RN-SALDO, RN-FIFO). No agregar columnas para estos valores.
2. **NUNCA** vincular un Pago a una Factura → no existe `factura_id`; el pago se asocia solo al proveedor (RN-PAG-01).
3. **NUNCA** consultar/modificar un recurso sin filtrar por `usuario_id` en el **service layer** → recurso de otro usuario devuelve **404** (no 403).
4. **NUNCA** dejar que la IA invente, persista o asigne un proveedor → la IA propone, el humano confirma (RN-IA-03/04/06).

**🟡 Arquitectura y stack:**
5. La autorización y el cálculo de saldo/estado viven en el **service layer** → NUNCA en router ni en repository.
6. **NUNCA** confiar solo en la validación del frontend → validar todo con **Pydantic** en backend (monto>0, fechas no futuras UTC-3, CUIT, enums).
7. **Python**: snake_case + type hints. **TS/React**: PascalCase en componentes, prohibido `any`, tsconfig estricto.
8. Montos `numeric(12,2)` en **ARS**; fechas en **UTC-3**. Sin multi-moneda, sin IVA.

**🟢 Testing y seguridad:**
9. Tests con **Postgres real/contenedor** → NUNCA SQLite. Servicios externos (Cloudinary, modelo de visión) **siempre mockeados**.
10. Secretos en **variables de entorno**, nunca commiteados (`.env` en `.gitignore`).

**Recordatorio:** resolver **Q-01 (id UUID vs serial)** antes de escribir el primer modelo.

## Flujo de Trabajo

```
knowledge-base/ (qué construir)  →  CHANGES.md (en qué orden)
   →  /opsx:propose <change>  →  /opsx:apply  →  /opsx:archive
```

Ante cualquier duda de negocio: la KB manda. Si la KB no lo cubre, está en `10_preguntas_abiertas.md` o fuera de alcance — **no asumir ni inventar**.
