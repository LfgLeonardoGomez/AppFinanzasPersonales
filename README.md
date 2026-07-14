# 📒 Gestión de Facturas y Pagos a Proveedores

> Registro contable simplificado de cuentas a pagar, con **carga de facturas asistida por IA de visión** (sacás una foto y se autocompletan los datos) y **saldo de cada proveedor siempre actualizado**.

![Backend](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)
![Frontend](https://img.shields.io/badge/Frontend-React%20+%20TypeScript-61DAFB?logo=react&logoColor=black)
![DB](https://img.shields.io/badge/DB-PostgreSQL-4169E1?logo=postgresql&logoColor=white)
![IA](https://img.shields.io/badge/IA-Vision%20(Claude%20/%20OpenAI)-8A2BE2)
![Estado](https://img.shields.io/badge/Estado-MVP%20completo-brightgreen)

---

## 🧑‍🤝‍🧑 ¿Qué es esto? (explicación para cualquiera)

Imaginá que tenés un comercio chico. Cada semana te llegan **facturas de tus proveedores** (el que te trae la mercadería, el del alquiler, el de los servicios) y vos vas haciéndoles **pagos**. El problema de siempre: ¿cuánto le debo a cada uno? ¿Esta factura ya la pagué entera, a medias, o nada?

Esta aplicación resuelve exactamente eso. Es una **libreta de cuentas digital** para saber, en cualquier momento y sin hacer una sola cuenta a mano, **cuánto le debés a cada proveedor y en qué estado está cada factura**.

Y tiene un truco que ahorra tiempo: en lugar de tipear los datos de cada factura, **le sacás una foto** y una **inteligencia artificial** lee el papel y llena los campos por vos. Vos solo revisás y confirmás.

**Importante:** NO es un sistema de facturación (no emite comprobantes fiscales) ni un medio de pago (no mueve plata de verdad). Es un registro para llevar el control, nada más.

### ¿Qué podés hacer con la app?

- 🔐 **Crear tu cuenta** y entrar de forma segura. Tus datos son solo tuyos: nadie más los ve.
- 🏪 **Cargar tus proveedores** (el kiosco mayorista, el gasista, la empresa de luz, etc.).
- 🧾 **Registrar facturas** a mano o **sacándoles una foto** para que la IA las complete.
- 💸 **Registrar pagos** a cada proveedor.
- 📊 **Ver el saldo de cada proveedor** y el estado de cada factura (pendiente, pagada a medias, o pagada) al instante.
- 🕑 **Consultar el historial** de todo el "debe y haber" con cada proveedor.
- 🔎 **Buscar y filtrar** facturas por proveedor, estado o fechas.
- 🌗 Elegir **tema claro u oscuro**, que se recuerda esté donde estés (celular o computadora).

---

## 🛠️ Tecnologías

| Capa | Tecnología |
|---|---|
| **Backend** | Python · FastAPI · SQLModel + Pydantic · PostgreSQL · patrón Repository / Service / Router + Unit of Work · Alembic (migraciones) |
| **Frontend** | React · TypeScript · Vite · PWA · TanStack Query · Zustand · Axios · Tailwind CSS v4 |
| **Autenticación** | Cookies `httpOnly` (sin `localStorage`) · access token corto + refresh token · multi-usuario con datos aislados |
| **IA de visión** | Abstracción configurable (`VISION_PROVIDER`): Claude u OpenAI · extrae la cabecera de la factura desde una imagen |
| **Archivos** | Cloudinary (upload firmado desde el backend) |
| **Infra** | Backend dockerizado · frontend build estático · `docker compose` para desarrollo local |
| **Contratos** | Tipos TypeScript generados desde el OpenAPI del backend (`openapi-typescript`) |

---

## 💡 Decisiones de arquitectura que vale la pena mirar

Este proyecto se construyó alrededor de un puñado de **invariantes de negocio** deliberadas. No son detalles: son el corazón del diseño.

- **El saldo y el estado de las facturas NUNCA se guardan en la base de datos.** Se **calculan on-demand** cada vez que se piden. ¿Por qué? Porque un saldo guardado se desincroniza apenas alguien edita un pago viejo. Calcularlo siempre garantiza que jamás pueda estar "mal".
- **Estado de factura por FIFO.** Los pagos a un proveedor se imputan a sus facturas de la más vieja a la más nueva, sin que el usuario tenga que decidir a mano qué paga cada transferencia.
- **Un pago se asocia al proveedor, nunca a una factura puntual.** Refleja cómo funciona la realidad: pagás "a Juan", no "a la factura #37 de Juan".
- **Aislamiento total entre usuarios (multi-tenant).** Todo se filtra por `usuario_id` en la **capa de servicio**. Pedir un recurso de otro usuario devuelve **404** (no 403): ni siquiera confirmamos que exista.
- **La IA propone, el humano confirma.** El modelo de visión sugiere datos y un posible proveedor, pero **nunca** persiste ni asigna nada por su cuenta. La decisión final siempre es de la persona.

El detalle completo de reglas de negocio, modelo de datos y decisiones vive en [`knowledge-base/`](knowledge-base/README.md).

---
---

## 👩‍💻 Guía para desarrolladores / IT

A partir de acá, lo técnico.

### Estructura del monorepo

```
.
├── facturas-proveedores-api/   # Backend FastAPI (Python) — API REST, dominio, migraciones
├── facturas-proveedores-web/   # Frontend React + TypeScript (PWA con Vite)
├── knowledge-base/             # Base de conocimiento estructurada (fuente de verdad del negocio)
├── docs/                       # Documentación de visión, arquitectura y seguridad
├── openspec/                   # Especificaciones Spec-Driven (changes archivados por feature)
├── CHANGES.md                  # Roadmap: 15 changes en 9 fases, con camino crítico
├── docker-compose.yml          # Orquestación de desarrollo local (db · api · web)
└── docker-compose.override.yml # Overrides de desarrollo (hot reload, red interna)
```

### Requisitos

- **Docker Desktop** corriendo (la vía recomendada para levantar todo)
- Para desarrollo por fuera de Docker: **Python 3.11+** y **Node 20+**

### Puesta en marcha (Docker — recomendado)

```bash
# 1. Clonar
git clone https://github.com/LfgLeonardoGomez/AppFinanzasPersonales.git
cd AppFinanzasPersonales

# 2. Configurar las variables de entorno del backend
cp facturas-proveedores-api/.env.example facturas-proveedores-api/.env
#   → editar el .env y completar SECRET_KEY, CLOUDINARY_URL y la API key de IA

# 3. Levantar la stack completa (db + api + web)
docker compose up --build
```

Servicios disponibles:

| Servicio | URL | Descripción |
|---|---|---|
| **Web** | http://localhost:5173 | Frontend (Vite dev server / PWA) |
| **API** | http://localhost:8000 | Backend FastAPI |
| **API Docs** | http://localhost:8000/docs | Swagger UI autogenerado |
| **Health** | http://localhost:8000/health | Healthcheck del backend |
| **DB** | localhost:5432 | PostgreSQL 15 |

Las migraciones de Alembic se aplican automáticamente al arrancar el contenedor de la API.

Para bajar todo y borrar los datos:

```bash
docker compose down -v
```

### Variables de entorno

Todas las variables del backend están documentadas en [`facturas-proveedores-api/.env.example`](facturas-proveedores-api/.env.example). Las principales:

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Cadena de conexión a PostgreSQL |
| `SECRET_KEY` | Firma de los tokens JWT (mín. 32 chars aleatorios) |
| `CLOUDINARY_URL` | Subida firmada de imágenes |
| `VISION_PROVIDER` | `claude` u `openai` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Credencial del proveedor de visión elegido |
| `FRONTEND_ORIGIN` | Origen permitido para CORS con credenciales |

> 🔒 El `.env` con secretos reales **nunca** se commitea (está en `.gitignore`). Solo se versiona el `.env.example` con placeholders.

### Testing

- **Backend:** los tests corren contra **PostgreSQL real** vía contenedores (nunca SQLite). Los servicios externos (Cloudinary, modelo de visión) van **siempre mockeados**.
- **Frontend:** testing de componentes y E2E sobre la PWA.

### Metodología: Spec-Driven Development

El proyecto se desarrolló con un flujo **spec-first** usando [OpenSpec](openspec/). Cada feature (autenticación, proveedores, facturas, pagos, cuenta corriente, IA) nació como un *change* con su propuesta, diseño, especificación y checklist de tareas **antes** de escribir código. El historial completo de esos changes está archivado en [`openspec/changes/archive/`](openspec/changes/archive/) y el roadmap en [`CHANGES.md`](CHANGES.md).

---

## 📄 Licencia

Proyecto personal con fines de demostración. Todos los derechos reservados salvo indicación contraria.
