/**
 * Tests for the shared `uploadToCloudinary` helper (C-21, task 2.1).
 *
 * Cloudinary is ALWAYS mocked via MSW (hard rule #9).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { uploadToCloudinary, type CloudinaryPreset } from './uploadToCloudinary'

const preset: CloudinaryPreset = {
  cloud_name: 'test-cloud',
  signature: 'test-sig',
  api_key: 'test-key',
  timestamp: 1234567890,
  folder: 'facturas',
  allowed_formats: ['pdf', 'jpg', 'png'],
  max_file_size: 10485760,
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

function makeFile(): File {
  return new File([new Uint8Array(10)], 'f.jpg', { type: 'image/jpeg' })
}

describe('uploadToCloudinary — success', () => {
  it('resolves with the secure_url on a 200 response', async () => {
    server.use(
      http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () =>
        HttpResponse.json({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/f.jpg' }),
      ),
    )
    const url = await uploadToCloudinary(makeFile(), preset)
    expect(url).toBe('https://res.cloudinary.com/test-cloud/image/upload/f.jpg')
  })
})

describe('uploadToCloudinary — signed-upload request body', () => {
  it('sends exactly the signed params (folder, allowed_formats, max_file_size) and NOT upload_preset', async () => {
    // Spy on fetch to read the FormData directly — avoids flaky multipart
    // parsing through MSW/jsdom while still asserting the real request body.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/f.jpg' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    try {
      await uploadToCloudinary(makeFile(), preset)

      const body = fetchSpy.mock.calls[0]?.[1]?.body as FormData
      // Signed params must be present with the exact serialization the backend signed.
      expect(body.get('folder')).toBe('facturas')
      expect(body.get('allowed_formats')).toBe('pdf,jpg,png')
      expect(body.get('api_key')).toBe('test-key')
      expect(body.get('signature')).toBe('test-sig')
      expect(body.get('timestamp')).toBe('1234567890')
      // These MUST NOT be sent — neither is part of the signed set, and
      // their presence would break Cloudinary's signature verification
      // (400 Invalid Signature). `max_file_size` is not a Cloudinary upload
      // param; `upload_preset` belongs to the unsigned upload flow.
      expect(body.get('max_file_size')).toBeNull()
      expect(body.get('upload_preset')).toBeNull()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})

describe('uploadToCloudinary — HTTP/error response rejects', () => {
  it('rejects when Cloudinary returns a non-OK status', async () => {
    server.use(
      http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () =>
        HttpResponse.json({ error: { message: 'Invalid signature' } }, { status: 401 }),
      ),
    )
    await expect(uploadToCloudinary(makeFile(), preset)).rejects.toThrow('Invalid signature')
  })

  it('rejects when the JSON body carries an `error` field despite a 200 status', async () => {
    server.use(
      http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () =>
        HttpResponse.json({ error: { message: 'File too large' } }, { status: 200 }),
      ),
    )
    await expect(uploadToCloudinary(makeFile(), preset)).rejects.toThrow('File too large')
  })

  it('rejects with a fallback message when secure_url is missing and there is no error field', async () => {
    server.use(
      http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () => HttpResponse.json({})),
    )
    await expect(uploadToCloudinary(makeFile(), preset)).rejects.toThrow('Error al subir el archivo.')
  })

  it('rejects with a network error message when the fetch itself fails', async () => {
    server.use(
      http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () => HttpResponse.error()),
    )
    await expect(uploadToCloudinary(makeFile(), preset)).rejects.toThrow('Error de conexión al subir el archivo.')
  })
})
