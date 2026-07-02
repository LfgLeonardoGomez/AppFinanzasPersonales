# Design: c-14-ia-vision-backend

## Context

C-08 (facturas-backend, archivado 2026-06-21) y C-10 (pagos-backend, archivado 2026-06-27) ya
exponen el CRUD manual de facturas y pagos. C-12 (cuenta-corriente-backend, archivado 2026-06-27)
construyó el cálculo de saldo y estado FIFO sobre esos CRUDs. C-15 (ia-vision-frontend, pendiente)
necesita dos endpoints HTTP que, dada una imagen, devuelvan una **propuesta** Pydantic de cabecera
para que el usuario edite y luego confirme contra los endpoints existentes de creación.

La KB define RN-IA-01 a RN-IA-06 y RN-VINC. La regla cardinal es que la IA **nunca persiste** y
**nunca asigna proveedor**; propone, el humano confirma. La arquitectura ya prevista en
`08_arquitectura_propuesta.md` §"Abstracción de IA de visión" es la base:

> `class VisionExtractor (interfaz)` con `extraer_factura(imagen) -> PropuestaFactura` y
> `extraer_pago(imagen) -> PropuestaPago`. Implementaciones: `ClaudeVisionExtractor`,
> `OpenAIVisionExtractor`, ... Prompt y schema JSON compartidos; cada implementación adapta la
> llamada pero devuelve la misma estructura Pydantic normalizada.

Este change aterriza esa abstracción en código, suma rate limit por `usuario_id` (no por IP) y
agrega los dos endpoints HTTP. **No** modifica el esquema, los modelos ni los services de C-08,
C-10 o C-12.

Estado actual de `app/core/` (C-01 + C-03):

- `config.py` — `Settings` ya carga `VISION_PROVIDER` (validador acepta `claude|openai`),
  `ANTHROPIC_API_KEY` y `OPENAI_API_KEY` con default `""`.
- `deps.py` — `get_current_user`, `get_db`, y un `rate_limit` per-IP para auth (5/60s).
  **No** hay rate limiter per-user. C-14 introduce uno en `app/core/rate_limit_ia.py`.
- `security.py`, `cloudinary_signer.py`, `uuid_utils.py` — sin cambios.

SDKs disponibles (ya en `pyproject.toml` C-01):

- `anthropic>=0.28.0,<0.29` — soporta `client.messages.create(model=..., messages=[...])` con
  contenido multimodal `image` + `text`.
- `openai>=1.30.0,<2` — soporta `client.chat.completions.create(model=..., messages=[...])` con
  contenido multimodal vía `image_url`.

Ambos exponen una API similar; el adaptador queda chico (1 método cada uno).

## Goals / Non-Goals

**Goals:**

