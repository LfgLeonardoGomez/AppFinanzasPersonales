# Handoff: Rediseño visual — App de Finanzas Personales (proveedores/facturas)

## Overview
Rediseño completo de la app `facturas-proveedores-web`, alineado a
`specs/design/CLAUDE_DESIGN_PROMPT.md`, `BRAND.md`, `HOME.md` e `IA_EXPERIENCE.md`
del repo. Reemplaza el dashboard tipo bento-grid y el flujo de carga en dos
pasos (selector de modo + formulario) por una experiencia centrada en la carga
asistida por IA como acción protagonista, con violeta como color de marca
principal y magenta/rosa como acento.

Ver el diagnóstico completo de por qué se rediseñó cada pantalla en
`specs/design/DESIGN_REVIEW.md` (incluido en este handoff).

## About the Design Files
Los archivos `.html` en `screens/` son **referencias de diseño**, prototipos
construidos para mostrar look & behavior — no son código de producción para
copiar tal cual. La tarea es **recrear estos diseños en el entorno real del
proyecto** (React + TypeScript + Vite + Tailwind, según la estructura ya
existente en `facturas-proveedores-web/src`), reutilizando sus componentes,
rutas, hooks y patrones establecidos (`@shared/components`, `FacturaForm`,
`SupplierSearch`, etc.), no reemplazando la arquitectura.

## Fidelity
**Alta fidelidad (hifi)**: colores, tipografía, espaciados y estados están
definidos con valores finales. Recrear pixel-perfect usando los componentes y
utilidades ya existentes en el codebase (Tailwind classes, no los estilos
inline del prototipo).

## Screens / Views
Cada pantalla tiene versión desktop y mobile en el mismo archivo, lado a lado.

### 1. Home (`Home.dc.html`)
**Purpose**: Punto de entrada. Reemplaza el "Panel de control" bento-grid.
**Layout**: Sidebar fijo (232px, desktop) + contenido principal con: saludo,
superficie de carga IA (destacada), fila de proveedores frecuentes (cards),
lista de actividad reciente. Mobile: header + scroll vertical + bottom tab bar
(5 ítems: Home, Proveedores, Facturas, Pagos, Perfil).
**Componentes clave**:
- Logo: círculo 28px (desktop) / 32px (mobile), `linear-gradient(135deg,#7c3aed,#e0459b)`.
- Sidebar nav: ítems con icono lineal 16×16 (proveedores = dos círculos,
  facturas = rectángulo con líneas, pagos = rectángulo con banda, perfil =
  persona), estado activo con fondo `#f2ecfd` y texto `#4c1d95`.
- Card de carga IA: `border-radius:20px`, fondo
  `linear-gradient(135deg,#7c3aed 0%,#9333ea 55%,#d6409f 100%)`, ícono en
  chip translúcido, CTA "Subir imagen" (botón blanco, texto `#6d28d9`) y link
  "Cargar manual" — ambos navegan al modal de carga.
- Cards de proveedor frecuente: nombre, saldo (rojo `#dc2626` si hay deuda,
  `#18151f` si $0), última factura, botones Factura/Pago.
- Actividad reciente: lista con punto de color (violeta = factura, magenta =
  pago), título, proveedor + tiempo relativo, monto.

### 2. Modal de carga IA/manual (`Carga IA.dc.html`)
**Purpose**: Único flujo para cargar factura o pago, con o sin imagen —
reemplaza el `ModeSelector` de pantalla completa + modal separado.
**Layout**: Modal centrado 560px de ancho, alto fijo por estado (contenedor de
148px de min-height para el bloque de origen, para que no cambie de tamaño al
alternar imagen/manual).
**Estados** (máquina de estados en un mismo modal):
1. **Origen**: toggle Factura/Pago arriba, toggle Con imagen/Manual, dropzone
   (si imagen) o mensaje explicativo (si manual), botón Continuar (deshabilitado
   hasta subir imagen si el origen es imagen).
2. **Processing**: ícono con `animation: pulse 1.4s infinite`, texto "La IA
   está leyendo el documento…".
3. **Review**: card de proveedor sugerido (chip + nombre + "Cambiar"), campos
   editables Fecha / Número (o Medio de pago) / Monto, botones Volver /
   Confirmar. Banner violeta claro "revisá y corregí" solo si vino de imagen.
4. **Success**: check verde, texto de confirmación, CTA "Ver cuenta corriente".
**Colores de estado**: pendiente `#fef3c7`/`#92400e`, pagada `#ecfdf5`/`#065f46`,
parcial `#fdeaf4`/`#9d174d`.

### 3. Detalle de proveedor / cuenta corriente (`Detalle Proveedor.dc.html`)
**Purpose**: Vista central de gestión de un proveedor.
**Layout**: Header con nombre/CUIT + acciones (Cargar factura, Cargar pago,
Editar). Grid 320px/1fr: card de saldo (grande, `$36px` bold, rojo si hay
deuda) + panel con **toggle Facturas / Pagos / Historial** (pills, mismo
componente, cambia solo el contenido de la tabla/lista de abajo — no hay ya
una sección de historial separada).
**Mobile**: mismo contenido en columna única, toggle de 3 pills full-width.

