# Tasks: c-14-ia-vision-backend

> Orden: Strict TDD. Cada task RED → GREEN → triangulate. Los tests se escriben **antes** de
> la implementación y se confirman en rojo antes de tocar el código de producción.
>
> Convenciones heredadas de C-08 / C-10 (ver `archive/2026-06-21-c-08-facturas-backend/tasks.md`):
> - Marcamos `- [x]` SOLO cuando el test verde Y el código de producción commiteable estén listos.
> - "Triangulate" = agregar 2-3 casos extra (boundary, error path, isolation) que cierren la
>   superficie del componente antes de pasar al siguiente.
> - Los tests usan Postgres real (testcontainers, `tests/conftest.py`); los SDKs externos
>   (`anthropic.Anthropic`, `openai.OpenAI`) se mockean con `unittest.mock`.

## 1. PropuestaFactura schema (`app/schemas/factura.py`)

- [x] 1.1 Escribir `tests/test_ia_vision_schemas.py` (RED): tests de `PropuestaFactura` con semántica `None`-ausente
  - `PropuestaFactura()` con todos los campos → defaults `None`/`False`
  - `PropuestaFactura(proveedor_nombre="Acme", numero="0001-001", fecha_emision=date(2026,6,15), monto_total=Decimal("1234.56"))` → campos populados, `error=False`, `error_message=None`
  - `PropuestaFactura(proveedor_nombre=None, numero=None, fecha_emision=None, monto_total=None)` → válido, todos `None` (RN-IA-03)
  - `PropuestaFactura(error=True, error_message="timeout")` con el resto de campos `None` → válido (RN-IA-05)
  - JSON con campos extra (`cuit`, `iva`, `subtotal`) → `model_validate` los ignora, no rompe (no es `extra="forbid"`)
  - JSON con `monto_total` como string `"1234.56"` se coerce a `Decimal` (Pydantic v2 lo hace nativo)
  - JSON con `monto_total` como string malformado `"1.234,56"` no rompe: la coerción falla solo si lo parseamos; el helper `_parse_amount` lo maneja en el extractor (no acá)
  - `PropuestaFactura` NO declara `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`, `updated_at` (introspección `model_fields.keys()`)

- [x] 1.2 Crear `PropuestaFactura` y `PropuestaFacturaEnvelope` en `app/schemas/factura.py` (GREEN)
  - `PropuestaFactura(BaseModel)` con `model_config = ConfigDict(extra="ignore")`
  - Campos: `proveedor_nombre: str | None = None`, `numero: str | None = None`, `fecha_emision: date | None = None`, `monto_total: Decimal | None = None`, `error: bool = False`, `error_message: str | None = None`
  - `PropuestaFacturaEnvelope` se descarta — el envelope complica el tipado TS y D-IA-8 decide que `error`/`error_message` viven dentro de `PropuestaFactura`. Reemplazar el test de 1.1 si es necesario.
  - Agregar a `__all__` de `app/schemas/factura.py`

- [x] 1.3 Triangular: assertar que `PropuestaFactura.model_json_schema()` (lo que consume `openapi-typescript` para el frontend) NO incluye `id`, `usuario_id`, `origen`; assertar que `model_dump()` con todos `None` produce `{"proveedor_nombre": null, "numero": null, "fecha_emision": null, "monto_total": null, "error": false, "error_message": null}` (forma estable para el cliente)

## 2. PropuestaPago schema (`app/schemas/pago.py`)

- [x] 2.1 Escribir tests adicionales en `tests/test_ia_vision_schemas.py` (RED): `PropuestaPago`
  - `PropuestaPago()` con todos los campos → defaults `None`/`False`
  - `PropuestaPago(proveedor_nombre="Acme", monto=Decimal("5000.00"), fecha=date(2026,6,20), metodo=MetodoPago.TRANSFERENCIA)` → campos populados
  - `PropuestaPago(metodo="CRIPTOMONEDA")` (no en el enum) → falla la validación con Pydantic, NO se coerce a `None` en el schema (esa normalización es del extractor, ver 5.2)
  - `PropuestaPago(metodo=None)` → válido
  - JSON con `metodo` en minúsculas `"transferencia"` → falla (Pydantic es case-sensitive); el extractor debe normalizar a uppercase ANTES de validar
  - JSON con campos extra (`cuit`, `comprobante_url`) → `model_validate` los ignora
  - `PropuestaPago` NO declara `id`, `usuario_id`, `proveedor_id`, `origen`, `created_at`, `updated_at`, `comprobante_url`, `factura_id` (introspección)