- Definir la interfaz `VisionExtractor(Protocol)` con `extraer_factura(imagen: bytes, content_type: str) -> PropuestaFactura` y `extraer_pago(imagen: bytes, content_type: str) -> PropuestaPago`. La interfaz **no** lanza excepciones al caller: encapsula el fallo en `PropuestaFactura.error: bool` / `PropuestaPago.error: bool` (RN-IA-05).
- Implementar `ClaudeVisionExtractor` (Anthropic SDK) y `OpenAIVisionExtractor` (OpenAI SDK), ambos con un prompt compartido y parsing por Pydantic en `strict=True`.
- Exponer `get_vision_extractor()` como factory `@lru_cache` que lee `settings.VISION_PROVIDER` y devuelve la instancia singleton.
- Rate limit **por `usuario_id`** (10 req/hora, ventana deslizante de 60 min) sobre los dos endpoints `/extraer-ia`. Implementación in-memory alineada con el patrón de `app/core/deps.py:rate_limit` (C-03): `dict[uuid, deque[datetime]]`, eviction por edad, lock por asyncio. Migración a Redis queda como follow-up (no se necesita en MVP single-instance, igual que el rate limit de auth).
- Extender `app/routers/facturas.py` con `POST /api/facturas/extraer-ia` (multipart, image-only, auth requerida, rate-limited, sin DB write) y registrar la ruta **antes** de `/{factura_id}` para que el path param no la capture.
- Extender `app/routers/pagos.py` con `POST /api/pagos/extraer-ia` (mismo patrón).
- Test de regresión de no-persistencia: un listener `before_flush` SQLAlchemy captura `INSERT|UPDATE|DELETE` sobre `factura`, `factura_item`, `pago` durante la request; assert `len(events) == 0`. Esto blindea RN-IA-04 contra una regresión futura que persista "por accidente" (p. ej. un `session.add(...)` dejado en el handler).
- Cobertura de tests:
  - Unit de `PropuestaFactura` / `PropuestaPago` con semántica `None`-ausente.
  - Unit de cada extractor con SDK mockeado: éxito completo, éxito parcial (algunos campos `None`), fallo del SDK (`raise`), respuesta con JSON malformado (`ValidationError`).
  - Unit de la factory: `VISION_PROVIDER=claude → ClaudeVisionExtractor`, `VISION_PROVIDER=openai → OpenAIVisionExtractor`, valor inválido → `ValueError` al instanciar (enforcer en `Settings` ya garantiza que llegue en minúsculas; el assert defensivo queda en la factory).
  - Unit del rate limiter: 10 requests OK, 11ª → 429, después de 1 hora la primera request pasa de nuevo.
  - Integration con TestClient: 200 OK con propuesta completa, 200 con `error: true` y campos `None` (SDK mockeado lanza), 401 sin sesión, 429 rate-limited, 422 con PDF rechazado, 422 con imagen > 10 MB, 422 con `content-type` image/heic (no soportado), 422 con multipart mal armado.
  - Regresión de no-persistencia: 0 eventos capturados durante `/extraer-ia`.

**Non-Goals:**

- Frontend (C-15).
- Multi-imagen por request.
- PDF en IA (RN-IA-01).
- Fine-tuning, prompt versioning, telemetría de accuracy.
- Cache de propuestas.
- SSE / streaming.
- Pre-selección de proveedor en el backend.
- Persistir `origen=IA` directamente desde la propuesta. El `origen=IA` lo setea el `POST /api/facturas` / `POST /api/pagos` cuando el usuario confirma en C-15.
- Migración a Redis para el rate limiter. La KB y la decisión D-C03-7 ya asumen single-instance en el MVP; el patrón se mantiene.

## Decisions

### D-IA-1 — `VisionExtractor` es un `typing.Protocol`, no una `ABC`

`from typing import Protocol` define la interfaz. Las dos implementaciones la satisfacen por
duck-typing. Beneficio: no requiere herencia, los tests pueden stub-ear con un `Mock(spec=...)` o
un `SimpleNamespace` que exponga los métodos correctos, y no hay overhead de metaclases. Tests
usan `unittest.mock.create_autospec(VisionExtractor, instance=True)` para garantizar el contrato.

### D-IA-2 — Rate limiter IA: sliding window per-`usuario_id` in-memory (no `slowapi`)

**Decisión**: implementar `app/core/rate_limit_ia.py` con el mismo patrón que
`app/core/deps.py:rate_limit` (C-03 D-C03-7): `dict[uuid, deque[datetime]]` en memoria, eviction por
edad, 10 req / 3600 s.

**Por qué no `slowapi` / `fastapi-limiter`**: ambas agregan una dependencia nueva, funcionan con
Redis por default (`fastapi-limiter` lo requiere), y un `slowapi` con backend in-memory sigue
siendo menos simple que ~40 líneas que siguen el patrón ya establecido. El baseline del proyecto
(D-C03-7) ya asume single-instance MVP y migración a Redis como follow-up; mantener el patrón
reduce la superficie cognitiva. La KB menciona "rate limiting en endpoints de IA" en
`08_arquitectura_propuesta.md §Baseline de seguridad` sin especificar tecnología, por lo que
la decisión queda abierta al implementador; C-14 la cierra eligiendo el patrón consistente.

**Clave**: `usuario_id` (uuid), no IP. Distinto del rate limit de auth (C-03) que es per-IP. Razón:
un usuario detrás de NAT (mismo IP, varios usuarios) no debería golpear el límite del otro; y un
usuario con IP dinámica (móvil) no debería perder su cuota. El costo externo se imputa al usuario
que llama, no a la red.

**Estructura**:

```python
_IA_RATE_WINDOW_SECONDS = 3600
_IA_RATE_MAX_REQUESTS = 10
_ia_attempts: dict[uuid.UUID, deque[datetime]] = defaultdict(deque)
_ia_lock = asyncio.Lock()

async def rate_limit_ia(current_user: CurrentUser) -> None:
    """Sliding window 10/hora por usuario. Raises 429 si excede."""
    now = datetime.now(timezone.utc)
    window_start = now - timedelta(seconds=_IA_RATE_WINDOW_SECONDS)
    async with _ia_lock:
        attempts = _ia_attempts[current_user.id]
        while attempts and attempts[0] < window_start:
            attempts.popleft()
        if len(attempts) >= _IA_RATE_MAX_REQUESTS:
            retry_after = int((attempts[0] + timedelta(seconds=_IA_RATE_WINDOW_SECONDS) - now).total_seconds())
            raise HTTPException(429, "Demasiadas solicitudes a la IA. Intente nuevamente.", headers={"Retry-After": str(retry_after)})
        attempts.append(now)
```

Test expone `reset_ia_rate_limit_store()` para limpiar el dict entre tests (mismo patrón que
`reset_rate_limit_store` en `app/core/deps.py`).

### D-IA-3 — Validación de imagen en el router, no en el servicio

`POST /api/facturas/extraer-ia` recibe `UploadFile` (multipart). El router:

1. Verifica que `content_type` ∈ `{image/jpeg, image/png, image/webp}` por **magic bytes** (no por
   header — un cliente puede mentir el header). Se leen los primeros 12 bytes y se valida la firma
   (`FF D8 FF` para JPEG, `89 50 4E 47 0D 0A 1A 0A` para PNG, `52 49 46 46 ... 57 45 42 50` para
   WebP). Magic byte check helper en `app/core/image_validation.py` (nuevo).
2. Verifica tamaño: `await file.read(10 * 1024 * 1024 + 1)` y rechaza si excede 10 MB. Esto se hace
   con `seek(0)` después para no consumir el buffer del `UploadFile` (FastAPI's `UploadFile`
   spoola a disco si excede el threshold, así que el `read` ya no es en memoria).
3. Pasa los `bytes` al extractor.

**Por qué en el router, no en el servicio**: la validación de tipo MIME es una **política de
transporte** (es un input del usuario que llega por HTTP), no del dominio. El servicio
`ia_extraccion_service.extraer_factura(imagen_bytes, content_type)` recibe bytes ya validados;
confiar en la signature es responsabilidad del router. Esto también facilita mockear el servicio en
tests del router sin repetir la validación.

### D-IA-4 — `PropuestaFactura` / `PropuestaPago` como `BaseModel` puros, no `SQLModel`

`app/schemas/factura.py` ya define schemas de request/response para el CRUD. C-14 agrega
`PropuestaFactura` y `PropuestaFacturaEnvelope` como `BaseModel` puros en ese mismo archivo
(importable como `from app.schemas.factura import PropuestaFactura, PropuestaFacturaEnvelope`).
Razón: estos objetos **nunca** se persisten; hacerlos `SQLModel` sugeriría que se puede
`session.add(propuesta)`, lo cual violaría RN-IA-04. La forma `BaseModel` deja explícito que es
un DTO de transporte.

```python
class PropuestaFactura(BaseModel):
    model_config = ConfigDict(extra="ignore")  # defensivo: la IA a veces mete campos extra
    proveedor_nombre: str | None = None
    numero: str | None = None
    fecha_emision: date | None = None
    monto_total: Decimal | None = None

class PropuestaFacturaEnvelope(BaseModel):
    propuesta: PropuestaFactura
    error: bool = False
    error_message: str | None = None
```

El envelope separa "datos de la propuesta" de "metadatos de la operación" (éxito/fallo). El
frontend C-15 ramifica por `error` para mostrar el aviso (RN-IA-05) o pasar a la pantalla de
edición con la `PropuestaFactura` prellenada. **No** se usa `model_validate(..., strict=True)`
en el cliente (eso lo hace el backend al parsear la respuesta del modelo); el cliente solo lee.

### D-IA-5 — Prompt compartido, JSON schema explícito, parsing estricto

