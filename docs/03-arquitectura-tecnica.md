# Arquitectura Técnica — MVP

## Repositorios

Dos repos separados, sin monorepo.

- `facturas-proveedores-api` (backend, FastAPI)
- `facturas-proveedores-web` (frontend, PWA)

El frontend consume la API exclusivamente vía HTTP/JSON. Los tipos TypeScript se generan desde el schema OpenAPI que FastAPI expone automáticamente en `/openapi.json`, usando `openapi-typescript`, para no duplicar definiciones de tipos a mano entre back y front.

---

## Backend (`facturas-proveedores-api`)

### Patrón

Repository / Service / Router, consistente con el approach ya usado en el proyecto FoodStore:

```
app/
├── main.py
├── core/
│   ├── config.py          # variables de entorno
│   ├── security.py        # hash de password, manejo de cookie/JWT
│   └── unit_of_work.py    # UnitOfWork para operaciones atómicas
├── models/                # SQLModel (tablas)
│   ├── usuario.py
│   ├── proveedor.py
│   ├── factura.py
│   └── pago.py
├── schemas/                # Pydantic (request/response)
│   ├── proveedor.py
│   ├── factura.py
│   └── pago.py
├── repositories/           # acceso a datos, sin lógica de negocio
│   ├── proveedor_repository.py
│   ├── factura_repository.py
│   └── pago_repository.py
├── services/                # lógica de negocio (cálculo de saldo, estado de factura, reglas)
│   ├── usuario_service.py    # registro, perfil
│   ├── proveedor_service.py
│   ├── factura_service.py
│   ├── pago_service.py
│   └── ia_extraccion_service.py   # abstracción del modelo de visión
└── routers/                 # endpoints HTTP, autorización
    ├── auth.py
    ├── usuarios.py           # perfil del usuario
    ├── proveedores.py
    ├── facturas.py
    └── pagos.py
```

### Reglas de capas

- La autorización (verificar que el recurso pertenece al usuario autenticado) vive en el **service layer**, no en el router.
- El cálculo de saldo y estado de factura vive en el service layer, no en el repository (que solo hace queries) ni en el router.
- Crear/editar/eliminar factura o pago que requiera tocar más de una tabla en una sola operación usa `UnitOfWork` para garantizar atomicidad.

### Subida de archivos

Cloudinary se usa para **tres tipos de archivo**: archivos de factura (`archivo_url`), comprobantes de pago (`comprobante_url`) y avatares de usuario (`avatar_url`).

Flujo recomendado: el frontend sube directo a Cloudinary (con un upload preset firmado desde el backend, no uno abierto sin firma) y solo envía la URL resultante al backend para persistir. Esto evita que el backend reciba y reenvíe binarios pesados. Validar tipo (PDF/jpg/png) y tamaño máximo tanto en cliente como al persistir (no confiar solo en el `content-type` del cliente). Detalle en `04-baseline-seguridad.md`.

### IA de extracción (abstracción de proveedor de visión)

`ia_extraccion_service.py` expone una **interfaz agnóstica del proveedor**, para poder cambiar de modelo y comparar resultados sin tocar el resto del código:

```
class VisionExtractor (interfaz)
    extraer_factura(imagen) -> PropuestaFactura   # proveedor, numero, fecha, monto_total
    extraer_pago(imagen)    -> PropuestaPago       # proveedor, monto, fecha, metodo

Implementaciones: ClaudeVisionExtractor, OpenAIVisionExtractor, ...
```

- El extractor concreto se elige por variable de entorno (`VISION_PROVIDER`).
- El **prompt** y el **schema JSON esperado** son compartidos; cada implementación adapta la llamada a su API pero devuelve la misma estructura normalizada (Pydantic).
- El service **parsea y valida** la salida del modelo contra el schema estricto: campo ausente → `null`, **nunca se inventa**.
- El service **nunca persiste nada**: devuelve una propuesta al router. La persistencia ocurre solo cuando el usuario confirma el formulario.
- La extracción corre sobre **imágenes** en el MVP. La lectura de PDF queda como implementación futura detrás de la misma interfaz.

---

## Frontend (`facturas-proveedores-web`)

### Stack

React + TypeScript + Vite, TanStack Query (estado de servidor), Zustand (estado de UI local, ej. tema), Axios, Tailwind CSS v4.

### Estructura (feature-based)

```
src/
├── features/
│   ├── auth/
│   ├── proveedores/
│   ├── facturas/
│   ├── pagos/
│   └── cuenta-corriente/
├── shared/
│   ├── components/
│   ├── hooks/
│   └── api/            # cliente Axios + tipos generados desde OpenAPI
└── app/
    ├── router.tsx
    └── theme/           # claro/oscuro
```

### PWA

Configurar `manifest.json` + service worker (vía plugin de Vite para PWA) para que sea instalable desde el navegador tanto en celular como en PC, sin necesidad de tienda de aplicaciones.

---

## Despliegue

| Componente | Dónde |
|---|---|
| Backend (FastAPI + Postgres) | VPS Oracle Cloud Free Tier (1GB RAM), vía Docker |
| Frontend (build estático) | Vercel o Netlify |
| Imágenes/archivos | Cloudinary |

Nota de capacidad: con 1GB de RAM total en el VPS, FastAPI + Postgres conviven sin problema siempre que no se sumen procesos pesados adicionales en la misma instancia (justifica la elección de FastAPI sobre un runtime más pesado para este entorno).

---

## Autenticación cross-origin (importante)

Frontend (Vercel) y backend (VPS Oracle) van a estar en **orígenes/dominios distintos**. Con auth por cookie httpOnly, esto convierte a la cookie en "de terceros" y **Safari/iOS la bloquea por defecto** — justo los usuarios móviles a los que se les quiera mostrar la app.

**Enfoque recomendado:** usar un *rewrite/proxy* en el frontend (ej. Vercel rewrites: `/api/*` → backend). Así el navegador ve front y API como **mismo origen**, la cookie es de primera parte, no hay problema de Safari y no hace falta configurar CORS.

**Fallback (orígenes separados de verdad):** cookie con `SameSite=None; Secure; HttpOnly`, CORS con origen explícito del frontend y `credentials: true` (nunca wildcard con credenciales). Requiere **HTTPS en ambos extremos** (Vercel ya lo da; el VPS necesita certificado TLS, ej. Let's Encrypt vía Caddy/Nginx). Tener presente la limitación de Safari/ITP con cookies de terceros.

---

## Variables de entorno esperadas (backend)

```
DATABASE_URL=
SECRET_KEY=
CLOUDINARY_URL=
VISION_PROVIDER=claude          # claude | openai | ...
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
ACCESS_TOKEN_TTL_MIN=           # vida del access token (ej. 30)
REFRESH_TOKEN_TTL_DAYS=         # vida del refresh con "recordarme" (ej. 30)
FRONTEND_ORIGIN=                # para CORS en el fallback de orígenes separados
COOKIE_DOMAIN=
```