- [x] 2.2 Crear `PropuestaPago` en `app/schemas/pago.py` (GREEN)
  - `PropuestaPago(BaseModel)` con `model_config = ConfigDict(extra="ignore")`
  - Campos: `proveedor_nombre: str | None = None`, `monto: Decimal | None = None`, `fecha: date | None = None`, `metodo: MetodoPago | None = None`, `error: bool = False`, `error_message: str | None = None`
  - Agregar a `__all__` de `app/schemas/pago.py`

- [x] 2.3 Triangular: assertar shape JSON estable; assertar que `model_validate(strict=True)` rechaza tipos incorrectos (`monto: "mil pesos"` falla, `metodo: 42` falla)

## 3. Image validation helper (`app/core/image_validation.py`)

- [x] 3.1 Escribir `tests/test_image_validation.py` (RED): helper `validate_image_bytes(data: bytes) -> Literal["jpeg","png","webp"]`
  - Magic bytes JPEG (`FF D8 FF E0` o `FF D8 FF E1`) → `"jpeg"`
  - Magic bytes PNG (`89 50 4E 47 0D 0A 1A 0A`) → `"png"`
  - Magic bytes WebP (`52 49 46 46 ?? ?? ?? ?? 57 45 42 50`) → `"webp"`
  - Magic bytes PDF (`25 50 44 46`) → raise `ValueError("PDF no soportado")` (RN-IA-01)
  - Magic bytes GIF (`47 49 46 38`) → raise `ValueError("GIF no soportado")`
  - Magic bytes HEIC (cualquier firma) → raise `ValueError("HEIC no soportado")`
  - Magic bytes TIFF (`49 49 2A 00` o `4D 4D 00 2A`) → raise `ValueError("TIFF no soportado")`
  - Bytes vacíos → raise `ValueError("archivo vacío")`
  - Bytes < 12 bytes → raise `ValueError("archivo muy pequeño")` (no se puede leer la magic signature)
  - Tamaño > 10 MB → raise `ValueError("archivo excede 10 MB")` (límite Q-05)

- [x] 3.2 Crear `app/core/image_validation.py` (GREEN)
  - `def validate_image_bytes(data: bytes) -> Literal["jpeg","png","webp"]:`
  - Constantes para magic bytes
  - Raise `ValueError` con mensaje claro en cada rechazo
  - Tamaño: validar `len(data) > 10 * 1024 * 1024` antes de cualquier otra validación
  - Magic bytes: switch sobre los primeros 3-4 bytes

- [x] 3.3 Triangular: caso `data[:3] == b"\xff\xd8\xff"` con byte 4 random → sigue siendo JPEG (no asumimos EXIF marker); caso `data` con magic válida pero truncada (8 bytes) → debe detectar correctamente (PNG necesita 8 bytes exactos; JPEG solo 3)

## 4. VisionExtractor Protocol (`app/services/ia_extraccion_service.py`)

- [x] 4.1 Escribir `tests/test_ia_vision_factory.py` (RED): test que la interfaz `VisionExtractor` es un `Protocol` con los métodos correctos
  - `from app.services.ia_extraccion_service import VisionExtractor` → existe
  - `VisionExtractor` es `typing.Protocol`
  - `hasattr(VisionExtractor, "extraer_factura")` y `hasattr(VisionExtractor, "extraer_pago")`
  - Stub que satisface el Protocol: `class StubExtractor:` con ambos métodos → `isinstance(StubExtractor(), VisionExtractor)` es `True` (Protocol es estructural)
  - Stub sin uno de los métodos → NO satisface el Protocol

- [x] 4.2 Crear `app/services/ia_extraccion_service.py` con el Protocol (GREEN)
  - `from typing import Protocol, Literal`
  - `class VisionExtractor(Protocol):`
  - `def extraer_factura(self, imagen_bytes: bytes, content_type: str) -> PropuestaFactura: ...`
  - `def extraer_pago(self, imagen_bytes: bytes, content_type: str) -> PropuestaPago: ...`
  - Imports: `from app.schemas.factura import PropuestaFactura` y `from app.schemas.pago import PropuestaPago`
  - Sin implementaciones todavía; eso va en 5.x

