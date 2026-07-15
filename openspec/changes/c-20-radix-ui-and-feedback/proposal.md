# Proposal: c-20-radix-ui-and-feedback

## Why

El frontend del MVP funciona, pero arrastra tres deudas técnicas visibles que el housekeeping post-MVP (C-15a, C-16, C-17, C-18, C-19) no atacó por estar enfocado en bugs de infra y drift de specs. Las deudas, ordenadas por impacto real en el usuario:

**1. Modales y dialogs hechos a mano, sin a11y garantizada.** El patrón de modal custom vive en `facturas-proveedores-web/src/features/proveedores/ProveedoresPage.tsx:56-81` (backdrop + click-outside + stopPropagation) y se replica, con variantes, en formularios de factura, pago, y perfil. La consecuencia concreta: **no hay focus trap, no hay cierre con `Esc`, no hay `aria-modal` bien cableado al primer focusable, no hay scroll lock del body**. Para una PWA que se va a usar en mobile (donde el foco del teclado es más frágil), esto se nota.

**2. Feedback de éxito/errores bloqueante e inline.** `SuccessMessage` (`src/shared/components/SuccessMessage/SuccessMessage.tsx`) renderiza arriba del contenido y empuja la UI. Se usa en `ProveedoresPage.tsx:38-49`, en `ProveedorDetailPage`, y en el perfil. Para flujos de carga de factura/pago (donde el usuario clickea "Cargar", scrollea, y vuelve a home), un toast no-bloqueante que se autocierra es la UX esperada. Hoy no existe.

**3. Loading state sin el shimmer que ya está definido en CSS.** El keyframe `animate-shimmer` existe en `src/app/index.css:120-128` pero `LoadingState` no lo usa. El usuario ve un spinner genérico cuando podría ver un skeleton coherente con el sistema de design.

A esto se suma una **cuarta deuda transversal** documentada en `knowledge-base/09_decisiones_y_supuestos.md:32` (D-24): `npm run lint` está **roto**. La realidad verificada al investigar C-20 es **peor de lo que D-24 decía**: el script `lint` apunta a `eslint src --ext .ts,.tsx --report-unused-disable-directives --max-warnings 0` pero **eslint no está en `devDependencies`** y **no existe ningún archivo de configuración** (ni `eslint.config.*`, ni `.eslintrc*`). Correr `npm run lint` hoy falla con "command not found" o similar. La diagnosis de D-24 ("incompatibilidad entre v10 y v9") no aplica — no hay nada que sea incompatible porque no hay nada instalado. El alcance real es un **setup from scratch** de ESLint v9 (la versión moderna con config plana) con los plugins necesarios para que el lint pase limpio contra el código actual.

**Lo que NO se toca (decisiones explícitas):**

- **Tailwind v4 alpha queda como está.** Migrar a v3 estable es disruptivo y propio de un change con su design doc. El sistema de `@theme` con CSS vars está construido sobre v4.
- **No se introducen features nuevas.** El MVP está cerrado (KB §01). Este change es **refactor + housekeeping + UX polish**, sin tocar reglas de negocio, sin migraciones de DB, sin nuevos endpoints, sin cambios en la IA.
- **No se agrega Storybook.** Es otro orden de magnitud (tooling + infra + catálogos). Queda para C-20 si el equipo lo pide.
- **No se cambia el patrón de tests (Vitest + RTL + MSW).** Lo que se agrega son tests de regresión para los componentes migrados; lo que se mantiene son los tests existentes con sus `data-testid` y `aria-label` invariantes.

## What Changes

**Cambio 1 — Adoptar Radix Primitives (Dialog, AlertDialog, DropdownMenu, Popover, Tooltip).**

Reemplaza los modales custom por primitivos accesibles. Beneficios concretos: focus trap automático, cierre con `Esc`, scroll lock, `aria-modal` correcto, portales fuera del DOM tree del padre (sin z-index wars). El styling se hace con Tailwind y los tokens del `@theme` existente — **no se introduce shadcn/ui** porque el design system ya es custom (navy/cream/violet/Playfair Display) y shadcn traería CSS vars propias que habría que re-tematizar.

Componentes a migrar (en orden de riesgo, menor → mayor):

| Componente | Archivo actual | A migrar a |
|---|---|---|
| Modal de crear/editar proveedor | `ProveedoresPage.tsx:56-81` | `Radix Dialog` |
| Modal de confirmación de delete | `DeleteProveedorDialog.tsx` | `Radix AlertDialog` |
| Dropdown de acciones (futuro) | — | `Radix DropdownMenu` (preparación, no usado aún) |
| Popover de info (futuro) | — | `Radix Popover` (preparación) |
| Tooltip en íconos | — | `Radix Tooltip` (preparación) |

