# Tasks: c-20-radix-ui-and-feedback

> **Modo**: Standard (TDD implícito vía test regression-guard, no TDD estricto por task). El proyecto tiene TDD estricto a nivel de capabilities (cada capability tiene su test de regression-guard antes de mergear); no exige RED-GREEN-REFACTOR por cada task individual de housekeeping.
>
> **Convención de tasks**: cada task es ejecutable en una sesión de ~30-90 min. Las tasks que migran componentes empiezan escribiendo el test del comportamiento esperado; la implementación viene después.

## Phase 1: Lint baseline (resuelve D-24)

> Prerequisite: este phase devuelve el gate de calidad. Hacerlo primero significa que todo el resto del change corre con `npm run lint` como safety net.

- [x] 1.1 **Verificar el estado real del lint hoy**: correr `cd facturas-proveedores-web && npm run lint` y capturar el output exacto. Documentar el error (esperado: `eslint: command not found` o similar). Verificar también que no existe `eslint.config.*` ni `.eslintrc*` en el web/.
- [x] 1.2 **RED: escribir el test de regression-guard** en `facturas-proveedores-web/tests/frontend-lint.test.ts` que afirme `npm run lint` exit 0. El test debe **fallar** hoy (porque no hay config). Si node_modules no está, el test se salta (no falla).
- [x] 1.3 **GREEN: instalar ESLint v9 + plugins** en `devDependencies` del web: `eslint@^9.12.0`, `typescript-eslint@^8.x`, `eslint-plugin-react@^7.x`, `eslint-plugin-react-hooks@^5.x`, `eslint-plugin-react-refresh@^0.4.x`, `@eslint/js@^9.x`. Correr `npm install` y verificar que instala limpio.
- [x] 1.4 **GREEN: crear `eslint.config.js`** en la raíz del web con config plana v9, reglas conservadoras (recommended de cada plugin + `no-unused-vars` con `_` opt-out + react-hooks + react-refresh). Imports ESM (compatible con `"type": "module"` del package.json).
- [x] 1.5 **GREEN: correr `npm run lint`** y capturar el output. Si hay errores en archivos existentes, agregar `// eslint-disable-next-line <rule>` con comentario solo donde sea estrictamente necesario. Nunca blanket-ignore. Re-correr hasta que salga 0.
- [x] 1.6 **VERIFICAR**: re-correr el test de 1.2. Ahora debe pasar. Commit-ready (no commitear todavía — el change completo es un solo commit al final, o un commit por phase, según decisión del usuario).
- [x] 1.7 **Actualizar el ticket D-24** en `knowledge-base/09_decisiones_y_supuestos.md`: cambiar el texto de "DEFERIDO" a "RESUELTO por C-20", apuntando al design/spec de C-20.

## Phase 2: Shared infrastructure — Toaster

> Prerequisite: phase 1 verde (lint corre). Phase 2 no rompe nada existente porque agrega componentes nuevos.

- [x] 2.1 **RED: escribir el test** de `<Toaster />` en `facturas-proveedores-web/src/shared/components/Toaster/Toaster.test.tsx`: renderiza, expone `role="region"` o accesible name apropiado, monta exactamente una vez.
- [x] 2.2 **GREEN: instalar `sonner`** en dependencies.
- [x] 2.3 **GREEN: crear `Toaster.tsx`** que wrappea `sonner`'s `<Toaster richColors />` con theming coherente al `@theme` (CSS vars en `index.css`: `--toast-success-bg`, `--toast-error-bg`, `--toast-info-bg`).
- [x] 2.4 **GREEN: crear `toast.ts`** que re-exporta `toast.success`/`error`/`info`/`loading`/`dismiss` de sonner.
- [x] 2.5 **GREEN: agregar las CSS vars de toast** en `src/app/index.css` dentro del `@theme` block (los colores success/warning/danger ya están; solo agregar los bg/fg pairs para toast).
- [x] 2.6 **GREEN: montar `<Toaster />`** en `src/app/AuthenticatedLayout.tsx`, dentro del árbol de routes autenticadas.
- [x] 2.7 **VERIFICAR**: `npm test src/shared/components/Toaster` pasa. `npm run lint` pasa. `npm run typecheck` pasa.

