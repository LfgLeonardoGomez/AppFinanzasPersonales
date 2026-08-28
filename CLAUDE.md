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

44 entradas en 13 fases — índice completo en [`CHANGES.md`](CHANGES.md). **42 archivadas, 2 pendientes.**

**MVP (C-01 → C-27): COMPLETO.** El sistema es funcional en producción desde C-13 (cuenta corriente de proveedores). C-14/C-15 cerraron la IA de visión; C-15a…C-27 fueron housekeeping, fixes y cierre de deudas. El rediseño de UX/UI se entregó fuera de la numeración de changes.

**Etapa actual — evolución a sistema de gestión (C-28 → C-39).** Decidida el 2026-08-09, documentada en D-27 a D-38. La app deja de ser "registro de facturas a proveedores" y pasa a ser un mini sistema para negocios chicos: equipo multi-usuario sobre un mismo local, clientes con fiado, ventas y analítica. **El proyecto se renombrará** cuando la etapa esté encaminada.

**Camino crítico de la etapa:** `C-28 ✓ → C-32 ✓ → C-33 ✓ → C-34 ✓ → C-35 ✓ → C-36 ✓ → C-39 ✓`, con `C-29/C-30/C-31` (equipo + recuperación de contraseña, todos ✓) y `C-37 ✓ / C-38` (estadísticas) en paralelo. **El camino crítico está cerrado**: `C-37`, `C-39` y `C-43` se archivaron el 2026-08-25 (commit `155bcd3`). **Cero changes activos.**

**Pendientes:**
- `C-38` **estadisticas-frontend** — **implementado el 2026-08-26** (ver nota abajo), resta `/opsx:archive`.
- `C-41` **api-types-generated** — tipos TS generados desde OpenAPI; deuda detectada en `C-30`. Sin empezar.

> ✅ **C-28 archivado el 2026-08-09**: el eje de aislamiento ya es `negocio_id` en todo el sistema. Lo sostiene el test estructural `tests/test_c28_scoping_axis_guard.py`, que recorre el AST de `services/` y `repositories/` y falla si `usuario_id` reaparece como filtro fuera de la lista blanca. Ese guard está parametrizado sobre los archivos que encuentra: agregar o quitar un archivo en esos directorios **cambia el conteo de tests colectados**, y no es un error.

> ✅ **C-43 archivado el 2026-08-25**: `pagos`, `facturas` y `cobros` deduplican **de punta a punta**. Fase A (backend, 2026-08-16) puso la columna, el índice único parcial y la lectura por clave; Fase B (frontend, 2026-08-25) cableó la `Idempotency-Key` en `pagosApi`, `facturasApi` y `cobrosApi`, y los cuatro estados de resultado en la UI. Un reintento del usuario ya no crea un duplicado.
>
> **Cobros no sigue la receta de C-42, y es a propósito.** `CobroClienteService._saldo_disponible` es una validación **stateful** (resta los cobros ya persistidos), y corre *antes* del INSERT. Con el orden de C-42 (validar → insertar → atrapar `IntegrityError`), una repetición legítima evalúa el saldo ya consumido por el cobro original y muere en `422` sin llegar nunca al INSERT que la habría reconocido: saldar una cuenta entera fallaría siempre. Por eso cobros hace el **lookup por clave ANTES de validar el saldo** (D-69). Regla general: el patrón "validar → insertar → atrapar conflicto" solo es seguro si toda validación previa es *stateless* respecto del recurso que se crea.
>
> ⚠️ **`PagoForm` y `FacturaForm` son SOLO modo edición** (descubierto en Fase B, D-73/D-74). El camino real de creación de pagos y facturas es `features/ia-vision/components/CargaModal.tsx`, montado por `CreatePagoPage` y `CreateFacturaPage`. Consecuencias que hay que tener presentes antes de tocar cualquiera de los tres:
> - El copy conservador de esos dos formularios ("revisá el listado antes de reintentar") **NO es interino y no se retira**: el `PATCH` que emiten no manda clave y no está protegido. Ahí ese copy es el correcto. **No lo "arregles" copiando el wording del `CargaModal`.**
> - Quien manda la clave y promete que reintentar es seguro es el `CargaModal`. La regla general: solo un formulario que efectivamente manda la clave puede hacer esa promesa; cualquier escritura que no la mande hereda el copy conservador.
>
> ⚠️ **La respuesta de una repetición puede diferir de la original** (D-70, RN-FAC-11). El `estado` de una factura se recalcula sobre el pool FIFO actual, así que una repetición puede devolver `PARCIAL` donde el original devolvió `PENDIENTE`. Es correcto: `estado` es derivado y nunca persistido. La garantía es "no se creó una segunda fila", **no** "recibís los mismos bytes".