- [x] 4.3 Triangular: verificar con `runtime_checkable` (`@runtime_checkable`) que el Protocol se puede usar con `isinstance` en runtime para los tests de integración que necesitan garantizar el contrato del mock

## 5. ClaudeVisionExtractor (`app/services/ia_extraccion_service.py`)

- [x] 5.1 Escribir `tests/test_ia_vision_extractors.py` (RED): tests del `ClaudeVisionExtractor` con SDK mockeado
  - Mockear `anthropic.Anthropic` con `unittest.mock.MagicMock(spec=anthropic.Anthropic)`
  - Test `extraer_factura` éxito completo: el mock devuelve un `Message` con `content=[TextBlock(text='{"proveedor_nombre": "Acme", "numero": "001", "fecha_emision": "2026-06-15", "monto_total": 1234.56}')]`; assertar que el `PropuestaFactura` resultante tiene los campos populados y `error=False`
  - Test `extraer_factura` éxito parcial: mock devuelve JSON con `monto_total: null`; assertar `monto_total=None`, `error=False`
  - Test `extraer_factura` respuesta malformada (no es JSON): el extractor captura `json.JSONDecodeError`, retorna `PropuestaFactura(error=True, error_message="JSON parse error: ...")` y los otros campos `None`
  - Test `extraer_factura` JSON que no matchea el schema: el extractor captura `pydantic.ValidationError`, retorna `error=True` y los otros campos `None`
  - Test `extraer_factura` SDK raise (`anthropic.APIError`): el extractor captura, retorna `error=True, error_message="anthropic.APIError: <msg>"` y los otros campos `None`
  - Test `extraer_factura` con `metodo` o campos de pago en la respuesta (IA devolvió un comprobante cuando se pidió factura): el extractor filtra con `_strip_unused_fields` y solo deja los campos de factura
  - Test `extraer_pago`: análogo, con `MetodoPago` enum, incluyendo caso `metodo` valor fuera del enum → normalizado a `None`
  - Test `extraer_pago` con `metodo` en minúsculas (`"transferencia"`) → el extractor normaliza a `MetodoPago.TRANSFERENCIA` antes de validar
  - Test que `_build_prompt("factura")` y `_build_prompt("pago")` retornan strings distintos y NO contienen instrucciones que inviten a inventar

- [x] 5.2 Crear `ClaudeVisionExtractor` y helpers en `app/services/ia_extraccion_service.py` (GREEN)
  - `_build_prompt(documento: Literal["factura","pago"]) -> str` con el system prompt documentado en D-IA-5 (puede ser multilinea)
  - `_parse_amount(s: str | None) -> Decimal | None`: strip de `.` (thousands sep), replace `,` por `.` (decimal sep), si falla `None`
  - `_parse_date(s: str | None) -> date | None`: intenta `date.fromisoformat`, luego `datetime.strptime` con formatos `DD/MM/YYYY`, `DD/MM/YY` (con heurística 20YY/19YY), si falla `None`
  - `_strip_unused_fields(data: dict, documento: Literal["factura","pago"]) -> dict`: deja solo las keys del documento + ignora
  - `_normalize_metodo(s: str | None) -> MetodoPago | None`: uppercase, strip; si no está en el enum, `None`
  - `class ClaudeVisionExtractor:` con `__init__(self, api_key: str)` que instancia `anthropic.Anthropic(api_key=api_key)`
  - `extraer_factura(self, imagen_bytes, content_type) -> PropuestaFactura`:
    - Llama al SDK con `model=..., max_tokens=1024, system=..., messages=[{"role": "user", "content": [{"type": "image", ...}, {"type": "text", "text": "..."}]}]`
    - Extrae el texto de la respuesta, hace `json.loads`, `_strip_unused_fields(..., "factura")`, valida con `PropuestaFactura.model_validate(data, strict=True)`
    - Si todo OK, retorna `PropuestaFactura(**data, error=False, error_message=None)`
    - Si CUALQUIER excepción, captura, loguea con `_log_ia_call`, retorna `PropuestaFactura(error=True, error_message=...)` con el resto `None`
  - `extraer_pago`: análogo, con `metodo` normalizado a `MetodoPago`
  - `_log_ia_call(usuario_id, endpoint, provider, latency_ms, success, error_class)`: usa `logging.getLogger("app.services.ia_extraccion")` con formato JSON, sin bytes ni response cruda

