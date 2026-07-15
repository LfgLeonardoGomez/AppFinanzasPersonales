/**
 * Regression-guard for D-24 (lint baseline).
 *
 * C-20: locks the contract that `npm run lint` exits with code 0.
 * If a future change re-introduces a lint failure, this test fails.
 *
 * Skipped (not failed) when node_modules is absent, so the test does not
 * produce false failures from missing dependencies rather than from
 * real lint breakage.
 */
import { describe, it, expect } from 'vitest'
import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const projectRoot = resolve(__dirname, '..')
const nodeModulesPath = resolve(projectRoot, 'node_modules')

describe('frontend lint baseline (C-20, D-24)', () => {
  it.skipIf(!existsSync(nodeModulesPath))(
    'npm run lint exits with code 0',
    () => {
      let exitCode = 0
      let output = ''

      try {
        output = execSync('npm run lint', {
          cwd: projectRoot,
          encoding: 'utf-8',
          stdio: 'pipe',
        })
      } catch (e: unknown) {
        const err = e as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string }
        exitCode = err.status ?? 1
        const stdout = typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString('utf-8') ?? ''
        const stderr = typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString('utf-8') ?? ''
        output = stdout + stderr
      }

      expect(exitCode, `npm run lint output:\n${output}`).toBe(0)
    },
  )
})
