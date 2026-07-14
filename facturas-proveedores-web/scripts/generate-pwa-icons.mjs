#!/usr/bin/env node
/**
 * One-shot PWA icon generator (c-18 FE-002).
 *
 * Writes three PNG files into `public/`:
 *   - pwa-192x192.png
 *   - pwa-512x512.png
 *   - pwa-512x512.maskable.png
 *
 * No runtime dependencies. Uses only Node's built-in `Buffer`, `zlib`,
 * and the file system. The script is run once during the c-18 housekeeping
 * change and the resulting PNGs are committed to the repo. Re-run it if
 * the brand color changes.
 *
 * Design (per c-18 design.md D-3):
 *   - Background: #1e40af (the project's theme_color from manifest.json).
 *   - A white 2-character "FP" mark in the centre of the icon.
 *   - The maskable variant uses the inner 80% as the safe area.
 *   - The PNG is a standard RGBA image, deflate-compressed, with valid
 *     IHDR + IDAT + IEND chunks and a CRC-32 checksum on each.
 *
 * Why a script and not an image library: the script runs once. Adding
 * `sharp` or `pngjs` to devDependencies for a one-shot is over-engineering.
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync, crc32 } from 'node:zlib'

const __filename = fileURLToPath(import.meta.url)
const ROOT = resolve(dirname(__filename), '..')
const PUBLIC_DIR = resolve(ROOT, 'public')

const THEME_COLOR = [0x1e, 0x40, 0xaf, 0xff] // #1e40af, fully opaque
const WHITE = [0xff, 0xff, 0xff, 0xff]

// 5x7 pixel font for the letters "F" and "P" (white-on-blue). 1 = ink.
const FONT_F = [
  '11111',
  '10000',
  '10000',
  '11110',
  '10000',
  '10000',
  '10000',
]
const FONT_P = [
  '11110',
  '10001',
  '10001',
  '11110',
  '10000',
  '10000',
  '10000',
]

/**
 * Build the raw RGBA pixel buffer for a square icon with the brand
 * background and a centred "FP" mark.
 *
 * @param size        Width/height in pixels.
 * @param markScale   Pixel size of each font cell. 8 produces a clean,
 *                    legible mark at all PWA icon sizes.
 * @param safeArea    If true, the mark is shrunk and centred in the
 *                    inner 80% of the canvas (the "safe area" for
 *                    maskable icons per the W3C spec).
 */
function buildPixels(size, markScale, safeArea) {
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < buf.length; i += 4) {
    buf[i] = THEME_COLOR[0]
    buf[i + 1] = THEME_COLOR[1]
    buf[i + 2] = THEME_COLOR[2]
    buf[i + 3] = THEME_COLOR[3]
  }

  // Total mark dimensions: two glyphs, each markScale*7 tall and
  // markScale*5 wide, separated by markScale columns. Add one extra
  // column of padding on the outside.
  const glyphW = markScale * 5
  const glyphH = markScale * 7
  const gap = markScale
  const markW = glyphW * 2 + gap
  const markH = glyphH

  // For maskable, shrink the mark to 80% of the available safe area.
  const factor = safeArea ? 0.8 : 1.0
  const drawW = Math.round(markW * factor)
  const drawH = Math.round(markH * factor)
  const drawScale = drawW / markW // keep aspect ratio

  // Centre the mark on the canvas.
  const offsetX = Math.round((size - drawW) / 2)
  const offsetY = Math.round((size - drawH) / 2)

  function paintGlyph(glyph, x0, y0) {
    for (let row = 0; row < glyph.length; row++) {
      const line = glyph[row]
      for (let col = 0; col < line.length; col++) {
        if (line[col] !== '1') continue
        // The original glyph is 1 px per cell; we scale it by `drawScale`
        // so the painted block covers drawScale × drawScale source pixels.
        const px0 = x0 + Math.round(col * markScale * drawScale)
        const py0 = y0 + Math.round(row * markScale * drawScale)
        const px1 = x0 + Math.round((col + 1) * markScale * drawScale)
        const py1 = y0 + Math.round((row + 1) * markScale * drawScale)
        for (let py = py0; py < py1; py++) {
          if (py < 0 || py >= size) continue
          for (let px = px0; px < px1; px++) {
            if (px < 0 || px >= size) continue
            const idx = (py * size + px) * 4
            buf[idx] = WHITE[0]
            buf[idx + 1] = WHITE[1]
            buf[idx + 2] = WHITE[2]
            buf[idx + 3] = WHITE[3]
          }
        }
      }
    }
  }

  paintGlyph(FONT_F, offsetX, offsetY)
  paintGlyph(FONT_P, offsetX + Math.round((glyphW + gap) * drawScale), offsetY)
  return buf
}

/**
 * Encode an RGBA pixel buffer as a minimal valid PNG.
 * Output: 8-byte signature, IHDR, IDAT, IEND. Each chunk has a 4-byte
 * length, 4-byte type, data, and 4-byte CRC-32.
 */
function encodePng(width, height, rgba) {
  const chunks = []

  // PNG signature
  chunks.push(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))

  // IHDR — width(4) height(4) bitDepth(1) colorType(1) compression(1)
  //         filter(1) interlace(1)
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace
  chunks.push(wrapChunk('IHDR', ihdr))

  // IDAT — deflate-compressed scanlines. Each scanline starts with a
  // filter byte (0 = None) followed by the RGBA pixel data.
  const scanlineLen = width * 4
  const raw = Buffer.alloc((scanlineLen + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (scanlineLen + 1)] = 0
    rgba.copy(raw, y * (scanlineLen + 1) + 1, y * scanlineLen, (y + 1) * scanlineLen)
  }
  const idat = deflateSync(raw)
  chunks.push(wrapChunk('IDAT', idat))

  // IEND
  chunks.push(wrapChunk('IEND', Buffer.alloc(0)))

  return Buffer.concat(chunks)
}

function wrapChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const lengthBuf = Buffer.alloc(4)
  lengthBuf.writeUInt32BE(data.length, 0)
  const crcInput = Buffer.concat([typeBuf, data])
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(crcInput) >>> 0, 0)
  return Buffer.concat([lengthBuf, typeBuf, data, crcBuf])
}

function writeIcon(name, size, safeArea) {
  const pixels = buildPixels(size, 8, safeArea)
  const png = encodePng(size, size, pixels)
  const out = resolve(PUBLIC_DIR, name)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, png)
  console.log(`  wrote ${out} (${png.length} bytes)`)
}

mkdirSync(PUBLIC_DIR, { recursive: true })
console.log('Generating PWA icons…')
writeIcon('pwa-192x192.png', 192, false)
writeIcon('pwa-512x512.png', 512, false)
writeIcon('pwa-512x512.maskable.png', 512, true)
console.log('Done.')