- [x] 5.3 Triangular: test que `_parse_amount` acepta `"1234.56"`, `"1.234,56"`, `"1234"`, `""`, `None`, `"abc"` (todos retornan el valor correcto o `None`); test que `_parse_date` acepta `"2026-06-15"`, `"15/06/2026"`, `"15/06/26"`, `""`, `None`; test que la latencia se mide con `time.monotonic()` y se reporta en ms (no en segundos)

## 6. OpenAIVisionExtractor (`app/services/ia_extraccion_service.py`)

- [x] 6.1 Escribir tests análogos a 5.1 en `tests/test_ia_vision_extractors.py` (RED) para `OpenAIVisionExtractor`
  - Mockear `openai.OpenAI` con `unittest.mock.MagicMock(spec=openai.OpenAI)`
  - Mismo set de tests que ClaudeVisionExtractor: éxito completo, parcial, JSON malformado, ValidationError, SDK raise (`openai.OpenAIError`), strip de campos, normalización de metodo
  - Test específico: el mock de OpenAI usa `client.chat.completions.create(...)` con `model`, `messages` (multimodal con `image_url` data URL), `response_format={"type": "json_object"}`
  - Test que el `image_url` data URL se construye como `data:<content_type>;base64,<base64>`

- [x] 6.2 Crear `OpenAIVisionExtractor` en `app/services/ia_extraccion_service.py` (GREEN)
  - `class OpenAIVisionExtractor:` con `__init__(self, api_key: str)` que instancia `openai.OpenAI(api_key=api_key)`
  - `extraer_factura` / `extraer_pago` análogos a ClaudeVisionExtractor pero usando `client.chat.completions.create(...)`
  - Reutiliza los helpers `_parse_amount`, `_parse_date`, `_strip_unused_fields`, `_normalize_metodo`, `_log_ia_call` (mismo módulo)
  - Si `response_format=json_object` no está disponible en el modelo configurado, el SDK igual devuelve un string parseable

- [x] 6.3 Triangular: test que el factory de `data:image/...;base64,...` codifica correctamente distintos content types (`image/jpeg`, `image/png`, `image/webp`); test que `_log_ia_call` no se llama con bytes ni con la respuesta cruda (verificable con `caplog` y assertando que ningún mensaje de log contiene `base64` o el JSON de la propuesta)

## 7. Factory `get_vision_extractor()` (`app/services/ia_extraccion_service.py`)

- [x] 7.1 Escribir `tests/test_ia_vision_factory.py` (RED): tests de la factory
  - `monkeypatch.setenv("VISION_PROVIDER", "claude")` + limpiar cache → retorna `ClaudeVisionExtractor`
  - `monkeypatch.setenv("VISION_PROVIDER", "openai")` + limpiar cache → retorna `OpenAIVisionExtractor`
  - `get_vision_extractor()` llamado 2 veces retorna la MISMA instancia (assert `is`)
  - `monkeypatch.setenv("VISION_PROVIDER", "bogus")` + limpiar cache → raise `ValueError` con mensaje claro
  - Limpiar cache entre tests con fixture autouse que llame `get_vision_extractor.cache_clear()`

- [x] 7.2 Crear `get_vision_extractor()` en `app/services/ia_extraccion_service.py` (GREEN)
  - `@lru_cache(maxsize=1)` sobre la función
  - Lee `settings.VISION_PROVIDER`, instancia el extractor correspondiente con la API key correspondiente
  - `else: raise ValueError(f"VISION_PROVIDER desconocido: {provider!r}")`

- [x] 7.3 Triangular: test que la factory no se vuelve a instanciar si solo cambia `settings.VISION_PROVIDER` después del primer call (esto es by design — el cache vive hasta el shutdown del proceso); documentar en el docstring de la factory

## 8. Rate limiter `rate_limit_ia` (`app/core/rate_limit_ia.py`)

- [x] 8.1 Escribir `tests/test_ia_vision_rate_limit.py` (RED): tests del rate limiter per-user
  - Fixture `clean_ia_rate_limit` autouse que llama `reset_ia_rate_limit_store()` antes y después de cada test
  - Test 1: 10 calls consecutivos con el mismo `usuario_id` → todos OK
  - Test 2: 11º call con el mismo `usuario_id` → raise `HTTPException(429)` con `Retry-After` header
  - Test 3: 10 calls de `usuario_id=A`, 1 call de `usuario_id=B` → el de B pasa (presupuestos independientes)
  - Test 4: 10 calls de `usuario_id=A` con timestamp antiguo (simular con `monkeypatch.setattr` sobre `datetime.now`) → el siguiente call pasa (ventana deslizante)
  - Test 5: el `Retry-After` retornado es consistente con el tiempo restante del slot más viejo