### 4. Listados (`Listado Proveedores.dc.html`, `Listado Facturas.dc.html`, `Listado Pagos.dc.html`)
**Purpose**: Vistas globales, siempre cards/listas de baja densidad — nunca
tablas (esas quedan solo para cuenta corriente).
- Proveedores: grid de 3 columnas (desktop) de cards con saldo y acciones
  rápidas; buscador arriba.
- Facturas: filtros por estado (pills) + lista con chip de proveedor, número,
  fecha, estado, monto.
- Pagos: lista simple con medio de pago, fecha, monto en verde con signo "-".

### 5. Crear/editar proveedor (`Proveedor Form.dc.html`)
**Purpose**: Alta y edición de proveedor (pantalla que no existía en la v1).
**Layout**: Card centrada con toggle Crear/Editar (solo para esta demo — en
producción son dos rutas o un modo determinado por prop), campos Nombre,
CUIT, Teléfono, Email, Notas (textarea), botones Cancelar/Guardar, y
"Eliminar proveedor" solo en modo edición.

### 6. Auth (`Auth.dc.html`)
**Purpose**: Login y registro.
**Layout**: Desktop split-screen (panel de marca con gradiente + tagline a la
izquierda, formulario a la derecha). Mobile: panel de marca compacto arriba +
formulario abajo. Toggle Ingresar/Crear cuenta como pills.

### 7. Perfil (`Perfil.dc.html`)
**Purpose**: Datos de cuenta y preferencias.
**Layout**: Avatar circular con inicial + nombre + email, card "Cuenta"
(nombre empresa, CUIT, contraseña), card "Preferencias" (toggles), botón
"Cerrar sesión" (borde/texto rojo `#dc2626`).

## Interactions & Behavior
- Modal de carga: máquina de estados `origen → processing → review → success`,
  ver lógica en `c_dc_js` de `Carga IA.dc.html` (setTimeout de 1.1s simula el
  procesamiento IA — en producción reemplazar por la llamada real).
- Detalle de proveedor: toggle de tabs client-side, sin recarga.
- Navegación entre pantallas implementada con links `<a href="archivo.html">`
  entre los prototipos — en producción son rutas del router ya existente
  (`react-router` o el que use el proyecto).
- Auth: toggle Ingresar/Crear cuenta cambia campos visibles (nombre solo en
  registro) y copy del CTA/footer.

## State Management
- Carga IA: `step` (origen/processing/review/success), `tipo` (factura/pago),
  `origen` (imagen/manual), campos de fecha/número/monto editables.
- Detalle de proveedor: `tab` (facturas/pagos/historial).
- Auth: `mode` (login/register).
- Proveedor Form: `mode` (crear/editar) + campos del formulario.

## Design Tokens

**Colores**
- Violeta primario: `#7c3aed` (acciones, foco, nav activo)
- Violeta oscuro (hover/texto sobre violeta claro): `#6d28d9` / `#4c1d95`
- Magenta/rosa acento: `#d6409f` / `#e0459b`
- Gradiente IA: `linear-gradient(135deg,#7c3aed 0%,#9333ea 55%,#d6409f 100%)`
- Fondo de página: `#f2f0ec` (beige muy claro)
- Fondo de superficie/card: `#fdfcfb` / `#fff`
- Borde sutil: `#eeece7` / `#f1efe9`
- Texto principal: `#18151f`
- Texto secundario: `#8a8598` / `#5b5670`
- Estados: pendiente `#fef3c7`/`#92400e`, pagada `#ecfdf5`/`#065f46`, parcial
  `#fdeaf4`/`#9d174d`, deuda `#dc2626`, cobrado/pago `#059669`

**Tipografía**: Inter (400/500/600/700/800), sans-serif en todos los tamaños
(no hay serif — se retira Playfair Display de la v1).

**Radios**: pills/botones `999px`, cards `14–20px`, chips `8–10px`.

**Sombras**: `0 1px 2px rgba(24,21,31,0.04), 0 24px 64px rgba(24,21,31,0.10-0.14)`
para los "frames" de dispositivo/ventana del prototipo (no necesariamente
aplicables 1:1 a producción).

## Assets
Sin imágenes — todos los íconos son formas CSS simples (círculos, rectángulos
con `border`). Ningún asset externo que copiar.

## Files
Prototipos HTML en la raíz de este proyecto (incluidos en `screens/`):
- `Home.dc.html`
- `Carga IA.dc.html`
- `Detalle Proveedor.dc.html`
- `Listado Proveedores.dc.html`
- `Listado Facturas.dc.html`
- `Listado Pagos.dc.html`
- `Proveedor Form.dc.html`
- `Auth.dc.html`
- `Perfil.dc.html`

Diagnóstico de diseño: `DESIGN_REVIEW.md`.
