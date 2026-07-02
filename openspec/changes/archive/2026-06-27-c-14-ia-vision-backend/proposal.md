# Proposal: c-14-ia-vision-backend

## Why

El flujo manual de carga de facturas y pagos está completo y funcionando en producción desde C-13
(cuenta-corriente-frontend archivada). El siguiente valor para el usuario es **reducir la fricción de
carga** permitiéndole fotografiar una factura o un comprobante de pago y obtener un formulario
prellenado. Esto completa el cierre del MVP definido en el CHANGES.md: el último bloque funcional del
roadmap de 15 changes.

C-15 (`ia-vision-frontend`, bloqueado hasta que este change esté aplicado) consume los endpoints que
este change define. Sin este backend, no hay forma de invocar la IA desde la app, y los
`ProveedorAutocomplete` (C-07), `FacturaFormPage` (C-09) y `PagoFormPage` (C-11) no pueden exponer el
flujo "Cargar con imagen".

La decisión de **IA al final** (D-14) está tomada: el core del producto no depende de la IA y la carga
manual sigue siendo el camino canónico. Este change **agrega** sin modificar el flujo manual
existente, y se construye sobre los routers y modelos de C-08 (facturas) y C-10 (pagos).

## What Changes

- Agrega `app/services/ia_extraccion_service.py` con la interfaz `VisionExtractor` (Protocol) y dos
  implementaciones: `ClaudeVisionExtractor` y `OpenAIVisionExtractor`. Una factory
  `get_vision_extractor()` resuelve la implementación según `settings.VISION_PROVIDER`.
- Agrega las propuestas Pydantic `PropuestaFactura` y `PropuestaPago` en `app/schemas/factura.py` y
  `app/schemas/pago.py` respectivamente. Todos los campos son `Optional` y se serializan como
  `None` cuando la IA no puede leerlos (RN-IA-03). **No son `SQLModel`** — son `BaseModel` puros
  de request/response, nunca se persisten.
- Agrega rate limiter **por `usuario_id`** en `app/core/rate_limit_ia.py`: 10 req/hora por usuario
  autenticado sobre los endpoints `/extraer-ia`. El rate limit de auth (5/60s por IP, C-03) no
  aplica a estos endpoints (criterio distinto: costo externo + riesgo de fuga de API key).
- Extiende `app/routers/facturas.py` con `POST /api/facturas/extraer-ia` (multipart, image-only).
  Llama al extractor, **nunca persiste**, devuelve `PropuestaFacturaEnvelope` con flag
  `error: bool` y `error_message: str | None` (RN-IA-05). El endpoint se registra **antes** de
  `GET /api/facturas/{factura_id}` para que la ruta estática no sea capturada por el path param.
- Extiende `app/routers/pagos.py` con `POST /api/pagos/extraer-ia` con el mismo contrato
  simétrico: `PropuestaPagoEnvelope` y `error: bool`.
- Agrega un test de **regresión de no-persistencia**: un listener SQLAlchemy `before_flush`
  captura cualquier INSERT/UPDATE/DELETE sobre `factura`, `factura_item` y `pago` durante la
  llamada a `/extraer-ia`; el test asserta `len(events) == 0` (RN-IA-04).
- Agrega tests unitarios para las propuestas Pydantic, los extractores con SDK mockeado
  (`anthropic.Anthropic` / `openai.OpenAI`), la factory y el rate limiter.
- Agrega tests de integración con FastAPI TestClient: 200 éxito, 200 con todos los campos `None`
  (IA devolvió `null` o el extractor falló), 200 con `error: true` y campos `None`, 401 sin
  sesión, 429 rate-limited, 422 tipo de archivo no permitido.
- **NO** modifica `app/models/factura.py`, `app/models/pago.py`, `FacturaService`, `PagoService`,
  `ProveedorService`, la cuenta corriente, ni ninguna migración Alembic. La IA no toca el
  esquema: solo agrega superficie HTTP de propuesta.