**Cambio 2 — Adoptar `sonner` para toasts no-bloqueantes.**

Reemplaza el `SuccessMessage` inline por `toast.success()` / `toast.error()` / `toast.loading()` con auto-dismiss. La integración se hace con el componente `<Toaster />` montado en `AuthenticatedLayout.tsx`. `SuccessMessage` se deprecá pero **no se borra en este change** (queda como export deprecated, para borrar en C-20 cuando se verifique que ningún flujo quedó huérfano). Las llamadas existentes en `ProveedoresPage`, `ProveedorDetailPage`, y perfil migran a `toast.success()`.

**Cambio 3 — Aplicar `animate-shimmer` a `LoadingState`.**

`LoadingState` hoy muestra un spinner. Se refactoriza para usar la keyframe ya definida (`src/app/index.css:120-128`) y renderizar un skeleton block. Mantiene la API pública (`<LoadingState />`).

**Cambio 4 — Atajos de teclado (`n`, `/`, `Esc`).**

Hook nuevo `useGlobalShortcuts` montado en `AuthenticatedLayout.tsx`. Atajos:
- `n` (sin foco en input) → navega a `/facturas/nueva` (default; configurable por ruta)
- `/` (sin foco en input) → focus al primer input de búsqueda/filtro de la página actual
- `Esc` → cierra el modal/dialog abierto (Radix ya lo hace, el hook no necesita intervenir)
- `g` + `p` (secuencia) → `/proveedores`
- `g` + `f` → `/facturas`
- `g` + `c` → `/pagos`

Los atajos se desactivan cuando el foco está en `<input>`, `<textarea>`, o `[contenteditable]` (vía `e.target instanceof HTMLElement` + tagName check). Tests con `userEvent.keyboard`.

**Cambio 5 — Setup from scratch de ESLint v9 con config plana (resuelve D-24).**

Instalar `eslint@^9.x` y los plugins necesarios en `devDependencies`:
- `typescript-eslint` (paquete unificado que reemplaza `@typescript-eslint/parser` + `@typescript-eslint/eslint-plugin`)
- `eslint-plugin-react`
- `eslint-plugin-react-hooks`
- `eslint-plugin-react-refresh` (recomendado por Vite para HMR)

Crear `eslint.config.js` (config plana, formato canónico de ESLint v9) en la raíz del web con reglas conservadoras que **pasen limpio contra el código actual** sin necesidad de tocar archivos productivos. El set de reglas se mantiene en el **umbral mínimo indispensable**: TypeScript-aware, React/hooks, y `no-unused-vars` con `_` prefix opt-out. Reglas más agresivas (`no-explicit-any`, `prefer-const` con autofix agresivo) se difieren a un change posterior con su propio design.

`package.json` script `lint` queda igual. La línea de comando es compatible con v9 flat config sin cambios.

Target: `npm run lint` sale con exit 0 y cero warnings (preservando el `--max-warnings 0` que ya estaba).

**Cambio 6 — Tests de regresión (TDD, como el resto del proyecto).**

Por cada componente migrado o nuevo:
- Test del comportamiento a11y con `jest-axe` o `@testing-library/jest-dom` matchers (`toHaveAccessibleName`, `toHaveRole`).
- Test del cierre con `Esc` en dialogs migrados.
- Test del focus trap en dialogs migrados (primer focusable recibe foco al abrir, vuelve al trigger al cerrar).
- Test del toast: aparece, se autocierra, no bloquea clicks fuera.
- Test de shortcuts: `n` navega, no se activa con foco en input.

Los tests existentes que asumen markup de modal custom (buscan `.fixed.inset-0`, por ejemplo) se actualizan para usar los `data-testid` que Radix provee o se les agrega un wrapper que preserve los hooks. **Ningún test existente se borra**; si la API pública del componente cambia, se actualiza el call site en el mismo PR.

**Cambio 7 — CI gate (deferred a C-20 si la infra lo soporta).**

Si el repo tiene CI configurado (no verificado en este proposal — se confirma en design), agregar el paso `npm run lint && npm run typecheck` al job de frontend. Si no hay CI, queda como mejora para C-20.

## Capabilities

### New Capabilities