`app/services/ia_extraccion_service.py` define una función pura `_build_prompt(documento: Literal["factura","pago"]) -> str`
que devuelve el system prompt. Cada extractor concatena el system prompt con un user prompt
mínimo ("Extract the JSON described above from the attached image.") y los `bytes` de la imagen
como bloque multimodal. El modelo **debe** responder con un JSON que matchee el schema declarado;
los extractores usan la API en modo "tool/structured output" cuando está disponible, y parsing
por regex + `json.loads` + `PropuestaFactura.model_validate(..., strict=True)` cuando no.

**System prompt compartido** (fragmento — el texto completo va en el código, no en este design,
para no duplicar):

```
You are an information extractor for a personal-finance app. You receive ONE image of an
Argentine invoice (Factura) or payment receipt (Comprobante de Pago). Your only job is to
read the visible header and return a single JSON object.

RULES (NON-NEGOTIABLE):
- Extract ONLY header fields. Line items / product lists / taxes are NOT extracted.
- If a field is unreadable, partially visible, or uncertain, return null for that field.
  NEVER invent, guess, or estimate a value.
- Dates must be ISO-8601 (YYYY-MM-DD). If only "DD/MM/YY" is visible, expand to YYYY-MM-DD
  assuming 20YY for two-digit years in the 00-69 range, 19YY for 70-99.
- Amounts must be numbers (no thousands separator). If the amount is unreadable, return null.
  NEVER compute subtotals + IVA yourself.
- Proveedor (vendor) name: return the legal/commercial name as printed on the document.
  If the user is a consumer (the document is addressed to "Consumidor Final"), return null.
  Do NOT return the seller's own tax ID as the name.
- Return ONLY the JSON object. No commentary, no markdown fences, no extra text.

SCHEMA (JSON object, all fields nullable):
{
  "proveedor_nombre": string | null,
  "numero": string | null,            // only for invoices
  "fecha_emision": string | null,     // ISO date, only for invoices
  "monto_total": number | null,       // only for invoices
  "monto": number | null,             // only for payments
  "fecha": string | null,             // ISO date, only for payments
  "metodo": string | null             // one of: EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO, only for payments
}

Pick the fields that match the document type. For an invoice: proveedor_nombre, numero,
fecha_emision, monto_total. For a payment receipt: proveedor_nombre, monto, fecha, metodo.
```

Las dos implementaciones (`ClaudeVisionExtractor`, `OpenAIVisionExtractor`) **eliminan** los
campos que no aplican al documento antes de validar con Pydantic. La función `_strip_unused_fields`
centraliza ese filtrado (evita que `extra="forbid"` rechace la respuesta en Pydantic).

### D-IA-6 — `factory get_vision_extractor()` `@lru_cache`, lectura lazy de `settings`

```python
@lru_cache(maxsize=1)
def get_vision_extractor() -> VisionExtractor:
    provider = settings.VISION_PROVIDER
    if provider == "claude":
        return ClaudeVisionExtractor(api_key=settings.ANTHROPIC_API_KEY)
    if provider == "openai":
        return OpenAIVisionExtractor(api_key=settings.OPENAI_API_KEY)
    raise ValueError(f"VISION_PROVIDER desconocido: {provider!r}")
```

`@lru_cache` garantiza una sola instancia por proceso. Tests usan `monkeypatch.setattr(...)` o
`get_vision_extractor.cache_clear()` para re-instanciar. `Settings.VISION_PROVIDER` ya valida
`{claude, openai}` en `app/core/config.py` (C-01), por lo que la rama `else` solo se activa por
corrupción de runtime (test defensivo).

### D-IA-7 — El router **no** llama directamente a `get_vision_extractor()`; el servicio encapsula

El router hace:

```python
@router.post("/extraer-ia", response_model=PropuestaFacturaEnvelope)
async def extraer_factura_ia(
    file: Annotated[UploadFile, File(description="Imagen de factura (jpg/png/webp, máx 10 MB)")],
    current_user: CurrentUser = ...,
    _: None = Depends(rate_limit_ia),
) -> PropuestaFacturaEnvelope:
    image_bytes, content_type = await _read_and_validate_image(file)
    extractor = get_vision_extractor()
    propuesta = await extractor.extraer_factura(image_bytes, content_type)
    return PropuestaFacturaEnvelope(propuesta=propuesta, error=propuesta.error, error_message=propuesta.error_message)
```

