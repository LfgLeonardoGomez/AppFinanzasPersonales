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

  it('the Ventas/Clientes screens use only the app design-system tokens (no hardcoded hex colors)', () => {
    const scanDirs = [
      join(projectRoot, 'src/features/ventas'),
      join(projectRoot, 'src/features/clientes'),
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