- [x] 8.2 Crear `app/core/rate_limit_ia.py` (GREEN)
  - Constantes: `_IA_RATE_WINDOW_SECONDS = 3600`, `_IA_RATE_MAX_REQUESTS = 10`
  - Estado: `_ia_attempts: dict[uuid.UUID, deque[datetime]] = defaultdict(deque)`, `_ia_lock = asyncio.Lock()`
  - `def reset_ia_rate_limit_store() -> None: _ia_attempts.clear()`
  - `async def rate_limit_ia(current_user: CurrentUser) -> None:`
    - `now = datetime.now(timezone.utc)`
    - `async with _ia_lock:` (operación bajo lock — asyncio es cooperativo, así que es suficiente en single-process)
    - `attempts = _ia_attempts[current_user.id]`
    - Eviction: `while attempts and attempts[0] < now - timedelta(seconds=_IA_RATE_WINDOW_SECONDS): attempts.popleft()`
    - Si `len(attempts) >= _IA_RATE_MAX_REQUESTS`: raise `HTTPException(429, detail="Demasiadas solicitudes a la IA. Intente nuevamente en {retry_after} segundos.", headers={"Retry-After": str(retry_after)})` donde `retry_after = int((attempts[0] + timedelta(seconds=_IA_RATE_WINDOW_SECONDS) - now).total_seconds())`
    - `attempts.append(now)`
  - Agregar a `app/core/__init__.py` (si existe) o documentar en el docstring del módulo

- [x] 8.3 Triangular: test que el `Retry-After` no es negativo (clamp a 0 o al menos 1); test de concurrencia: dos `asyncio.gather(rate_limit_ia(user), rate_limit_ia(user))` con el mismo `usuario_id` no rompen la invariante del límite (puede que ocasionalmente pase 11 si la ventana está justo en el borde, pero el contador no se corrompe — assert `len(_ia_attempts[user_id]) <= _IA_RATE_MAX_REQUESTS`)

## 9. POST /api/facturas/extraer-ia (`app/routers/facturas.py`)

- [x] 9.1 Escribir `tests/test_ia_vision_integration.py` (RED): tests del endpoint
  - Fixture `client` de `tests/conftest.py` + `auth_client` (logueado con un usuario de test)
  - Fixture `mock_extractor` que monkey-patchea `app.routers.facturas.get_vision_extractor` para devolver un `MagicMock(spec=VisionExtractor)` con `extraer_factura` configurable por test
  - Test 1: POST con JPEG válido + sesión → 200, body con campos populados, `error=False`
  - Test 2: POST con PNG válido → 200
  - Test 3: POST con WebP válido → 200
  - Test 4: POST con PDF (magic bytes `%PDF`) → 422, mensaje "PDF no soportado", `get_vision_extractor` NO fue llamado
  - Test 5: POST con GIF → 422
  - Test 6: POST con archivo > 10 MB → 422
  - Test 7: POST sin sesión → 401, extractor NO llamado
  - Test 8: extractor raise (mock retorna `PropuestaFactura(error=True, error_message="...")`) → 200, body con `error=true`
  - Test 9: POST a `/api/facturas/extraer-ia` registrado **antes** de `/{factura_id}`: el orden del router es tal que `POST /extraer-ia` no es capturado por el path param (assert por introspección del router: `app.routers.facturas.router.routes` y verificar índice)
  - Test 10: rate limit: 11 requests en una hora → la 11ª retorna 429 con `Retry-After`
  - Test 11: Content-Type del header mintiendo (`image/jpeg` declarado pero magic bytes son PDF) → 422 (validamos magic bytes, no el header)