**No** se hace `session.add(...)` ni `session.commit()`. La `DbSession` no se inyecta siquiera
en estos endpoints (declaración `def` con `Annotated` solo para `current_user` y la dependencia
del rate limit). Esto hace que el test de no-persistencia sea trivial: el listener `before_flush`
no se activa nunca durante la request.

**Por qué `async def` y no `def`**: la lectura del `UploadFile` con `await file.read(...)` y la
llamada al SDK de Anthropic/OpenAI (que expone métodos `async` en versiones recientes) se
benefician de no bloquear el event loop. Si el SDK no es `async`, se usa `asyncio.to_thread(...)`
para no bloquear.

### D-IA-8 — `PropuestaFactura` y `PropuestaPago` extienden con `error: bool` y `error_message: str | None` (sin envelope)

**Decisión reconsiderada respecto a D-IA-4**: en lugar de un `Envelope` separado, los campos de
error viven **dentro** de la propuesta. Razón: el `Envelope` agrega una capa que el frontend
tiene que destripar; tener los flags en el mismo objeto simplifica el tipado TS generado
(`openapi-typescript` produce `PropuestaFactura` con `error: boolean` directo). El router mapea:

```python
return propuesta  # ya tiene error / error_message poblados por el extractor
```

Y el `response_model=PropuestaFactura` documenta la respuesta completa en OpenAPI. El extractor
es responsable de poblar `error=True` y `error_message="..."` cuando captura cualquier excepción
del SDK; en éxito, ambos quedan en sus defaults (`False`, `None`).

```python
class PropuestaFactura(BaseModel):
    model_config = ConfigDict(extra="ignore")
    proveedor_nombre: str | None = None
    numero: str | None = None
    fecha_emision: date | None = None
    monto_total: Decimal | None = None
    error: bool = False
    error_message: str | None = None
```

`Pydantic v2` permite `Decimal | None` y `date | None` directos; no hace falta `Optional[...]`.

### D-IA-9 — Sin `ProveedorRepository.match_por_nombre` ni nada similar en el backend

Confirmación explícita: el backend **no** expone un endpoint que matchee el `proveedor_nombre` de
la propuesta contra los proveedores del usuario. El matching por RN-VINC (normalizar nombre,
exacto → contiene) es **responsabilidad del frontend** (`ProveedorAutocomplete` en C-07). Esto
mantiene la regla RN-IA-06 ("la IA nunca asigna proveedor") sin ambigüedad: el backend no tiene
forma de hacerlo, ni siquiera opcional. El test
`test_ia_vision_no_persistence.py` asserta que **ningún** endpoint `/extraer-ia` toca
`proveedor`, `factura`, `factura_item` ni `pago`.

### D-IA-10 — Logs mínimos, sin imagen ni respuesta cruda

`app/core/logging_config.py` (existente en C-01) configura el formato JSON. C-14 agrega un
helper `_log_ia_call(usuario_id, endpoint, provider, latency_ms, success, error_class)` en
`ia_extraccion_service.py` que se invoca al final de cada llamada (éxito o fallo). **Nunca** se
loguean: bytes de la imagen, base64, response cruda del modelo, prompt completo. Solo se
loguean los campos listados. La KB §"Baseline de seguridad" lo requiere: "No registrar
contraseñas, tokens ni URLs firmadas." Mismo principio para imágenes de facturas (pueden
contener datos fiscales del usuario).

### D-IA-11 — `response_model` en FastAPI, no `ORJSONResponse` ni serialización custom

Sigue la guía del skill `fastapi` cargado: `response_model=PropuestaFactura` deja que Pydantic
filtre y serialice en Rust. No se usan `ORJSONResponse` (deprecado en Pydantic v2) ni
`jsonable_encoder` manual. El router declara `-> PropuestaFactura` y FastAPI se encarga.

### D-IA-12 — Ruta `/extraer-ia` registrada **antes** de `/{id}`

FastAPI matchea rutas en orden de declaración. `POST /api/facturas/extraer-ia` debe declararse
**antes** de `GET /api/facturas/{factura_id}` para que el path param no capture `extraer-ia`
como un `UUID` (que fallaría con 422, no con 404). El mismo principio aplica a `pagos.py`.
Esto se valida en el test de integración: el orden de declaración del router importa.

