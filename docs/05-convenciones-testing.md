# Convenciones de Testing — MVP

Objetivo: que el agente escriba pruebas que cubran la lógica que más fácil se rompe (cálculo de saldo, estado FIFO, validaciones y aislamiento entre usuarios), sin volverse dogmático con la cobertura.

Regla transversal: **los servicios externos (Cloudinary, modelo de visión) se mockean siempre. Ningún test llama a una API real.**

---

## Backend (FastAPI)

### Herramientas
- **pytest** como runner.
- **FastAPI TestClient** (o `httpx.AsyncClient`) para tests de routers.
- Base de datos de prueba: **Postgres descartable** (Docker / testcontainers) o una base dedicada de test. Evitar SQLite como sustituto, porque difiere de Postgres en tipos y agregaciones.
- Fixtures/factories para datos de prueba (usuarios, proveedores, facturas, pagos).

### Estructura
- `tests/` espejando `app/` (unit de services y repositories, integración de routers).

### Casos de prueba obligatorios
**Cálculo de saldo del proveedor:**
- Proveedor sin movimientos → saldo 0.
- Mezcla de facturas y pagos → saldo correcto (deuda).
- Pagos > facturas → saldo negativo (saldo a favor).

**Estado FIFO de facturas:**
- Factura sin pagos → PENDIENTE.
- Factura cubierta en parte (ej. $100.000 con $30.000 de pool) → PARCIAL.
- Factura cubierta entera → PAGADA.
- Varias facturas + un pago que alcanza solo para las más viejas → las viejas PAGADAS/PARCIAL, las nuevas PENDIENTE.
- Sobrante de pagos tras cubrir todo → remanente reportado como saldo a favor.
- **Determinismo del desempate**: dos facturas con la misma `fecha_emision` → el orden por `(created_at, id)` produce siempre el mismo resultado.
- Editar/borrar una factura o pago → el saldo y los estados se recalculan correctamente.

**Aislamiento multi-usuario:**
- Un usuario no puede leer ni modificar proveedores/facturas/pagos de otro (respuesta 404).
- Invariante: no se puede crear un pago/factura apuntando a un proveedor de otro usuario.

**Validaciones:**
- `monto <= 0` rechazado.
- `fecha_emision` / `fecha` futura rechazada (zona UTC-3).
- Formato de CUIT inválido rechazado.
- Tipo/tamaño de archivo inválido rechazado.

**Autenticación:**
- Login correcto setea cookie; login incorrecto → mensaje genérico.
- Endpoints protegidos rechazan sin sesión.
- "Recordarme" produce sesión persistente vs. de sesión.

**Extracción por IA (con el extractor mockeado):**
- El service devuelve la propuesta normalizada a partir de una salida fija del modelo.
- Campo no leído → `null`, nunca inventado.
- El service **no persiste** nada por sí mismo.
- Fallo del modelo → se maneja sin romper, deja el formulario disponible.

---

## Frontend (React + TypeScript)

### Herramientas
- **Vitest** + **React Testing Library**.
- **MSW (Mock Service Worker)** para simular la API (no pegarle al backend real).

### Casos de prueba sugeridos
- Formularios de factura y pago: validación de campos y flujo de confirmación.
- Flujo de **precarga por IA**: con API mockeada, los campos se rellenan y el usuario puede editar antes de confirmar; nada se envía hasta "Confirmar".
- Flujo de **vinculación de proveedor**: sugerencia por coincidencia, "Buscar proveedor", crear nuevo.
- Toggle de tema claro/oscuro y su persistencia.
- Hooks de datos (TanStack Query) con MSW.

---

## Convenciones generales

- Estructura **AAA** (Arrange–Act–Assert).
- Nombres de test descriptivos y consistentes (elegir un idioma y mantenerlo).
- Cada test es independiente y repetible (sin depender del orden ni de estado compartido).
- Cobertura **pragmática**: priorizar services y lógica de saldo/estado (apuntar alto ahí), sin perseguir 100% global.
- **CI opcional** (ej. GitHub Actions) que corra los tests en cada PR.
