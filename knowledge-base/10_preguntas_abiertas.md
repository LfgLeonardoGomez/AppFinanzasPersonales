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

## Preguntas nuevas — C-42 (idempotencia de registro de venta)

| # | Prioridad | Pregunta | Contexto |
|---|---|---|---|
| Q-07 | 🟡 | **¿20 segundos es el tiempo correcto de espera para alguien atendiendo el mostrador?** | `apiClient` tiene `timeout: 20000` (D-66), razonado contra el perfil del endpoint (~40x su p99 en caliente), no medido contra el VPS real bajo datos móviles. Si en uso real aparece que 20s es largo (la persona ya se cansó y reintentó a mano antes de que el timeout dispare) o corto (se corta una request que iba a salir bien), ajustar con evidencia real, no con otra estimación. |
| Q-08 | 🟢 | **¿La persistencia de la clave de idempotencia en `sessionStorage` (D-62) vale su complejidad?** | Cubre el caso de un reload de pestaña o una pestaña matada por el sistema operativo entre el intento fallido y el reintento — parte del escenario que motivó C-42 — a cambio de un módulo aparte (`src/shared/api/idempotency.ts`) y su manejo de errores. Está deliberadamente aislado en su propio grupo de tasks para poder sacarse sin desarmar el resto del mecanismo; sacarlo reabre esa ventana (solo el reload/cierre de pestaña, no el caso general de reintento con la app abierta). |

## Preguntas nuevas — revisión adversarial de C-42 (2026-08-15, findings no-CRITICAL dejados a decisión humana)

Tres hallazgos de la revisión 4R no se arreglaron junto con los seis que sí (commits `9c7e3c2` / `eb9e980`) porque implican un tradeoff de negocio o de infraestructura que no le corresponde decidir a quien implementa. Quedan registrados acá para que no se pierdan ni se cierren en silencio.

| # | Prioridad | Pregunta | Contexto |
|---|---|---|---|
| Q-09 | 🟡 | **¿El payload completo de una venta pendiente (`monto`, `cliente_id`, `notas`) debería viajar sin cifrar en `sessionStorage`?** | `idempotency.ts` guarda `{ key, payloadJson }` en texto plano para poder comparar el intento nuevo contra el pendiente (D-62/D-7 del design). En una compu compartida de mostrador, cualquier extensión de navegador o persona con acceso físico a la pestaña puede leerlo mientras el intento sigue pendiente. Es el mismo dato que ya viaja por la red sin cifrar en el POST, así que no es una fuga nueva de superficie — pero sí es persistencia nueva en un medio que otras extensiones del navegador pueden leer. Decisión pendiente: ¿vale la pena cifrar o hashear el payload guardado, o el riesgo es aceptable dado el contexto de uso (POS de mostrador, sesión corta)? |
| Q-10 | 🟡 | **¿El índice único de idempotencia debería crearse con `CONCURRENTLY`?** | La migración de C-42 agrega `UNIQUE (negocio_id, idempotency_key) WHERE idempotency_key IS NOT NULL` sobre `venta` con `CREATE UNIQUE INDEX` estándar, que toma un `ACCESS EXCLUSIVE lock` mientras se construye — bloquea lecturas y escrituras sobre la tabla de ventas, que es de las que más tráfico recibe en producción. `CONCURRENTLY` evita el lock exclusivo a cambio de no poder correr dentro de una transacción y de un manejo de fallos distinto (deja un índice `INVALID` que hay que limpiar a mano si se corta a la mitad). Con la tabla todavía chica el bloqueo es breve, pero la decisión de cuándo dejar de ser aceptable es de infraestructura, no de código. |
| Q-11 | 🟡 | **¿Hace falta `lock_timeout` / `statement_timeout` en Postgres dado el VPS de 1GB con pool compartido?** | Ninguna de las dos está seteada. Sin `lock_timeout`, una request que queda esperando el lock de la fila concurrente (mismo mecanismo que el índice de idempotencia usa a propósito, ver D-63) puede esperar indefinidamente si algo más retiene una transacción más de lo esperado, agotando el pool de conexiones compartido en una instancia de 1GB RAM donde ya no hay margen. `apiClient` tiene un `timeout: 20000` del lado del cliente (D-66) pero eso corta la espera del navegador, no libera la conexión ni el lock del lado de Postgres. Decisión de infraestructura pendiente, no específica de C-42: valores razonables de `lock_timeout`/`statement_timeout` a nivel de conexión o de rol. |

## Deuda técnica descubierta (no es de C-42, pero se encontró mirándolo)

- **El backend no le pone `timeout` a la llamada al proveedor de visión.** Hasta ahora no había techo de ningún lado (ni cliente ni servidor); después de C-42 el frontend le puso 120s (D-66), pero el SDK del proveedor de IA en el backend sigue sin límite propio. Si el proveedor se cuelga, la request del backend puede quedar viva más allá de los 120s que el frontend está dispuesto a esperar — el frontend simplemente reportaría "desconocida" y el backend seguiría procesando. No bloquea nada; queda para cuando se toque `app/services/vision_provider` (o equivalente) de nuevo.

## Inconsistencias / puntos a vigilar

- **Filtro por estado en SQL:** el estado de factura NO es columna; el filtro debe aplicarse en el service layer tras calcular FIFO (RN-FAC-09). Riesgo de que un implementador intente un `WHERE estado=...` directo. **Vigilar en code review.**
- **Performance del listado de proveedores:** el saldo por proveedor debe resolverse con **una** query agregada (`GROUP BY`), no una query por fila. El estado FIFO sí se calcula en memoria por proveedor. Vigilar N+1.
- **PDF vs imagen en IA:** la extracción IA corre solo sobre **imágenes** en el MVP; el PDF se guarda pero se carga a mano. Varios modelos leen PDF directo — tentación de habilitarlo antes de tiempo. Queda como mejora futura detrás de la misma interfaz.
- **`nombre` de proveedor no único:** la vinculación por nombre (RN-VINC) puede devolver varias coincidencias; el flujo de sugerencias debe manejar el caso de múltiples matches sin asumir el primero.

## Notas de alcance (recordatorios)

- La IA **no** extrae items ni crea proveedores: cualquier feature que lo sugiera está fuera del MVP.
- No asumir notificaciones de vencimiento: el doc dice explícitamente "no especificado aún, no asumir nada".
- Recuperación de contraseña por email está fuera del MVP; durante el MVP se resuelve en base de datos manualmente.