- `frontend-ui-polish`: umbrella de housekeeping de UI que cubre (a) adopción de Radix Primitives para modales/dialogs/dropdowns/popovers/tooltips, (b) sistema de toasts no-bloqueantes con sonner, (c) hook `useGlobalShortcuts` con shortcuts `n`, `/`, `g+p`, `g+f`, `g+c`, y (d) skeleton con `animate-shimmer` aplicado a `LoadingState`. La capability **no introduce features de producto nuevas**: encapsula cómo se renderiza feedback y cómo se navega, no qué se muestra ni qué reglas aplican. Cubre el contrato de regresión: los atajos no se activan con foco en inputs, los dialogs cierran con Esc, los toasts no bloquean, el lint pasa.
- `frontend-lint-baseline`: resuelve D-24. Capability técnica que lockea el contrato "`npm run lint` corre y pasa con `--max-warnings 0`" mediante un test que ejecuta el script y verifica exit code 0. Si alguien toca `package.json` o la config de ESLint y rompe el lint, este test falla.

### Modified Capabilities

- `proveedores-frontend`: el modal de crear/editar proveedor en `ProveedoresPage.tsx` migra de custom backdrop a `Radix Dialog`. El comportamiento observable (abrir al click, cerrar al cancelar, focus al primer input, submit con validación) se mantiene. La spec existente que referencia el `data-testid` del modal se actualiza para reflejar el nuevo árbol DOM, **sin** cambiar el contrato funcional.
- `facturas-frontend`: el `FacturaFormPage` (que es route, no modal) no se toca, pero el `DeleteFacturaDialog` (si existe) y los `toast.success` que ya se llamen en el feature migran al sistema centralizado. Si no hay `DeleteFacturaDialog`, este delta queda vacío y se elimina de la lista.
- `pagos-frontend`: mismo criterio que `facturas-frontend`. Si el `PagoFormPage` tiene un patrón de modal custom para confirmación, se migra a `Radix AlertDialog`. Si no, delta vacío.
- `cuenta-corriente-frontend`: el `SuccessMessage` en `ProveedorDetailPage` migra a `toast.success()`. La contract "después de crear una factura o un pago, la cuenta corriente se invalida y se muestra feedback" se preserva — solo cambia el mecanismo de display.
- `perfil-frontend`: el `AvatarUploader` (que es un file picker + upload, no un modal) probablemente no se toca, pero si tiene algún `SuccessMessage` inline, migra a toast.

## Impact

**Code (frontend only, sin cambios de backend):**

- `facturas-proveedores-web/package.json` — agrega `@radix-ui/react-dialog`, `@radix-ui/react-alert-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `sonner`. Agrega `eslint@^9.x`, `typescript-eslint`, `eslint-plugin-react`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh` a devDependencies.
- `facturas-proveedores-web/src/shared/components/Toaster/` — nuevo: wrapper de `<Toaster />` con theming coherente al `@theme` (variables CSS para los colores de success/error/warning).
- `facturas-proveedores-web/src/shared/hooks/useGlobalShortcuts.ts` — nuevo hook.
- `facturas-proveedores-web/src/app/AuthenticatedLayout.tsx` — monta `<Toaster />` y `useGlobalShortcuts()`.
- `facturas-proveedores-web/src/features/proveedores/ProveedoresPage.tsx:46-83` — modal migrado a `Radix Dialog` (probablemente se mueva a un componente `ProveedorDialog` separado para testear aislado).
- `facturas-proveedores-web/src/features/proveedores/components/DeleteProveedorDialog.tsx` — migrado a `Radix AlertDialog`.
- `facturas-proveedores-web/src/shared/components/SuccessMessage/SuccessMessage.tsx` — marcado como `@deprecated` en JSDoc, **no borrado** (queda para C-20).
- `facturas-proveedores-web/src/shared/components/LoadingState/LoadingState.tsx` — refactor a skeleton con `animate-shimmer`.
- `facturas-proveedores-web/src/features/proveedores/ProveedoresPage.tsx:38-49` y similares — llamadas a `setSuccessMessage(...)` reemplazadas por `toast.success(...)`.
- `facturas-proveedores-web/src/features/proveedores/ProveedorDetailPage.tsx` — mismo criterio.
- `facturas-proveedores-web/src/features/perfil/PerfilPage.tsx` — mismo criterio si tiene `SuccessMessage`.

**New tests:**