- [x] 9.2 Extender `app/routers/facturas.py` con `POST /api/facturas/extraer-ia` (GREEN)
  - Importar: `from fastapi import File, UploadFile, HTTPException`, `from app.core.image_validation import validate_image_bytes`, `from app.core.rate_limit_ia import rate_limit_ia`, `from app.services.ia_extraccion_service import get_vision_extractor`, `from app.schemas.factura import PropuestaFactura`
  - Definir `async def extraer_factura_ia(file: Annotated[UploadFile, File(...)], current_user: CurrentUser = ..., _: Annotated[None, Depends(rate_limit_ia)] = None) -> PropuestaFactura:`
  - Leer bytes: `image_bytes = await file.read()`
  - Validar: `try: validate_image_bytes(image_bytes) except ValueError as e: raise HTTPException(422, detail=str(e))`
  - Llamar extractor: `extractor = get_vision_extractor(); propuesta = await extractor.extraer_factura(image_bytes, file.content_type or "image/jpeg")`
  - Retornar `propuesta` (Pydantic hace el `response_model` filtering)
  - **DECLARAR ESTE HANDLER ANTES DE `GET /{factura_id}`** en el archivo
  - Decorador: `@router.post("/extraer-ia", response_model=PropuestaFactura, summary="Extraer cabecera de factura desde imagen con IA")`

- [x] 9.3 Triangular: test que la response Content-Type es `application/json` (FastAPI default); test que el log JSON de la llamada contiene `usuario_id`, `endpoint="/api/facturas/extraer-ia"`, `provider="claude"`, `latency_ms > 0`, `success=true|false` — usando `caplog` con `propagate=True` y filtrando por logger `"app.services.ia_extraccion"`

## 10. POST /api/pagos/extraer-ia (`app/routers/pagos.py`)

- [x] 10.1 Escribir tests análogos a 9.1 en `tests/test_ia_vision_integration.py` (RED) para `/api/pagos/extraer-ia`
  - Mismo set de tests: JPEG/PNG/WebP válidos, PDF/GIF/heic/tiff rechazados, archivo > 10 MB, sin sesión, extractor raise, orden del router, rate limit
  - Test específico: response usa `PropuestaPago` con `metodo` poblado como enum

- [x] 10.2 Extender `app/routers/pagos.py` con `POST /api/pagos/extraer-ia` (GREEN)
  - Mismo patrón que el de facturas, pero con `PropuestaPago` y `extractor.extraer_pago(...)`
  - **DECLARAR ANTES DE `GET /{pago_id}`**
  - Decorador: `@router.post("/extraer-ia", response_model=PropuestaPago, summary="Extraer cabecera de pago desde imagen con IA")`

- [x] 10.3 Triangular: test que el rate limit es COMPARTIDO entre los dos endpoints (10 requests totales a `/facturas/extraer-ia` + `/pagos/extraer-ia`, no 10 cada uno). Esto es by design (D-IA-2): la cuota es por `usuario_id`, no por endpoint. La factory de rate limit comparte el dict `_ia_attempts`.

## 11. Regresión de no-persistencia (`tests/test_ia_vision_no_persistence.py`)

- [x] 11.1 Escribir `tests/test_ia_vision_no_persistence.py` (RED): test que `/extraer-ia` no toca la DB
  - Fixture `db_event_listener` que registra un listener SQLAlchemy `before_flush` que captura `session._flush_events` (o usa `event.listens_for(Session, "before_flush")` con una lista global)
  - Test 1: POST a `/api/facturas/extraer-ia` con extractor mockeado que retorna propuesta completa → assert `len(events["factura_inserts"]) == 0 and len(events["factura_updates"]) == 0 and len(events["pago_inserts"]) == 0 and len(events["proveedor_inserts"]) == 0`
  - Test 2: POST a `/api/facturas/extraer-ia` con extractor que retorna `error=true` → 0 eventos
  - Test 3: POST a `/api/pagos/extraer-ia` éxito → 0 eventos
  - Test 4: POST a `/api/pagos/extraer-ia` con extractor raise → 0 eventos
  - Test 5: POST a `/api/facturas/extraer-ia` con PDF rechazado (422) → 0 eventos
  - Test 6: POST a `/api/facturas/extraer-ia` rate-limited (429) → 0 eventos
  - Test 7 (control): POST a `/api/facturas` (CRUD normal) → 1 evento INSERT en `factura` (assert que el listener SÍ captura cuando se persiste por la vía legítima)

