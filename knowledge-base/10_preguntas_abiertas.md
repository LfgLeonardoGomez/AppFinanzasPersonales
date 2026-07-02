# 10 · Preguntas Abiertas

> Inconsistencias detectadas y decisiones pendientes durante la ingesta de `docs/`. Priorizadas: 🔴 bloqueante para implementar · 🟡 conviene resolver pronto · 🟢 puede esperar.

## Decisiones de implementación pendientes

| # | Prioridad | Pregunta | Contexto |
|---|---|---|---|
| ~~Q-01~~ | ✅ RESUELTA | **`id` = UUID (preferir UUIDv7).** Razón: resistencia a enumeración (alineado con el baseline de seguridad: 404 sin revelar existencia); v7 time-ordered evita fragmentación de índice y alinea el desempate FIFO `(…, id)` con el orden de inserción. | Decidido 2026-06-19. Ver D-16 en `09_decisiones_y_supuestos.md`. |
| ~~Q-02~~ | ✅ RESUELTA | **¿JWT puro o tokens opacos revocables?** | Decidido por C-03: access = JWT stateless, refresh = opaco con hash + `revoked_at` + rotación. Ver D-17 en `09_decisiones_y_supuestos.md`. |
| Q-03 | 🟡 | **¿Despliegue con proxy/rewrite o CORS?** | El doc recomienda rewrite (cookie de primera parte), con CORS como fallback. Confirmar la estrategia define la config de cookies y si hace falta `FRONTEND_ORIGIN`/`COOKIE_DOMAIN`. |
| ~~Q-04~~ | ✅ RESUELTA | **TTL concretos de access/refresh token.** | Decidido por C-03: configurables vía env (`ACCESS_TOKEN_TTL_MIN`, `REFRESH_TOKEN_TTL_DAYS`), defaults sugeridos 30 min / 30 días. Ver spec `openspec/specs/auth-backend/spec.md`. |
| ~~Q-05~~ | ✅ RESUELTA | **Tamaño máximo exacto de archivos.** | Decidido por C-05 / C-14 / C-15: 10 MB para todos los uploads (avatar, factura, comprobante, imagen IA). Validado en backend con magic bytes (no `Content-Type`). Ver specs `perfil-usuario-api`, `ia-vision-backend`, `perfil-usuario-frontend`. |

## Preguntas nuevas / desviaciones detectadas durante el sync 2026-06-29

| # | Prioridad | Pregunta | Contexto |
|---|---|---|---|
| Q-06 | 🟡 | **¿Cuándo se resuelve el lint roto del frontend (`facturas-proveedores-web`)?** | ESLint v10 vs config v9, carry-over de c-13. Documentado como D-24 en `09_decisiones_y_supuestos.md` (deferido, fuera de alcance para cualquier change posterior). Pregunta abierta: ¿se arregla en un housekeeping futuro o se acepta el estado actual? |

## Inconsistencias / puntos a vigilar

- **Filtro por estado en SQL:** el estado de factura NO es columna; el filtro debe aplicarse en el service layer tras calcular FIFO (RN-FAC-09). Riesgo de que un implementador intente un `WHERE estado=...` directo. **Vigilar en code review.**
- **Performance del listado de proveedores:** el saldo por proveedor debe resolverse con **una** query agregada (`GROUP BY`), no una query por fila. El estado FIFO sí se calcula en memoria por proveedor. Vigilar N+1.
- **PDF vs imagen en IA:** la extracción IA corre solo sobre **imágenes** en el MVP; el PDF se guarda pero se carga a mano. Varios modelos leen PDF directo — tentación de habilitarlo antes de tiempo. Queda como mejora futura detrás de la misma interfaz.
- **`nombre` de proveedor no único:** la vinculación por nombre (RN-VINC) puede devolver varias coincidencias; el flujo de sugerencias debe manejar el caso de múltiples matches sin asumir el primero.

## Notas de alcance (recordatorios)

- La IA **no** extrae items ni crea proveedores: cualquier feature que lo sugiera está fuera del MVP.
- No asumir notificaciones de vencimiento: el doc dice explícitamente "no especificado aún, no asumir nada".
- Recuperación de contraseña por email está fuera del MVP; durante el MVP se resuelve en base de datos manualmente.