- **NO** modifica `facturas-proveedores-web/`. C-15 lo hace.

## Capabilities

### New Capabilities

- `ia-vision-backend`: Servicio de extracción de cabeceras de facturas y pagos desde imágenes
  mediante un proveedor de visión configurable (Claude o OpenAI). Expone dos endpoints HTTP
  (`POST /api/facturas/extraer-ia` y `POST /api/pagos/extraer-ia`) que devuelven una propuesta
  Pydantic **nunca persistida**, con campos opcionales, rate limit estricto y respuesta
  graciosa ante fallo del extractor. Cubre RN-IA-01 a RN-IA-06.

### Modified Capabilities

<!-- C-08 ya dejó documentado que la extracción IA se agrega en C-14 sin cambiar la spec
     `facturas-api`. C-10 idem. C-14 ADICIONA endpoints a los routers existentes pero NO cambia
     los requirements del CRUD manual de facturas ni pagos. Por eso la lista queda vacía: los
     endpoints `/extraer-ia` viven en la nueva capability `ia-vision-backend` (no son parte de
     `facturas-api` ni `pagos-backend`). Los routers extendidos no rompen el contrato previo:
     C-08 y C-10 spec files no se modifican. -->

- *(ninguna)*

## Impact

- **Repo**: `facturas-proveedores-api` (backend). No toca el frontend.
- **New code**:
  - `app/services/ia_extraccion_service.py` — interfaz `VisionExtractor` (Protocol), `ClaudeVisionExtractor`, `OpenAIVisionExtractor`, factory `get_vision_extractor()`, prompt compartido `_build_prompt()`.
  - `app/core/rate_limit_ia.py` — sliding window por `usuario_id` (10/hora).
  - `tests/test_ia_vision_schemas.py`, `tests/test_ia_vision_extractors.py` (con SDK mockeado), `tests/test_ia_vision_factory.py`, `tests/test_ia_vision_rate_limit.py`, `tests/test_ia_vision_integration.py` (TestClient + extractor mockeado), `tests/test_ia_vision_no_persistence.py` (regresión con listener SQLAlchemy).
- **Modified code**:
  - `app/schemas/factura.py` — agrega `PropuestaFactura` y `PropuestaFacturaEnvelope` (BaseModel puro, no SQLModel).
  - `app/schemas/pago.py` — agrega `PropuestaPago` y `PropuestaPagoEnvelope` (BaseModel puro).
  - `app/routers/facturas.py` — agrega `POST /api/facturas/extraer-ia` (registrado antes de `/{factura_id}`); importa el rate limiter y la factory.
  - `app/routers/pagos.py` — agrega `POST /api/pagos/extraer-ia` (registrado antes de `/{pago_id}`); mismo patrón.
  - `tests/conftest.py` — agrega fixture `mock_vision_extractor` (inyecta un stub en el módulo del servicio) y `db_event_listener` (captura eventos `before_flush` para el test de no-persistencia).
- **Reused code**:
  - `Factura` / `Pago` SQLModel (C-02): solo se referencian sus columnas; C-14 no las modifica.
  - `FacturaService` / `PagoService` (C-08, C-10): **no se llaman**. C-14 no persiste, por lo tanto el flujo de creación (RN-IA-04) lo sigue disparando el frontend contra los endpoints existentes.
  - `get_current_user` (C-03): dependencia obligatoria en `/extraer-ia` (mismo patrón que el resto de los endpoints).
  - `settings.VISION_PROVIDER` (C-01): la factory lo lee y resuelve a `claude | openai`.
  - `get_rate_limit` y `reset_rate_limit_store` pattern de `app/core/deps.py` (C-03): se re-implementa en `rate_limit_ia.py` con clave por `usuario_id` en lugar de IP.