> ✅ **C-38 implementado (2026-08-26) y verificado contra la API real (2026-08-28) — frontend puro, cero cambios en el backend. Resta `/opsx:archive`.** Nueva ruta `/estadisticas` + panel de compras montado en la ficha de proveedor. Suite frontend 903 → **1005 passed** (125 archivos), `tsc`/`eslint` limpios. Detalle en `knowledge-base/09_decisiones_y_supuestos.md` D-85 a D-90.
>
> 🔴 **`visx` (SVG) es la librería de gráficos, y canvas está PROHIBIDO — no es una preferencia estética** (D-85). Los tests corren en `environment: 'jsdom'` (`vite.config.ts:84`) y **no está instalado el paquete `canvas`**: ahí `getContext('2d')` devuelve `null`, así que un gráfico de canvas no dibuja nada afirmable y lo único "testeable" sería un mock — la clase de test tautológico que este repo ya cazó y borró una vez. Tampoco hay Playwright ni tier e2e donde compensarlo. **Si alguien viene a "optimizar" cambiando visx por uPlot o Chart.js: eso deja la pantalla sin verificar.** Se instalan `@visx/shape` y `@visx/scale` sueltos, nunca el meta-paquete `visx`.
>
> ⚠️ **Las estadísticas tienen ruta propia por una colisión real de search params** (D-86). `VentasPage.tsx:25-26` ya usa `desde`/`hasta` con el significado "filtrá la lista de ventas" (default HOY). Meter las estadísticas ahí pondría dos significados sobre los mismos dos parámetros de la misma URL: movés el rango del gráfico y se te filtra la lista. **No consolides `/estadisticas` dentro de `/ventas`.** `features/ventas/` quedó intacta y hay una tarea que lo verifica.
>
> ⚠️ **Pydantic v2 manda los `Decimal` como STRING, no como número.** El design de C-38 decía lo contrario y se corrigió durante el apply, ejecutando Pydantic contra el backend en vez de transcribir de memoria. Los decimales se parsean en el límite (`estadisticasParse.ts`, patrón de `parseCuentaCorriente`) y un `NaN` **lanza**, nunca degrada a `0` (D-88): en estadísticas un cero fabricado es indistinguible de un período legítimo sin movimiento, así que degradar dibujaría una mentira plausible.
>
> 🐳 **Si la API no levanta con `ModuleNotFoundError`, la imagen del contenedor quedó vieja — no es un bug del código.** Pasó el 2026-08-28: `facturas_api` moría con `No module named 'xlsxwriter'`, una dependencia que **C-39 agregó a `pyproject.toml`** y que la imagen construida antes de ese change no tenía. Se arregla con `docker compose build api`. Regla: **después de archivar un change que suma dependencias de Python, reconstruir la imagen** — `docker compose up -d` sola reutiliza la imagen vieja y el fallo aparece mucho después, en un change que no tiene nada que ver.