### D-IA-13 — `origen` se sigue seteando `MANUAL` en el CRUD existente; C-15 lo cambia a `IA`

El `/extraer-ia` no persiste. Cuando el usuario confirma en C-15, el frontend llama a
`POST /api/facturas` con `origen=IA` (campo **nuevo** que C-15 introduce en el schema o un
header; decisión final de C-15). C-14 **no** agrega el campo `origen` a `PropuestaFactura` ni
a `PropuestaPago` — es metadata de la confirmación, no de la propuesta. Esto evita que un
frontend desactualizado setee `origen=IA` por error y haga pasar una carga manual como IA.

## Layer interaction

```
Router (facturas.py)  ─►  get_vision_extractor()  ─►  ClaudeVisionExtractor | OpenAIVisionExtractor
                          │
                          └► PropuestaFactura.model_validate(response_json, strict=True)
                              (RN-IA-03, RN-IA-05)
                          │
                          └► logs _log_ia_call(...) — sin bytes ni response cruda
                          │
                          └► no session.add, no session.commit  (RN-IA-04)

Router (pagos.py)     ─►  mismo flujo, PropuestaPago en lugar de PropuestaFactura
```

El extractor no llama a ningún repository ni service de dominio. La `DbSession` no se inyecta en
los handlers `/extraer-ia`. El test `test_ia_vision_no_persistence.py` confirma que el `Session`
no recibe mutaciones.

## Key invariants enforced in this layer

| Invariant | Where enforced |
|---|---|
| `saldo` not persisted | No aplica a C-14 (no toca saldo); invariante mantenido |
| `estado` not persisted | No aplica a C-14 (no toca estado); invariante mantenido |
| `factura_id` not on `Pago` | No aplica a C-14 (no toca `Pago` schema); invariante mantenido |
| IA never persists (RN-IA-04) | Router no inyecta `DbSession`; test `before_flush` listener asserta 0 mutaciones |
| IA never invents (RN-IA-03) | `PropuestaFactura.proveedor_nombre: str \| None`, etc.; system prompt prohíbe inventar; Pydantic `model_validate(strict=True)` rechaza campos extra |
| IA never assigns proveedor (RN-IA-06) | Backend no expone endpoint de matching; el `proveedor_nombre` se devuelve tal cual |
| Failure → 200 con `error: true` (RN-IA-05) | Extractor encapsula excepciones en `PropuestaFactura(error=True, error_message=...)`; router nunca propaga 5xx |
| Image only (RN-IA-01) | `_read_and_validate_image()` valida magic bytes y rechaza PDF/jpg2000/heic/tiff con 422 |
| Auth required | `get_current_user` dependency en cada `/extraer-ia`; sin sesión → 401 |
| Rate limit 10/hora per user | `rate_limit_ia` dependency; 11ª request → 429 con `Retry-After` |
| No log of image / response | Helper `_log_ia_call` solo loguea `usuario_id`, `endpoint`, `provider`, `latency_ms`, `success`, `error_class` |
| Router thin | Dependencia → validar imagen → llamar factory → mapear respuesta. No cálculo, no autorización (más allá de `get_current_user`). |
| Hard schema (Pydantic v2 strict) | `PropuestaFactura.model_validate(..., strict=True)` rechaza respuesta malformada; misma protección en `OpenAIVisionExtractor` |

## Risks / Trade-offs