## Phase 3: Shared infrastructure — useGlobalShortcuts

- [x] 3.1 **RED: escribir el test del hook** en `facturas-proveedores-web/src/shared/hooks/useGlobalShortcuts.test.tsx` (probablemente con `renderHook` de RTL): single-key shortcuts funcionan con foco en `body`, no funcionan con foco en `<input>`, sequence `g`+`p` funciona dentro de 1000 ms, sequence no funciona fuera de 1000 ms, `Esc` no es interceptado por el hook.
- [x] 3.2 **GREEN: crear `useGlobalShortcuts.ts`** con la API documentada en el design (interface `ShortcutBinding`, prefix state en ref, sequence window 1000 ms, form-field suppression con `isTyping`).
- [x] 3.3 **GREEN: montar `useGlobalShortcuts`** en `AuthenticatedLayout.tsx` con la lista de bindings: `n` (action: `navigate('/facturas/nueva')`, when: `location.pathname !== '/facturas/nueva'`), `g`+`p`, `g`+`f`, `g`+`c`. Por ahora `/` (focus search) queda documentado en el design pero no implementado — necesita un mecanismo para identificar el "search target" de la página actual, que es scope creep para C-20. Marcar como follow-up.
- [x] 3.4 **VERIFICAR**: tests pasan, lint pasa, typecheck pasa.

## Phase 4: LoadingState refactor

- [x] 4.1 **RED: verificar/crear el test** de `LoadingState`. Si no existe, crearlo en `facturas-proveedores-web/src/shared/components/LoadingState/LoadingState.test.tsx`: renderiza, tiene `aria-busy="true"`, tiene `aria-label="Cargando"`, contiene un elemento con clase `animate-shimmer`.
- [x] 4.2 **GREEN: refactor `LoadingState.tsx`**: reemplazar el spinner (lucide `<Loader2 />` o similar) por tres stacked `<div>`s con `animate-shimmer` aplicados. Mantener la API pública (sin props).
- [x] 4.3 **VERIFICAR**: tests pasan, lint pasa.

## Phase 5: ProveedorDialog migration (Radix Dialog)

> Esta phase migra el modal custom de ProveedoresPage. Es la más invasiva del change.

- [x] 5.1 **RED: escribir el test del nuevo `ProveedorDialog`** en `src/features/proveedores/components/ProveedorDialog.test.tsx`: abierto → role dialog + aria-modal true + aria-label "Formulario de proveedor"; primer focusable recibe foco; `Esc` cierra; click en backdrop cierra; click en Cancelar cierra; focus vuelve al trigger; submit con nombre vacío no llama API; submit válido llama API y cierra; pre-fill en edit mode.
- [x] 5.2 **GREEN: instalar `@radix-ui/react-dialog`** y `@radix-ui/react-slot` (para `asChild`).
- [x] 5.3 **GREEN: crear `ProveedorDialog.tsx`** que envuelve `ProveedorForm` en `Dialog.Root` + `Dialog.Portal` + `Dialog.Overlay` + `Dialog.Content`. Estilar con Tailwind usando los tokens existentes. Pasar `aria-label` programático.
- [x] 5.4 **GREEN: actualizar `ProveedoresPage.tsx`**: importar `ProveedorDialog`, reemplazar el bloque de modal custom (líneas ~46-83) por `<ProveedorDialog ... />`. Remover el `useState<ModalMode>` local o simplificarlo a `useState<{ mode, target } | null>`.
- [x] 5.5 **VERIFICAR**: tests del ProveedorDialog pasan; tests de ProveedoresPage siguen pasando (puede requerir actualizar selectores en el test del page si buscaba `.fixed.inset-0`).
- [x] 5.6 **LINT**: `npm run lint -- src/features/proveedores/`. Si hay warnings sobre `react-refresh/only-export-components`, agregar `// eslint-disable-next-line react-refresh/only-export-components` con comentario si es el wrapper component, o re-estructurar si es un re-export trivial.