- **Dependencies**:
  - C-08 (facturas-backend, archivado 2026-06-21): provee el router `facturas.py` que se extiende y el modelo `Factura` cuyo `origen=IA` eventualmente podrá setearse en C-15 al confirmar.
  - C-10 (pagos-backend, archivado 2026-06-27): provee el router `pagos.py` que se extiende y el modelo `Pago` con su enum `MetodoPago` que la `PropuestaPago` referencia.
  - C-12 (cuenta-corriente-backend, archivado 2026-06-27): dependencia declarada en CHANGES.md. No es consumido directamente por C-14, pero confirma que el flujo manual completo está listo.
  - **Sin nuevas dependencias de Python**: `anthropic` y `openai` ya están en `pyproject.toml` (C-01). Se **NO** agrega `slowapi` ni `fastapi-limiter`: la decisión D-IA-02 (ver design.md) implementa el rate limiter con un sliding window in-memory custom, alineado con el patrón de `rate_limit` en `app/core/deps.py`.
- **Governance**: MEDIO (igual que el CHANGES.md). El cambio no toca invariantes críticas del dominio (no agrega columnas, no modifica cálculo de saldo ni estado FIFO), pero introduce una superficie HTTP externa y un costo monetario por request — por eso el rate limiter y el sandbox del extractor están en MEDIO, no BAJO.

## Out of scope

- Frontend del flujo IA (C-15). Este change solo expone los endpoints; C-15 construye el wizard de 3 pasos (upload → propuesta editable → confirmar contra el endpoint manual existente).
- Multi-imagen (varias fotos de la misma factura para mejorar OCR). C-14 acepta exactamente una imagen por request.
- Soporte de PDF en IA. RN-IA-01: solo imágenes en el MVP. PDF se guarda pero se carga a mano (Q-PDF-IA en `10_preguntas_abiertas.md`).
- Fine-tuning de prompts, system prompt versioning, telemetría de aciertos del extractor. C-14 usa un prompt único; la calidad de la propuesta se evalúa manualmente.
- Reintentos automáticos del extractor si el proveedor falla (timeout, 5xx). C-14 propaga el fallo como `error: true`. Un retry transparente cambiaría la latencia P99 y consumiría más API budget sin evidencia de que mejore la UX.
- Cache de propuestas. Dos requests con la misma imagen deberían poder dar respuestas diferentes (el modelo no es determinista); cachear introduce una falsa sensación de inmutabilidad.
- Streaming de la respuesta (SSE). El extractor devuelve la respuesta completa; la latencia actual (2-6 s) no justifica SSE en MVP.
- Pre-selección de proveedor en el backend. RN-IA-06: la IA solo propone un `proveedor_nombre`; el matching y la confirmación son **estrictamente del cliente** (la `ProveedorAutocomplete` del frontend hace el match normalizado por RN-VINC). El backend devuelve el nombre tal como lo leyó la IA; nunca lo cruza con `ProveedorRepository`.
- Cualquier persistencia derivada de la propuesta. C-14 no escribe filas. El `origen=IA` se setea recién cuando el usuario confirma contra `POST /api/facturas` o `POST /api/pagos` en C-15 (RN-IA-04, RN-FAC-08).
- Modificación de la spec `facturas-api` o `pagos-backend` (C-08/C-10). Los endpoints nuevos viven en la capability `ia-vision-backend` y no cambian los requirements del CRUD manual.

## Dependencies satisfied

- C-08 (facturas-backend, archivado 2026-06-21): `Factura` SQLModel, `FacturaService`, `app/routers/facturas.py` y `OrigenDocumento.IA` ya definidos en `app/models/enums.py`. C-14 extiende el router con `POST /api/facturas/extraer-ia`; **no** modifica `FacturaService`.
- C-10 (pagos-backend, archivado 2026-06-27): `Pago` SQLModel, `PagoService`, `app/routers/pagos.py` y `MetodoPago` enum disponibles. C-14 extiende el router con `POST /api/pagos/extraer-ia`; **no** modifica `PagoService`.
- C-03 (auth-backend, archivado 2026-06-21): `get_current_user` resuelve `usuario_id`; el rate limiter IA lo usa como clave (en lugar de IP).
- C-01 (foundation-setup, archivado 2026-06-19): `settings.VISION_PROVIDER` ya carga y valida el env var; `ANTHROPIC_API_KEY` y `OPENAI_API_KEY` ya están en `Settings` con default `""`.

