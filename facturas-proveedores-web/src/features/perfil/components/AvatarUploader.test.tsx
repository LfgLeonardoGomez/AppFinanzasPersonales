/**
 * Tests for AvatarUploader (C-05 task 9.1 — TDD RED, then GREEN).
 *
 * Spec:
 * - The component fetches a signed preset from /api/cloudinary/preset-firmado.
 * - Uploads the file directly to Cloudinary (not through the Axios client).
 * - On Cloudinary success, calls POST /api/me/avatar with the secure_url.
 * - Blocks non-PDF/JPG/PNG or >10 MB client-side before any network call.
 * - Surfaces Cloudinary upload failures to the user.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setupServer } from 'msw/node'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'

beforeAll(() => {
  Object.defineProperty(window, 'location', {
    value: { assign: vi.fn(), href: 'http://localhost/', origin: 'http://localhost', pathname: '/' },
    writable: true,
  })
})

const BASE = 'http://localhost'
const server = setupServer()

beforeEach(() => {
  server.listen({ onUnhandledRequest: 'error' })
  vi.clearAllMocks()
})
afterEach(() => {
  server.resetHandlers()
  server.close()
})

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  }
}

/** Build a File with the given name, type, and size. */
function makeFile(name: string, type: string, sizeBytes: number): File {
  // Create a buffer of the requested size; the contents are irrelevant for type/size checks.
  const content = new Uint8Array(sizeBytes)
  return new File([content], name, { type })
}

describe('AvatarUploader — happy path', () => {
  it('uploads the file to Cloudinary and calls POST /api/me/avatar with secure_url', async () => {
    // Backend returns the signed preset
    server.use(
      http.get(`${BASE}/api/cloudinary/preset-firmado`, () =>
        HttpResponse.json({
          signature: 'sig',
          timestamp: 1,
          api_key: 'k',
          cloud_name: 'cloud',
          folder: 'avatars',
          allowed_formats: ['pdf', 'jpg', 'png'],
          max_file_size: 10 * 1024 * 1024,
        }),
      ),
    )

    // Direct Cloudinary upload returns a secure_url
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            secure_url: 'https://res.cloudinary.com/cloud/image/upload/v1/avatar/me.jpg',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )

    // POST /api/me/avatar is called
    let avatarBody: Record<string, unknown> | null = null
    server.use(
      http.post(`${BASE}/api/me/avatar`, async ({ request }) => {
        avatarBody = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({
          id: '1',
          email: 'u@u.com',
          nombre: 'U',
          avatar_url: avatarBody.avatar_url,
          created_at: '',
        })
      }),
    )

    const { AvatarUploader } = await import('./AvatarUploader')
    render(<AvatarUploader currentUrl={null} userId="u-1" />, {
      wrapper: makeWrapper(),
    })

    const file = makeFile('me.jpg', 'image/jpeg', 1024)
    const input = screen.getByLabelText(/subir avatar/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(avatarBody).not.toBeNull()
    })
    expect(avatarBody).toMatchObject({
      avatar_url:
        'https://res.cloudinary.com/cloud/image/upload/v1/avatar/me.jpg',
    })
    // We did call the signed-preset endpoint AND Cloudinary's upload endpoint.
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    fetchSpy.mockRestore()
  })
})

describe('AvatarUploader — client-side validation', () => {
  it('blocks files that are not PDF/JPG/PNG and does not call any backend', async () => {
    const presetSpy = vi.fn()
    server.use(
      http.get(`${BASE}/api/cloudinary/preset-firmado`, () => {
        presetSpy()
        return HttpResponse.json({})
      }),
    )

    const { AvatarUploader } = await import('./AvatarUploader')
    render(<AvatarUploader currentUrl={null} userId="u-1" />, {
      wrapper: makeWrapper(),
    })

    const file = makeFile('me.txt', 'text/plain', 1024)
    const input = screen.getByLabelText(/subir avatar/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/no soportado|formato no permitido/i)).toBeInTheDocument()
    })
    expect(presetSpy).not.toHaveBeenCalled()
  })

  it('blocks files larger than 10 MB and does not call any backend', async () => {
    const presetSpy = vi.fn()
    server.use(
      http.get(`${BASE}/api/cloudinary/preset-firmado`, () => {
        presetSpy()
        return HttpResponse.json({})
      }),
    )

    const { AvatarUploader } = await import('./AvatarUploader')
    render(<AvatarUploader currentUrl={null} userId="u-1" />, {
      wrapper: makeWrapper(),
    })

    const file = makeFile('big.jpg', 'image/jpeg', 11 * 1024 * 1024)
    const input = screen.getByLabelText(/subir avatar/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/demasiado grande|10 ?mb/i)).toBeInTheDocument()
    })
    expect(presetSpy).not.toHaveBeenCalled()
  })
})

describe('AvatarUploader — Cloudinary failure', () => {
  it('surfaces the error and does NOT call POST /api/me/avatar', async () => {
    server.use(
      http.get(`${BASE}/api/cloudinary/preset-firmado`, () =>
        HttpResponse.json({
          signature: 'sig',
          timestamp: 1,
          api_key: 'k',
          cloud_name: 'cloud',
          folder: 'avatars',
          allowed_formats: ['pdf', 'jpg', 'png'],
          max_file_size: 10 * 1024 * 1024,
        }),
      ),
    )

    // Direct Cloudinary upload FAILS
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { message: 'boom' } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        }),
      )

    let avatarCalled = false
    server.use(
      http.post(`${BASE}/api/me/avatar`, () => {
        avatarCalled = true
        return HttpResponse.json({})
      }),
    )

    const { AvatarUploader } = await import('./AvatarUploader')
    render(<AvatarUploader currentUrl={null} userId="u-1" />, {
      wrapper: makeWrapper(),
    })

    const file = makeFile('me.jpg', 'image/jpeg', 1024)
    const input = screen.getByLabelText(/subir avatar/i) as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await waitFor(() => {
      expect(screen.getByText(/error|no se pudo subir/i)).toBeInTheDocument()
    })
    expect(avatarCalled).toBe(false)
    fetchSpy.mockRestore()
  })
})