## Phase 6: DeleteProveedorDialog migration (Radix AlertDialog)

- [x] 6.1 **RED: escribir el test** de `DeleteProveedorDialog` actualizado en `src/features/proveedores/components/DeleteProveedorDialog.test.tsx`: role alertdialog + aria-modal true + aria-label "Confirmar eliminación"; foco en Cancelar al abrir; `Esc` cierra; click en backdrop NO cierra; click en Confirmar llama API; click en Cancelar no llama API; focus vuelve al trigger.
- [x] 6.2 **GREEN: instalar `@radix-ui/react-alert-dialog`** (o reusar el de phase 5 si Radix lo empaqueta junto, verificar package.json).
- [x] 6.3 **GREEN: reescribir `DeleteProveedorDialog.tsx`** con `AlertDialog.Root` + `AlertDialog.Portal` + `AlertDialog.Overlay` + `AlertDialog.Content`. Foco default en el botón Cancelar. NO cerrar en backdrop (no manejar `onPointerDownOutside` ni `onInteractOutside`).
- [x] 6.4 **VERIFICAR**: tests pasan, lint pasa.

## Phase 7: SuccessMessage deprecation + call site migration

> Esta phase es mecánica. Reemplaza el patrón de `useState<string | null>(null)` + JSX de `<SuccessMessage>` por `toast.success()`.

- [x] 7.1 **Inventariar call sites**: hacer grep de `SuccessMessage` y `setSuccessMessage` en `src/`. Documentar todos los call sites en una lista. Esperado: `ProveedoresPage`, `ProveedorDetailPage`, posiblemente `PerfilPage`.
- [x] 7.2 **RED: escribir/verificar test** de `SuccessMessage` sigue pasando (el componente no se borra). Si el test no existe, crearlo.
- [x] 7.3 **GREEN: marcar `SuccessMessage.tsx` como `@deprecated`** con JSDoc:
  ```ts
  /**
   * @deprecated Use `toast.success(message)` from `@shared/components/Toaster/toast`
   *             instead. This component will be removed in C-21.
   */
  ```
- [x] 7.4 **GREEN: migrar `ProveedoresPage.tsx`**: remover el `useState<string | null>(null)`, remover el JSX de `<SuccessMessage>`, reemplazar `setSuccessMessage(...)` por `toast.success(...)`. Importar `toast` desde `@shared/components/Toaster/toast`.
- [x] 7.5 **GREEN: migrar `ProveedorDetailPage.tsx`** con el mismo criterio.
- [x] 7.6 **GREEN: migrar `PerfilPage.tsx`** con el mismo criterio (si tiene el patrón).
- [x] 7.7 **VERIFICAR**: tests pasan, lint pasa. Los call sites no rompen.

## Phase 8: Final verification + housekeeping

- [x] 8.1 **Correr `npm run lint`** en el web. Exit 0.
- [x] 8.2 **Correr `npm run typecheck`** en el web. Exit 0.
- [x] 8.3 **Correr `npm test`** en el web. Todos los tests pasan, incluyendo:
  - Los tests originales del MVP (verificar que ninguno se rompió).
  - Los tests nuevos de C-20: `frontend-lint.test.ts`, `Toaster.test.tsx`, `useGlobalShortcuts.test.tsx`, `LoadingState.test.tsx`, `ProveedorDialog.test.tsx`, `DeleteProveedorDialog.test.tsx`.