## Hard rules (non-negotiable)

1. **NEVER** persistir `saldo` o `estado` (RN-SALDO, RN-FIFO). C-14 no toca esto; se mantiene.
2. **NEVER** agregar `factura_id` a `Pago` (RN-PAG-01). C-14 no toca esto; se mantiene.
3. **NEVER** permitir que la IA invente, persista o asigne un proveedor (RN-IA-03, RN-IA-04, RN-IA-06). La `PropuestaFactura.proveedor_nombre` y `PropuestaPago.proveedor_nombre` son `Optional[str]` y se devuelven **tal cual las devolvió el modelo**; el matching contra `Proveedor` es 100% del cliente.
4. **NEVER** persistir nada desde el extractor ni desde el router `/extraer-ia` (RN-IA-04). El test de regresión `test_ia_vision_no_persistence.py` asserta 0 mutaciones capturando eventos `before_flush` de SQLAlchemy.
5. **NEVER** devolver 500 ante fallo del extractor (RN-IA-05). Cualquier excepción del SDK se captura en el router; la respuesta es 200 con `error: true`, todos los campos `None` y `error_message: str` legible.
6. **NEVER** aceptar PDF en `/extraer-ia` (RN-IA-01). El endpoint valida `content-type` por magic bytes (no por header) y rechaza PDF con 422.
7. **NEVER** confiar en la respuesta cruda del modelo. Se parsea siempre por Pydantic con `model_validate(json, strict=True)`; cualquier `ValidationError` se trata como fallo del extractor y produce `error: true`.
8. **NEVER** loguear ni persistir los bytes crudos de la imagen ni la respuesta cruda de la IA (privacidad + costo). Solo se loguean: `usuario_id` (uuid), `endpoint`, `latency_ms`, `provider`, `success: bool`, `error_class: str | None`.
9. **NEVER** pre-seleccionar proveedor en el backend. La `ProveedorAutocomplete` del frontend hace el match por RN-VINC sobre `proveedor_nombre` recibido. El backend **no** expone un endpoint `/proveedores/match-from-ia` ni nada similar.
10. **Rate limit estricto**: 10 req/hora por `usuario_id` para `/api/facturas/extraer-ia` y `/api/pagos/extraer-ia`. Esto es más restrictivo que el rate limit de auth (5/60s por IP, C-03) porque cada request consume API budget externo. Tests cubren el 11° request → 429 con `Retry-After`.
11. **Imágenes únicamente**. El endpoint valida el MIME real (no el `Content-Type` del header) y rechaza con 422 todo lo que no sea `image/jpeg`, `image/png` o `image/webp`. Límite duro: 10 MB (alineado con el límite de Cloudinary, Q-05).
12. **Tests con Postgres real** (testcontainers). SDKs `anthropic` y `openai` mockeados. Nunca SQLite.
13. **Python**: snake_case + type hints. **Pydantic v2** estricto. **No** se usa `Any`. **No** se usa `fastapi.UploadFile.file.read()` sincrónicamente en handlers `async`; se lee con `await` para no bloquear el event loop.
14. **Pydantic schema response**: `PropuestaFacturaEnvelope` y `PropuestaPagoEnvelope` exponen `error: bool` y `error_message: str | None` SIEMPRE (campos no opcionales, default `False` / `None`). El frontend siempre puede ramificar por `error`.
15. **El `origen` se sigue seteando `MANUAL` por el CRUD existente** (C-08/C-10). El endpoint `/extraer-ia` no toca `origen`; el `origen=IA` se setea recién cuando el frontend confirma contra `POST /api/facturas` o `POST /api/pagos` en C-15. **No** se introduce un atajo en el backend que cree una factura/pago con `origen=IA` directamente desde la propuesta.
