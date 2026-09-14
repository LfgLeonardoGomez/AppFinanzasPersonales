/**
 * Regression-guard for C-34 task 9.3 (design-system fidelity).
 *
 * Two invariants the Ventas/Clientes screens must not break:
 *
 * 1. Tailwind v4 dropped the JS `darkMode: 'class'` config option. This app
 *    keys the `dark:` variant off `.dark` through a CSS `@custom-variant`
 *    in src/app/index.css instead (see the comment there). Reintroducing
 *    `darkMode: 'class'` into a JS/TS config previously caused a real
 *    production bug (black inputs and rows in light mode) — this guard
 *    keeps that fix from being silently undone by a future config edit.
 * 2. The new Ventas/Clientes/ClienteAutocomplete files must reuse the
 *    existing design-system tokens (defined in the `@theme` block of
 *    src/app/index.css) rather than hardcoding new hex colors — "no new
 *    visual language".
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stats = statSync(full)
    if (stats.isDirectory()) {
      walk(full, out)
    } else {
      out.push(full)
    }
  }
  return out
}

describe('design system guard — Ventas/Clientes screens (C-34, task 9.3)', () => {
  it('no JS/TS config file reintroduces darkMode: "class"', () => {
    const configCandidates = [
      'vite.config.ts',
      'vite.config.js',
      'postcss.config.js',
      'postcss.config.cjs',
      'postcss.config.ts',
      'tailwind.config.js',
      'tailwind.config.cjs',
      'tailwind.config.ts',
    ].map((name) => join(projectRoot, name))

    const offenders: string[] = []
    for (const file of configCandidates) {
      if (!existsSync(file)) continue
      const content = readFileSync(file, 'utf-8')
      if (/darkMode\s*:\s*['"]class['"]/.test(content)) {
        offenders.push(file)
      }
    }

    expect(offenders, `darkMode: 'class' found in: ${offenders.join(', ')}`).toEqual([])
  })

  it('the guarded screens use only the app design-system tokens (no hardcoded hex colors)', () => {
    // C-38 added `features/estadisticas`; C-44 adds `features/proveedores`
    // (the two panels relocated from the old `features/home/`). This list is
    // the whole guard: a feature that is not on it is not checked, silently.
    // C-40 already paid that lesson once (`frontend-lint.test.ts` existed in
    // the repo and had never actually run) — when a new feature is created,
    // it belongs here before its first component is written, not after.
    const scanDirs = [
      join(projectRoot, 'src/features/ventas'),
      join(projectRoot, 'src/features/clientes'),
      join(projectRoot, 'src/features/estadisticas'),
      join(projectRoot, 'src/features/proveedores'),
      join(projectRoot, 'src/shared/components/ClienteAutocomplete'),
    ].filter((d) => existsSync(d))

    const files = scanDirs
      .flatMap((d) => walk(d))
      .filter(
        (f) =>
          (f.endsWith('.tsx') || f.endsWith('.ts')) &&
          !f.endsWith('.test.tsx') &&
          !f.endsWith('.test.ts'),
      )

    // Hex colors and Tailwind arbitrary-value color utilities (bg-[#...]) are
    // both ways to bypass the design-system tokens defined in @theme.
    const hexColorPattern = /#[0-9a-fA-F]{3,8}\b/
    const arbitraryColorUtility = /\b(?:bg|text|border|ring|fill|stroke)-\[#/

    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8')
      if (hexColorPattern.test(content) || arbitraryColorUtility.test(content)) {
        offenders.push(file)
      }
    }

    expect(offenders, `hardcoded hex colors found in: ${offenders.join(', ')}`).toEqual([])
  })
})

describe('dark theme guard (C-45 — dark theme token overrides)', () => {
  // Scope: shared primitives and the feature directories actually swept for
  // C-45 (dark theme fix). This is deliberately NOT "all of src" — a few
  // screens (HomePage's IA banner, AuthShell's brand panel) paint a fixed
  // violet/magenta gradient with white text ON PURPOSE (a decorative panel,
  // not a page surface) and are correct to keep a literal white regardless
  // of theme. Forms already migrated to the OLD dark system (PagoForm,
  // FacturaForm, VentaForm, ClienteAutocomplete, SupplierSearch, ...) pair
  // every raw color with an explicit `dark:` class already and are outside
  // this guard's scope on purpose — this guard is for components that rely
  // on the token-flip strategy, not on hand-written `dark:` pairs. A
  // directory belongs here once it has been verified clean; add it when you
  // clean the next one.
  const scanDirs = [
    join(projectRoot, 'src/shared/components/AppLayout'),
    join(projectRoot, 'src/shared/components/Button'),
    join(projectRoot, 'src/shared/components/Card'),
    join(projectRoot, 'src/shared/components/InputField'),
    join(projectRoot, 'src/shared/components/PageHeader'),
    join(projectRoot, 'src/shared/components/HistorialTable'),
    join(projectRoot, 'src/shared/components/ArchivoPreviewDialog'),
    join(projectRoot, 'src/features/ia-vision/components'),
    join(projectRoot, 'src/features/estadisticas'),
  ].filter((d) => existsSync(d))

  const files = scanDirs
    .flatMap((d) => walk(d))
    .filter(
      (f) =>
        (f.endsWith('.tsx') || f.endsWith('.ts')) &&
        !f.endsWith('.test.tsx') &&
        !f.endsWith('.test.ts'),
    )

  it('the swept components use no raw non-token colors that would not flip in dark mode', () => {
    // A Tailwind class token is "safe" here if it is explicitly paired with
    // a `dark:` variant — this codebase always writes `dark:` as the FIRST
    // variant in a chain (verified: no `hover:dark:...` token exists), so
    // filtering out any token containing "dark:" removes every legitimately
    // hand-paired old-system color and leaves only the ones that would
    // leak straight through to dark mode unchanged.
    const bannedSuffix =
      /\b(?:bg-white|text-black|(?:bg|text|border|ring|fill|stroke)-(?:gray|zinc|slate)-\d+)\b/
    const hexInClass = /#[0-9a-fA-F]{3,8}\b/
    // Tailwind classes in this codebase aren't always inline in a JSX
    // `className=` attribute — several components (Button's VARIANT_CLASSES,
    // EstadoBadge/FacturasList's status-color maps) build a class string in a
    // module-level constant first. Scan the whole file, but strip inline
    // `style={{ ... }}` props first: a decorative
    // `style={{ background: 'linear-gradient(...,#7c3aed,...)' }}` (the
    // violet->magenta brand mark used in a few logos/banners) is a fixed
    // decorative color, not a themed surface, and is correct to leave as a
    // literal hex regardless of theme.
    const styleProp = /style=\{\{[\s\S]*?\}\}/g

    const offenders: string[] = []
    for (const file of files) {
      const content = readFileSync(file, 'utf-8').replace(styleProp, '')
      const tokens = content.split(/\s+/)
      const isOffending = tokens.some(
        (t) => !t.includes('dark:') && (bannedSuffix.test(t) || hexInClass.test(t)),
      )
      if (isOffending) {
        offenders.push(file)
      }
    }

    expect(
      offenders,
      `raw non-token colors (bg-white/text-black/gray/zinc/slate/hex) found in: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('every surface/text/border/status/badge semantic token defined in @theme has a .dark override', () => {
    // Parses src/app/index.css directly (not the compiled output — Tailwind
    // v4 tree-shakes unused custom properties out of the compiled :root,
    // which would make this guard blind to a token nobody references yet).
    const cssPath = join(projectRoot, 'src/app/index.css')
    const css = readFileSync(cssPath, 'utf-8')

    const themeMatch = css.match(/@theme\s*\{([\s\S]*?)\n\}/)
    const darkMatch = css.match(/\n\.dark\s*\{([\s\S]*?)\n\}/)
    expect(themeMatch, '@theme block not found in index.css').not.toBeNull()
    expect(darkMatch, '.dark override block not found in index.css').not.toBeNull()

    const themeBlock = themeMatch![1]
    const darkBlock = darkMatch![1]

    // Semantic-role token families that MUST have a dark counterpart because
    // they paint surfaces, text, borders, status colors or badges directly
    // (as opposed to raw palette swatches like --color-navy-200 or
    // --color-accent-300, which are building blocks other tokens/utilities
    // reference and are not meant to invert on their own).
    const semanticNamePattern =
      /^--color-(page|surface(?:-alt|-soft)?|ink(?:-soft(?:-2)?)?|border-subtle(?:-2)?|border-violet-soft|violet-50|violet-900|magenta-50|magenta-900|success(?:-light|-bg)?|warning(?:-light|-bg)?|danger(?:-light|-bg)?|badge-(?:pendiente|pagada|parcial)-(?:bg|text))$/

    const declaredTokenNames = [...themeBlock.matchAll(/(--color-[a-z0-9-]+)\s*:/g)]
      .map((m) => m[1])
      .filter((name) => semanticNamePattern.test(name))

    expect(declaredTokenNames.length, 'no semantic tokens matched — pattern likely stale').toBeGreaterThan(0)

    const missing = declaredTokenNames.filter(
      (name) => !new RegExp(`${name}\\s*:`).test(darkBlock),
    )

    expect(
      missing,
      `semantic tokens with no .dark override: ${missing.join(', ')}`,
    ).toEqual([])
  })
})