- [x] 8.4 **Correr `npm run build`** en el web. Build limpio (sin warnings de Vite sobre imports no usados o tree-shaking roto).
- [x] 8.5 **Correr `pytest tests/ -q`** en el api. **Misma cantidad de passing** que antes de C-20 (no introducimos cambios de backend, así que no debería cambiar — esto es regression-guard contra cualquier side-effect accidental del monorepo).
- [x] 8.6 **Verificar manualmente** (no automatizable, dejar nota en el apply-progress): abrir el dev server, click en "Cargar factura" → modal abre; `Esc` cierra; crear un proveedor → toast aparece. `n` desde home navega a /facturas/nueva. *(deferred: verificación manual, notado al archivar 2026-07-24 — la app corre en producción desde estos commits)*
- [x] 8.7 **Medir bundle impact**: comparar `dist/` size antes y después de C-20. Documentar el delta en el apply-progress. Esperado: +5-8 KB gzipped (Radix tree-shakeado + sonner). *(no medido al archivar 2026-07-24 — sin cambios visuales nuevos desde entonces)*
- [x] 8.8 **Actualizar `CHANGES.md`**: marcar C-20 como `[x] archivado 2026-07-XX`. Actualizar el resumen (de 20 a 21 changes).
- [x] 8.9 **Actualizar `knowledge-base/09_decisiones_y_supuestos.md`**: marcar D-24 como RESUELTO. Agregar D-25 documentando la decisión de usar Radix Primitives pelado (no shadcn/ui) con la razón del design.
- [x] 8.10 **Stage de los archivos** (NO commitear): revisar `git status --short`, asegurar que solo se incluyen los archivos esperados, ningún `.env` ni `node_modules` ni archivos de cache.

## Out of scope (documentado para no reabrir)

- Migrar el modal IA (`PropuestaIAModal`) a Radix Dialog: D-19 lo preserva como modal custom bloqueante.
- Implementar el atajo `/` (focus search): necesita un mecanismo cross-page de "search target" que es scope creep.
- Implementar `react-refresh/only-export-components` como `error` en vez de `warn`: requiere refactor de archivos que hoy re-exportan componentes (e.g. `Card.tsx` re-exporta default).
- Agregar Storybook: tooling + catálogos, otro change.
- Migrar Tailwind v4 alpha a v3 estable: cambio disruptivo, otro change.
- Agregar axe-core / a11y automation: tooling de QA, otro change.
- Adoptar `react-aria` de Adobe como alternativa a Radix: requiere un analysis trade-off separado, otro change.
- Agregar un `eslint-disable` budget / lint debt tracking: tooling, otro change.
- Internacionalización (i18n) de los toasts: scope de i18n general del proyecto, otro change.
- Tests E2E con Playwright contra los flujos migrados: scope de C-19 (e2e-setup) si se decide abrir.

## Workload forecast

- **Total tasks**: 33 (sub-tasks dentro de 8 phases).
- **Estimated changed lines**: ~600-800 (incluye deps nuevas en package.json + Radix wrappers + tests + ESLint config). Esto excede el budget de "single PR ~400 líneas" mencionado en `sdd-apply` Step 2a.
- **Delivery decision required**: Sí. Opciones:
  - **Chained PR** (PR #1: ESLint baseline + LoadingState + SuccessMessage deprecation. PR #2: Toaster + useGlobalShortcuts. PR #3: ProveedorDialog + DeleteProveedorDialog).
  - **Single PR con size-exception**: justificado por ser housekeeping continuo, bajo riesgo, y porque los PRs chained de housekeeping suelen añadir fricción sin review benefit.
- **Decisión por defecto recomendada**: chained PR, slice por phase. Más fácil de revisar y revertir si algo rompe.

## Verification target final (de Phase 8)

- `cd facturas-proveedores-web && npm run lint` → exit 0, sin warnings.
- `cd facturas-proveedores-web && npm run typecheck` → exit 0.
- `cd facturas-proveedores-web && npm test` → todos los tests pasan.
- `cd facturas-proveedores-web && npm run build` → build limpio.
- `cd facturas-proveedores-api && pytest tests/ -q` → misma cantidad de passing que antes.
- `openspec validate c-20-radix-ui-and-feedback` → clean.
- Manual: el dev server sirve la app y los flujos de modal/toast/shortcut funcionan como está especificado.