| Risk | Mitigation |
|---|---|
| Un implementador futuro agrega `session.add(propuesta)` "para no perder la info" y rompe RN-IA-04 | Test de regresión `test_ia_vision_no_persistence.py` con listener `before_flush` que captura INSERT/UPDATE/DELETE y asserta 0. Code review checklist reproduce el invariante. |
| La IA devuelve un JSON con campos extra (p. ej. `cuit`, `iva`) y `model_validate` falla con `extra="forbid"` | `PropuestaFactura.model_config = ConfigDict(extra="ignore")` permite que el modelo ignore campos no declarados en lugar de fallar. Solo `None`-ausente para los declarados (RN-IA-03). |
| La IA devuelve `monto_total: "1.234,56"` con separador de miles y coma decimal | `_parse_amount(s)` helper: strip de `.` y `,`, replace `,` por `.` si es decimal argentino. Si no se puede parsear, `None`. |
| La fecha viene como `DD/MM/YYYY` y no ISO | `_parse_date(s)` intenta varios formatos comunes (`YYYY-MM-DD`, `DD/MM/YYYY`, `DD/MM/YY`) y expande años de 2 dígitos según heurística documentada en el system prompt. Si no se puede parsear, `None`. |
| El rate limiter in-memory no escala a multi-instance | Documentado en D-IA-2. Sigue el patrón de C-03 (`D-C03-7`); el proyecto asume single-instance MVP. Migración a Redis como follow-up explícito en `CHANGES.md` post-MVP. |
| `anthropic` u `openai` SDK cambian su API en una minor | `pyproject.toml` acota el rango (`<0.29` para anthropic, `<2` para openai). Tests con SDK mockeado detectan breaking changes antes de producción. |
| `UploadFile.read()` bloquea el event loop | `async def` handler + `await file.read(...)`. Si el archivo excede el threshold, FastAPI spoola a disco y `read()` no satura memoria. |
| La IA alucina un `metodo` que no está en el enum (`BITCOIN`, `CRIPTOMONEDA`) | `_strip_unused_fields` y un validador Pydántico convierten cualquier valor fuera de `EFECTIVO|TRANSFERENCIA|TARJETA|MERCADOPAGO|OTRO` a `None` (RN-IA-03, sin invención). |
| El frontend C-15 pre-selecciona proveedor con la propuesta | No es riesgo de C-14; C-14 devuelve `proveedor_nombre` crudo. C-15 debe implementar la `ProveedorAutocomplete` que lo trata como sugerencia (ya lo hace C-07). El test de no-persistencia del backend es independiente del frontend. |
| Magic bytes válidos pero imagen corrupta (p. ej. JPEG truncado) | Se acepta y se manda a la IA; la IA devuelve campos `None` y `error=true` o parcial. El usuario reintenta con otra foto. RN-IA-05 ya cubre el "fallo gracioso". |

## Migration Plan

C-14 **no** incluye migración Alembic. No agrega columnas, índices ni tablas. La deploy
consiste en:

1. `git pull` con el código de C-14.
2. `docker compose restart api` (la imagen de Docker se rebuilda en CI).
3. Verificación manual: `curl -X POST /api/facturas/extraer-ia` con una imagen de prueba (no
   committeada; el operador la genera) — esperar 200 con `error: false` y propuesta poblada.
4. Verificar que el log JSON solo incluye `usuario_id`, `endpoint`, `provider`, `latency_ms`,
   `success`, `error_class` — sin bytes ni response cruda.

**Rollback**: revert del commit → `docker compose restart api` → 404 en `/extraer-ia`. La app
sigue funcionando con el CRUD manual intacto. No hay datos que migrar de vuelta porque C-14 no
persistió nada.

## Open Questions

- **Q-IA-1 (🟢):** ¿Vale la pena agregar `slowapi` con backend in-memory como upgrade futuro? —
  El patrón custom de C-03 (D-C03-7) ya está en producción; mantener consistencia es preferible
  a introducir una dependencia. Decisión D-IA-2.
- **Q-IA-2 (🟢):** ¿Qué hacer si la IA devuelve una `metodo` que no es del enum? — Decisión D-IA-8
  §"Riesgos": el validador Pydántico lo convierte a `None`. C-15 frontend debe mostrar el
  formulario con el campo vacío y un placeholder "Detectado: <valor original> — no reconocido".
- **Q-IA-3 (🟡):** ¿Vale la pena un endpoint `GET /api/ia/limite` para que el frontend sepa
  cuánto le queda? — Útil para UX, no es bloqueante para C-14. Se puede agregar en C-15 sin
  tocar el backend (el frontend hace `try { POST } catch 429 { mostrar mensaje }` y muestra el
  `Retry-After`). Diferido.
- **Q-IA-4 (🟡):** Soporte de `image/heic` (iOS por default) — está fuera del MVP. iOS puede
  exportar a JPEG; el frontend C-15 puede convertir antes de subir. No se invierte tiempo en
  HEIC en backend.
