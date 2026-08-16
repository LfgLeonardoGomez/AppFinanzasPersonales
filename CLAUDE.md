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

> Los compact rules de cada skill los resuelve el orquestador desde `.atl/skill-registry.md`, generado por `skill-registry`.
>
> **Sí está versionado** — desde el commit inicial del repo, pese a lo que decía esta línea hasta 2026-08-11. Tenerlo en git hace que el registry viaje con el código, pero conviene saber dos cosas: se regenera con `gentle-ai skill-registry refresh --force` y su contenido incluye **rutas absolutas de la máquina que lo generó** (`C:\Users\...`), visibles en un repo público. Si eso molesta, la salida es gitignorearlo y que cada máquina lo regenere.

## Roadmap de Changes

44 entradas en 13 fases — índice completo en [`CHANGES.md`](CHANGES.md). **38 archivadas, 6 pendientes.**

**MVP (C-01 → C-27): COMPLETO.** El sistema es funcional en producción desde C-13 (cuenta corriente de proveedores). C-14/C-15 cerraron la IA de visión; C-15a…C-27 fueron housekeeping, fixes y cierre de deudas. El rediseño de UX/UI se entregó fuera de la numeración de changes.

**Etapa actual — evolución a sistema de gestión (C-28 → C-39).** Decidida el 2026-08-09, documentada en D-27 a D-38. La app deja de ser "registro de facturas a proveedores" y pasa a ser un mini sistema para negocios chicos: equipo multi-usuario sobre un mismo local, clientes con fiado, ventas y analítica. **El proyecto se renombrará** cuando la etapa esté encaminada.

**Camino crítico de la etapa:** `C-28 negocio-scoping → C-32 clientes-back → C-33 ventas-back → C-34 ventas-front → C-35 cc-clientes-back → C-36 cc-clientes-front → C-39 exportación`, con `C-29/C-30/C-31` (equipo + recuperación de contraseña) y `C-37/C-38` (estadísticas) en paralelo.

**Próximo change:** `C-36-cuenta-corriente-clientes-frontend` → `/opsx:propose C-36-cuenta-corriente-clientes-frontend`. Sus dos dependencias (C-34 y C-35) están archivadas, así que el gate está abierto.

> ✅ **C-28 archivado el 2026-08-09**: el eje de aislamiento ya es `negocio_id` en todo el sistema. Lo sostiene el test estructural `tests/test_c28_scoping_axis_guard.py`, que recorre el AST de `services/` y `repositories/` y falla si `usuario_id` reaparece como filtro fuera de la lista blanca. Ese guard está parametrizado sobre los archivos que encuentra: agregar o quitar un archivo en esos directorios **cambia el conteo de tests colectados**, y no es un error.

> ⚠️ **Pendiente de C-43**: `pagos`, `facturas` y `cobros` **no deduplican**. C-42 dejó ventas a salvo y agregó un timeout de 20s que empeora la exposición de esos tres — hoy solo los cubre una copia interina que avisa de revisar el listado antes de reintentar.

## Reglas Duras (específicas del proyecto)

> Reglas globales ya definidas en `~/.claude/CLAUDE.md` (orquestador, governance, TDD estricto, engram, conventional commits, no co-autoría, response-length): el proyecto las **hereda**. Acá viven solo las reglas específicas de este proyecto.

**🔴 Invariantes de negocio (violarlas rompe el sistema):**
1. **NUNCA** persistir `saldo` ni `estado` de factura → siempre calcular on-demand (RN-SALDO, RN-FIFO). No agregar columnas para estos valores.
2. **NUNCA** vincular un Pago a una Factura → no existe `factura_id`; el pago se asocia solo al proveedor (RN-PAG-01).
3. **NUNCA** consultar/modificar un recurso de negocio sin filtrar por **`negocio_id`** en el **service layer** → recurso ajeno devuelve **404** (no 403). Vigente desde C-28 (D-27).
   - `usuario_id` sigue siendo correcto SOLO donde significa **identidad**: `usuario_service`, `usuario_repository`, `refresh_token*`, el claim `sub` de `security.py` y el cupo por usuario de `rate_limit_ia` (RN-IA-07). En ningún otro lado.
   - `creado_por_usuario_id` es **autoría, nunca autorización**. No filtrar acceso con ese campo.
   - Lo bloquea el test `tests/test_c28_scoping_axis_guard.py`: recorre el AST de `services/` y `repositories/` y falla si `usuario_id` reaparece como filtro fuera de esa lista blanca.
4. **NUNCA** dejar que la IA invente, persista o asigne un proveedor → la IA propone, el humano confirma (RN-IA-03/04/06).
5. **NUNCA** registrar un fiado dos veces (D-33) → el fiado **no** es una tabla aparte: es una `Venta` con `forma_pago = CUENTA_CORRIENTE` + `cliente_id`. Y el cobro de una cuenta corriente **no** escribe en `venta` (D-34).
6. **NUNCA** permitir saldo a favor en la cuenta corriente de un cliente (D-37) → un cobro no puede superar el saldo pendiente. Validado en el service layer.
7. **NUNCA** dejar un negocio sin admin activo (RN-NEG-08) → un admin no puede desactivarse a sí mismo si es el último.

**🟡 Arquitectura y stack:**
8. La autorización y el cálculo de saldo/estado viven en el **service layer** → NUNCA en router ni en repository.
9. **NUNCA** confiar solo en la validación del frontend → validar todo con **Pydantic** en backend (monto>0, fechas no futuras UTC-3, CUIT, enums).
10. **Python**: snake_case + type hints. **TS/React**: PascalCase en componentes, prohibido `any`, tsconfig estricto.
11. Montos `numeric(12,2)` en **ARS**; fechas en **UTC-3**. Sin multi-moneda, sin IVA.

**🟢 Testing y seguridad:**
12. Tests con **Postgres real/contenedor** → NUNCA SQLite. Servicios externos (Cloudinary, modelo de visión) **siempre mockeados**.
10. Secretos en **variables de entorno**, nunca commiteados (`.env` en `.gitignore`).

**Recordatorio:** resolver **Q-01 (id UUID vs serial)** antes de escribir el primer modelo.

## Flujo de Trabajo

```
knowledge-base/ (qué construir)  →  CHANGES.md (en qué orden)
   →  /opsx:propose <change>  →  /opsx:apply  →  /opsx:archive
```

Ante cualquier duda de negocio: la KB manda. Si la KB no lo cubre, está en `10_preguntas_abiertas.md` o fuera de alcance — **no asumir ni inventar**.