- `facturas-proveedores-web/src/shared/components/Toaster/Toaster.test.tsx` — render, theme, position.
- `facturas-proveedores-web/src/shared/hooks/useGlobalShortcuts.test.tsx` — atajos se activan / no se activan con foco en input, `g` + `p` secuencia funciona, `Esc` no se intercepta (Radix lo maneja).
- `facturas-proveedores-web/src/shared/components/LoadingState/LoadingState.test.tsx` (nuevo si no existe) — renderiza skeleton, aplica `animate-shimmer`.
- `facturas-proveedores-web/src/features/proveedores/components/ProveedorDialog.test.tsx` (nuevo) — abre, cierra con Esc, focus trap, submit, cancelación. **Este test es el regression-guard del cambio**: si alguien migra de vuelta a custom, los `toHaveRole('dialog')` + `toHaveAccessibleName()` fallan.
- `facturas-proveedores-web/src/features/proveedores/ProveedoresPage.test.tsx` — actualiza los selectores que asumían el árbol DOM del modal custom.
- `facturas-proveedores-web/src/features/proveedores/components/DeleteProveedorDialog.test.tsx` — actualiza para `Radix AlertDialog`.
- `facturas-proveedores-web/src/shared/components/SuccessMessage/SuccessMessage.test.tsx` (si existe) — sigue pasando (el componente sigue exportado, ahora deprecated).
- `facturas-proveedores-web/tests/frontend-lint.test.ts` (nuevo, en raíz) — ejecuta `npm run lint` via `child_process.execSync` y asserta exit code 0. Este es el test que lockea la capability `frontend-lint-baseline`.

**Specs:**

- Nuevo: `openspec/changes/c-19-radix-ui-and-feedback/specs/frontend-ui-polish/spec.md` — contrato de la capability umbrella.
- Nuevo: `openspec/changes/c-19-radix-ui-and-feedback/specs/frontend-lint-baseline/spec.md` — contrato del lint.
- Delta: `openspec/changes/c-19-radix-ui-and-feedback/specs/proveedores-frontend/spec.md` (modificación de la spec existente archivada en C-07) — la sección sobre el modal de proveedor se reescribe para reflejar Radix.
- Si tras el design resulta que hay deltas en `facturas-frontend`, `pagos-frontend`, `cuenta-corriente-frontend`, o `perfil-frontend`, se agregan como delta specs en el change folder.

**Not impacted:**

- `facturas-proveedores-api/` (backend) — intacto. Ningún endpoint cambia, ningún schema cambia, ninguna migración.
- `knowledge-base/` — sin cambios (no se introducen patrones nuevos que necesiten catalogación; las capabilities Radix y sonner son detalle de implementación).
- `app/main.py`, `app/core/**`, `app/services/**`, `app/routers/**`, `app/repositories/**`, `app/models/**` — no se tocan.
- `app/rate_limit_ia.py` — no se toca.
- `app/core/security.py` (argon2, JWT) — no se toca.
- `openspec/changes/archive/**` — inmutable.
- `CHANGES.md` — se actualiza al archivar (C-19 marcado `[x]`).
- D-16 (uuid7), D-17 (tokens opacos), D-18 (origen IA), D-19 (modal IA bloqueante), D-20 (settings proxy), D-21 (alembic revisions específicas), D-22 (suite pollution), D-23 (fix en consumer) — **todas preservadas**, este change no las toca.

**Verification target después de GREEN:**

- `cd facturas-proveedores-web && npm run lint` → exit 0, sin warnings (resuelve D-24).
- `cd facturas-proveedores-web && npm run typecheck` → exit 0.
- `cd facturas-proveedores-web && npm test` → todos los tests pasan, incluyendo los nuevos de regression-guard.
- `cd facturas-proveedores-web && npm run build` → build limpio.
- Verificación manual: `n` abre "Cargar factura", `Esc` cierra un dialog abierto, un toast aparece al crear un proveedor y se autocierra.
- C-16 protected tests no se rompen (estos son backend, no aplica acá, pero queda documentado).
- `openspec validate c-19-radix-ui-and-feedback` clean.

## Known constraints (heredados del proyecto)

- **TDD estricto.** Cada task en `tasks.md` sigue RED → GREEN → TRIANGULATE → REFACTOR. Cada componente migrado tiene su test de regression-guard antes de migrar.
- **No `any` en TS** (regla del proyecto). Los wrappers de Radix se tipan con `React.ComponentProps<typeof Dialog.Root>` o similar.
- **No co-authored-by, no AI attribution en commits** (regla global).
- **Conventional commits** (regla global).
- **Multi-tenant preservado**: este change no toca autenticación ni autorización. La cookie httpOnly (D-10) sigue siendo el único mecanismo de sesión.
- **Sin features nuevas** (KB §01: MVP cerrado). Los atajos de teclado son UX polish, no feature.
- **Sin cambios en la IA de visión** (C-14, C-15, C-15a). El modal IA bloqueante (D-19) se preserva.
- **IA NUNCA persiste ni asigna proveedor** (RN-IA-04, RN-IA-06) — no aplica a este change, pero se preserva.
- **Sonner no agrega telemetría** que filtre datos de usuario: se verifica en el design phase que la config no habilite analytics.
- **Radix Dialog no rompe el patrón de test pollution del backend** (este change es frontend, no toca los 6 archivos pollutos de C-17).