> ⚠️ **Los tipos de estadísticas en `api.d.ts` están escritos A MANO** porque `C-41` sigue pendiente. Los blinda `api.estadisticas.test-d.ts` (compile-time, lo dispara `tsc --noEmit`; verificado por mutación). Cuando C-41 genere los tipos desde OpenAPI, ese archivo es el que va a avisar si difieren.

> ✅ **C-37 archivado el 2026-08-25 (backend puro).** Tres endpoints de solo lectura (`GET /api/estadisticas/compras|ventas|resumen`), todo por agregación SQL on-demand (RN-VTA-05), cero columnas nuevas, cero dependencias nuevas. `app/services/estadisticas_engine.py` es el único motor compartido (bucketing + relleno de huecos, D-75) — compras y ventas conservan cada una su propia query porque una necesita filtro por `proveedor_id` y la otra desglose por `forma_pago`.
>
> **Corrección al roadmap original:** el scope pedía tests de "zona horaria UTC-3 en los cortes de período". Ese problema no existe — `venta.fecha` y `factura.fecha_emision` son columnas `date`, sin hora ni zona, así que agrupar por día/semana/mes es aritmética de fechas pura. Agregar una conversión ahí **introduciría** el bug que se buscaba evitar: desplazaría de período los movimientos cercanos a un borde, de forma sistemática e invisible (D-78). Si alguien viene a "arreglar" esto: no está roto, no lo toques.
>
> **La trampa de dominio que este change existe para blindar** (D-77, RN-EST-01): un cobro de cuenta corriente **no** es una venta (RN-VTA-04) — ya se contó como venta el día que salió la mercadería (RN-VTA-02); sumarlo de nuevo duplica la facturación y el número queda más alto, pero plausible, así que nadie lo nota mirando la pantalla. Simétricamente, un pago **no** es una compra: la factura es la compra, el pago la cancela. `EstadisticasRepository` no importa `Pago` ni `CobroCliente` — verificado con un test que falla por mutación si alguien los agrega a la suma.
>
> `test_c28_scoping_axis_guard.py` subió de 40 a 46 tests colectados (3 archivos nuevos en `services/`/`repositories/` × 2 tests parametrizados). Esperado, no una sorpresa.
> ✅ **C-39 archivado el 2026-08-25.** Cierra el camino crítico de la etapa. Dos endpoints (`GET /api/proveedores/{id}/cuenta-corriente/export`, `GET /api/clientes/{id}/cuenta-corriente/export`), formato `pdf` o `xlsx`, historial opcional con rango. El export **no recalcula nada** — reutiliza `ProveedorService.get_cuenta_corriente`/`ClienteService.get_cuenta_corriente` (D-80); con rango, el `saldo anterior` se **lee** de una fila que el historial ya trae, nunca se suma (D-81). `fpdf2` + `xlsxwriter` por el límite de 1 GB del VPS (D-82); tope de filas por formato en vez de job asíncrono (D-83, valores conservadores: PDF 500, XLSX 5000, sin medir contra el contenedor real todavía). Detalle completo en `knowledge-base/09_decisiones_y_supuestos.md` D-80 a D-84 y `knowledge-base/05_reglas_de_negocio.md` §Dominio: Exportación de cuenta corriente.
>
> **Hallazgo que corrige un supuesto del design**: D4 asumía que declarar la ruta de export después del catch-all `/{id}` la dejaría inalcanzable en silencio, igual que `/buscar` vs `/{id}`. Verificado por mutación real (mover el bloque de código y repetir la request): **no pasa** — Starlette ancla cada ruta por cantidad de segmentos, y una ruta de 3 segmentos (`/{id}/cuenta-corriente/export`) nunca puede ser shadowed por una de 1 segmento (`/{id}`), sin importar el orden. La ruta se dejó declarada antes de `/{id}` igual, por consistencia con el patrón existente — pero el riesgo real solo aparece entre rutas de **igual** cantidad de segmentos (una literal, una parámetro), no en este par. Ver D-84.

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