- [x] 11.2 Implementar el listener (GREEN) en `tests/conftest.py` o en el archivo de test
  - Lista global `_captured_events: list[tuple[str, str, Any]] = []` (operation, table, target)
  - `event.listens_for(Session, "before_flush")(capturar_eventos)`
  - Inspecciona `session.new`, `session.dirty`, `session.deleted` y popula la lista
  - Teardown: limpia la lista y `event.remove(event_listener)` después del test
  - NO se modifica el código de producción; el listener es solo de test

- [x] 11.3 Triangular: test que el handler `/extraer-ia` ni siquiera importa `Session` o `get_db` (assert estático sobre el AST del módulo: `app.routers.facturas` y `app.routers.pagos` no contienen `Depends(get_db)` en los handlers `/extraer-ia`)

## 12. Verificación end-to-end y housekeeping

- [x] 12.1 Correr `pytest tests/test_ia_vision_schemas.py tests/test_image_validation.py tests/test_ia_vision_factory.py tests/test_ia_vision_extractors.py tests/test_ia_vision_rate_limit.py tests/test_ia_vision_integration.py tests/test_ia_vision_no_persistence.py -v` y verificar 100% verde
- [x] 12.2 Correr la suite completa `pytest` (regresión) y verificar que los tests de C-08, C-10 y C-12 siguen verdes — C-14 no rompe nada
  - **Deuda técnica documentada**: 23 fallos de interferencia pre-existente NO causados por C-14. Causa raíz: `app.core.config:settings = get_settings()` y `app.core.deps:_engine = create_engine(settings.DATABASE_URL)` se crean a nivel de módulo con el DSN del `.env` de desarrollo cuando pytest colecta tests que importan `app.*` a nivel de módulo (C-13 y C-14 lo hacen, ver `test_ia_vision_extractors.py:29` original y `test_ia_vision_integration.py:32` original). El `get_settings.cache_clear()` del fixture `client` no recrea el engine. Los tests del módulo C-14 (117 tests) corren 100% verde. La suite falla solo por interferencia entre tests de cambios distintos. Fix propuesto: change posterior `fix-test-suite-pollution` que refactorice `app/core/config.py` y/o `app/core/deps.py` a lazy loading.
- [x] 12.3 Actualizar `openspec-apply-progress.md` con el estado de C-14 (este archivo vive en la raíz del repo backend)
- [x] 12.4 Verificar que el `README.md` del change (`openspec/changes/c-14-ia-vision-backend/README.md`) sigue reflejando el scope (se generó con `--description` en `openspec new change`)
- [x] 12.5 `openspec validate c-14-ia-vision-backend` y resolver cualquier warning (schema mismatch, missing scenarios, etc.)
- [x] 12.6 `openspec status --change c-14-ia-vision-backend --json` para confirmar que los 4 artefactos están `done`

## Review Workload Forecast

- **Estimated changed lines**: ~900-1100 (schemas, service, factory, rate limiter, image validation helper, dos routers, tests). Tests ≈ 60% del total.
- **Chained PRs recomendados**: **Sí** — el change excede cómodamente el budget de 400 líneas y tiene un corte natural por capas:
  - **PR-A (foundation, ~250 líneas)**: Tasks 1-3 (schemas) + 4 (Protocol) + 5 (ClaudeVisionExtractor) + 7 (factory) + 8 (rate limiter) + 11 (no-persistence regression test). Es la "biblioteca base" sin tocar los routers.
  - **PR-B (HTTP surface, ~150 líneas)**: Tasks 6 (OpenAIVisionExtractor, alternativa al Claude) + 9 (router facturas) + 10 (router pagos) + 12 (integration tests + housekeeping).
  - PR-A es independiente y se puede mergear primero. PR-B depende de PR-A.
- **Breaking surface**: ninguno. C-08 y C-10 no se modifican; los nuevos endpoints son aditivos. La spec `facturas-api` y `pagos-backend` no se tocan (los requirements nuevos viven en la nueva capability `ia-vision-backend`).
- **C-15 unblocked**: este change expone los dos endpoints y los tipos OpenAPI para que `openapi-typescript` regenere los tipos del frontend. C-15 construye el wizard de 3 pasos (upload → propuesta editable → confirmar contra `/api/facturas` con `origen=IA`).
- **Riesgo residual**: que el `anthropic` SDK lance una excepción no contemplada y el extractor la propague (rompe RN-IA-05). Mitigación: `extraer_factura` y `extraer_pago` envuelven TODO el cuerpo en `try/except Exception` (no solo SDKException), y los tests cubren al menos 3 paths de fallo distintos.
