# Knowledge Base — CHANGELOG

> Registro de cambios de la **KB** (no del código). Los cambios de código se trackean en `CHANGES.md` (raíz del repo) y en `openspec/changes/`.

## 2026-06-29 — Sync post-MVP completo (chronicle · Mode Update)

Sync no-destructivo ejecutado tras archivar los 17 changes del MVP (c-01..c-17 + c-15a). El KB original (10 archivos, 2026-06-19) se basaba en los 6 docs de `docs/`; este sync lo actualiza al estado **real** del código.

### Cambios por archivo

| Archivo | Tipo de cambio | Detalle |
|---|---|---|
| `01_vision_y_objetivos.md` | update | Marcado MVP completo (2026-06-29); cada item del alcance con su change archivado y fecha |
| `02_descripcion_general.md` | update | Auth detallada (JWT access + refresh opaco con hash y rotación); sección "Estado de testing" post-c-17 |
| `03_actores_y_roles.md` | append | Tabla de endpoints autenticados (auth, perfil, proveedores, facturas, pagos, cc, cloudinary) |
| `04_modelo_de_datos.md` | append | Nueva entidad `RefreshToken` (C-03, tabla `refresh_token`); ERD actualizado; notas sobre `origen` client-sent |
| `05_reglas_de_negocio.md` | append + update | Nuevas reglas `RN-PAG-06`, `RN-AUTH-01..08`, `RN-IA-07`, `RN-IA-08`, `RN-TEST-01`; `RN-FAC-08` y `RN-IA-04` actualizados con D-18 (Path B) |
| `06_funcionalidades.md` | update + append | F-FAC-04 y F-PAG-03 marcados ✅ (IA implementada); nueva épica "Carga con IA" (F-IA-MODAL-01..04); nueva épica "Testing" (F-TEST-01) |
| `07_flujos_principales.md` | update + append | Flujo 4 reescrito: IA implementada con modal bloqueante y Path B; Flujo 7 (rotación de refresh); Flujo 8 (errores del extractor) |
| `08_arquitectura_propuesta.md` | append | Sección "Patrón de test pollution fix (c-16, c-17)" con root cause, fix y suite de regresión; nota de lint deferido (D-24) |
| `09_decisiones_y_supuestos.md` | append | D-17 (tokens opacos), D-18 (origen Path B), D-19..D-24 (c-15 modal, c-16 settings proxy, lazy engine, alembic 0003, c-17 fix, lint deferral) |
| `10_preguntas_abiertas.md` | update | Q-02, Q-04, Q-05 marcadas ✅ (resueltas por C-03 / C-05 / C-14); Q-03 sigue abierta; nueva Q-06 (cuándo arreglar lint roto) |
| `README.md` | update | Índice actualizado; nota "MVP completo al 2026-06-29"; changelog linkeado |

### Drift principal detectado y resuelto

1. **`RefreshToken` no documentado** (tabla `refresh_token` con `token_hash`, `revoked_at`, `expires_at` agregada por C-03). → Agregado a `04` + reglas `RN-AUTH-02..05` en `05`.
2. **`origen=IA` se enviaba mal modelado en el KB** (asumía "el backend lo setea"). La realidad post-c-15a es **Path B**: el cliente lo envía tras confirmar el modal, el service lo persiste con fallback a `MANUAL`. → Corregido en `04` (notas de Factura/Pago), `05` (RN-FAC-08, RN-PAG-06, RN-IA-04), `06` (F-FAC-04 / F-PAG-03), `07` (Flujo 4), `09` (D-18).
3. **Carga con IA marcada como "se implementa al final"** en 3 lugares (01, 05 RN-IA-04, 06 F-FAC-04/F-PAG-03, 07 Flujo 4). → Marcada ✅ implementado en todos, con flujo detallado.
4. **Test pollution fix de c-17 no documentado.** El problema + root cause + fix + suite de regresión viven en `openspec/changes/archive/2026-06-29-c-17-fix-test-pollution/known-debt-resolved.md` pero la KB no lo mencionaba. → Agregado a `02` (estado de testing), `05` (RN-TEST-01), `06` (F-TEST-01), `08` (sección dedicada), `09` (D-22, D-23).
5. **Q-02 / Q-04 / Q-05 ya resueltas** (C-03 eligió tokens opacos con rotación; TTLs por env var; 10 MB confirmado en specs). → Marcadas ✅ y movidas a `09` como D-17 o resueltas con referencia al spec.
6. **Lint roto del frontend no documentado** (carry-over de c-13, ESLint v10 vs config v9). → Documentado en `08` (nota) y `09` (D-24, deferido); abierto como Q-06 en `10`.

### Decisiones agregadas (D-17 a D-24)

| # | Decisión | Origen |
|---|---|---|
| D-17 | Tokens opacos con rotación + revocación server-side | C-03 (resuelve Q-02) |
| D-18 | `origen='IA'` lo envía el cliente, no el backend (Path B) | C-15a (resuelve OQ-1) |
| D-19 | Modal de IA bloqueante | C-15 (UX) |
| D-20 | Settings proxy + lazy engine | C-16 D-1/D-2 |
| D-21 | Tests de alembic apuntan a revisions específicas | C-16 D-4 |
| D-22 | Suite de regresión AST para test pollution | C-17 |
| D-23 | Fix de pollution en el consumer, no en la fuente | C-17 |
| D-24 | Lint del frontend deferido (ESLint v10 vs v9) | carry-over de C-13 |

### Reglas de negocio agregadas (RN-XX)

| Código | Dominio | Resumen |
|---|---|---|
| `RN-PAG-06` | Pagos | `origen` se persiste tal cual el cliente envía, con fallback a `MANUAL` |
| `RN-AUTH-01` | Auth | Access token JWT stateless |
| `RN-AUTH-02` | Auth | Refresh token opaco, solo se guarda su hash SHA-256 |
| `RN-AUTH-03` | Auth | Validez: `revoked_at IS NULL AND expires_at > now()` |
| `RN-AUTH-04` | Auth | Rotación obligatoria en cada refresh |
| `RN-AUTH-05` | Auth | Logout revoca refresh y borra cookies |
| `RN-AUTH-06` | Auth | Rate limit 5/60s por IP en login y registro |
| `RN-AUTH-07` | Auth | Passwords con argon2id, mín 8 chars |
| `RN-AUTH-08` | Auth | `get_current_user` provee `usuario_id`; service layer filtra; 404 ante recurso ajeno |
| `RN-IA-07` | IA | Rate limit 10/hora por `usuario_id` (no IP); 429 + Retry-After |
| `RN-IA-08` | IA | Modal bloqueante, oculto en edit mode |
| `RN-TEST-01` | Testing | Invariante de module-identity para fixtures de integración |

### Preguntas abiertas residuales

| ID | Pregunta | Acción recomendada |
|---|---|---|
| Q-03 | ¿Despliegue con proxy/rewrite o CORS? | Resolver antes de subir a prod (afecta config de cookies) |
| Q-06 | ¿Cuándo arreglar el lint roto del frontend? | Decidir si housekeeping futuro o aceptar estado actual |

### Idempotencia y cobertura

- **No se eliminó contenido válido.** Solo se actualizó lo que había drift.
- **No se restructuró ningún nodo.** `05` y `06` crecieron pero no cruzaron el umbral de promoción a carpeta (reglas y features siguen en archivo único).
- **Cobertura de citas:** todas las citas `[code · …]` agregan referencias a archivos verificables en el repo; las decisiones D-XX que vienen de specs `openspec/specs/*/spec.md` quedan marcadas como tales.
