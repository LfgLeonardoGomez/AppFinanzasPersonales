/**
 * Tests for PWA icon assets (c-18 FE-002).
 *
 * The PWA manifest references three PNG files that must exist in
 * `public/`. Before this change they were missing — the build did not
 * fail (vite-plugin-pwa tolerates missing icon files at build time),
 * but the user-installed PWA showed a broken icon and the Lighthouse
 * "installable PWA" audit failed.
 *
 * RED → GREEN contract: this test fails on the unfixed code (files do
 * not exist) and passes after the one-shot Node script writes valid
 * PNG files. The script itself lives in `scripts/generate-pwa-icons.mjs`
 * and uses only Node's built-in `Buffer` and `zlib` — no new runtime
 * dependency was added.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public')

// PNG signature (8 bytes): 89 50 4E 47 0D 0A 1A 0A
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const ICON_FILES = [
  { name: 'pwa-192x192.png', expectedWidth: 192, expectedHeight: 192 },
  { name: 'pwa-512x512.png', expectedWidth: 512, expectedHeight: 512 },
  { name: 'pwa-512x512.maskable.png', expectedWidth: 512, expectedHeight: 512 },
]

function readPngDimensions(buf: Buffer): { width: number; height: number } {
  // IHDR chunk: 4 bytes length + 4 bytes type + 4 bytes width + 4 bytes height
  // (PNG signature is bytes 0..7; IHDR starts at byte 8)
  const width = buf.readUInt32BE(16)
  const height = buf.readUInt32BE(20)
  return { width, height }
}

describe('PWA icon assets (c-18 FE-002)', () => {
  for (const icon of ICON_FILES) {
    it(`${icon.name} exists in public/ and is a valid PNG`, () => {
      const path = resolve(PUBLIC_DIR, icon.name)
      const buf = readFileSync(path)
      // Valid PNG signature
      expect(buf.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true)
      // Correct dimensions
      const { width, height } = readPngDimensions(buf)
      expect(width).toBe(icon.expectedWidth)
      expect(height).toBe(icon.expectedHeight)
    })
  }

  it('the manifest references resolve to files that exist', () => {
    const manifestPath = resolve(PUBLIC_DIR, 'manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      icons?: { src: string }[]
    }
    const iconSrcs = (manifest.icons ?? []).map((i) => i.src)
    expect(iconSrcs.length).toBeGreaterThanOrEqual(2)
    for (const src of iconSrcs) {
      // The source manifest uses absolute paths like "/pwa-192x192.png"
      // (leading slash). Strip it and any query/hash suffix to get the
      // file basename. The PWA plugin may rewrite the manifest at build
      // time to add hash suffixes; the un-hashed source names are what
      // the script writes.
      const baseName = (src.split('?')[0] ?? src).replace(/^\//, '')
      const exists = readFileSync(resolve(PUBLIC_DIR, baseName))
      expect(exists.length).toBeGreaterThan(0)
    }
  })
})
