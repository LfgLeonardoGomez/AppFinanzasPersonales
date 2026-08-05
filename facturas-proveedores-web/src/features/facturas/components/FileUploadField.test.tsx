/**
 * Tests for FileUploadField — client-side validation + Cloudinary upload flow.
 *
 * TDD: Task 5.1 (RED type/size rejection) → 5.2 (GREEN) →
 *      Task 5.3 (RED upload flow) → 5.4 (GREEN) → 5.5 (TRIANGULATE failure/no-file).
 *
 * Cloudinary is ALWAYS mocked via MSW — never hit for real (hard rule #9).
 * The preset endpoint is also mocked.
 */
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { FileUploadField } from './FileUploadField'

// ── MSW Server ────────────────────────────────────────────────────────────────

const server = setupServer(
  http.get('/api/cloudinary/preset-firmado', ({ request }) => {
    const url = new URL(request.url)
    if (url.searchParams.get('tipo') === 'factura') {
      return HttpResponse.json({
        cloud_name: 'test-cloud',
        signature: 'test-sig',
        api_key: 'test-key',
        timestamp: 1234567890,
        folder: 'facturas',
        allowed_formats: ['pdf', 'jpg', 'png'],
        max_file_size: 10485760,
      })
    }
    return HttpResponse.json({ detail: 'Not Found' }, { status: 404 })
  }),

  // Mock Cloudinary upload endpoint
  http.post('https://api.cloudinary.com/v1_1/:cloud/auto/upload', () => {
    return HttpResponse.json({ secure_url: 'https://res.cloudinary.com/test-cloud/image/upload/test.pdf' })
  }),
)

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => server.resetHandlers())

// ── Wrapper ───────────────────────────────────────────────────────────────────

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function renderField(onUrlChange = vi.fn()) {
  return render(
    <FileUploadField tipo="factura" onUrlChange={onUrlChange} />,
    { wrapper: createWrapper() },
  )
}

// Helper to create a mock File
function makeFile(name: string, type: string, sizeBytes: number): File {
  const content = new Uint8Array(sizeBytes)
  return new File([content], name, { type })
}

// ── c-26 — the attachment opens in-app, not in a new tab ─────────────────────

describe('FileUploadField — viewing an existing attachment', () => {
  const URL_JPG = 'https://res.cloudinary.com/test-cloud/image/upload/factura.jpg'

  function renderWithAttachment() {
    return render(
      <FileUploadField tipo="factura" onUrlChange={vi.fn()} currentUrl={URL_JPG} />,
      { wrapper: createWrapper() },
    )
  }

  it('opens the in-app viewer instead of navigating away', () => {
    // C-24 replaced the new-tab link with an in-app viewer, but only in the
    // cuenta-corriente tables. Here — the attachment shown while editing —
    // the same action still left the app, so "ver archivo" meant two
    // different things depending on where the user clicked it.
    renderWithAttachment()

    const trigger = screen.getByRole('button', { name: /ver adjunto/i })
    expect(trigger).toBeInTheDocument()

    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog')
    expect(dialog).toBeInTheDocument()
    // The file itself is rendered inside the dialog.
    expect(screen.getByRole('img')).toHaveAttribute('src', URL_JPG)
  })

  it('does not render a link that leaves the application', () => {
    renderWithAttachment()

    const escapingLinks = screen
      .queryAllByRole('link')
      .filter((a) => a.getAttribute('target') === '_blank')

    // The viewer keeps its own "abrir en pestaña nueva" fallback, but it only
    // exists once the dialog is open — never on the form itself.
    expect(escapingLinks).toHaveLength(0)
  })

  it('offers no viewer when there is no attachment', () => {
    render(<FileUploadField tipo="factura" onUrlChange={vi.fn()} />, {
      wrapper: createWrapper(),
    })

    expect(screen.queryByRole('button', { name: /ver adjunto/i })).not.toBeInTheDocument()
  })
})

// ── Task 5.1 / 5.2 — Type and size validation ────────────────────────────────

describe('FileUploadField — client-side validation', () => {
  it('renders a file input', () => {
    renderField()
    expect(screen.getByRole('button', { name: /seleccionar/i })).toBeInTheDocument()
  })

  it('rejects a file with an invalid type (e.g. .txt)', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const txtFile = makeFile('doc.txt', 'text/plain', 100)
    fireEvent.change(input, { target: { files: [txtFile] } })
    expect(screen.getByRole('alert').textContent).toMatch(/tipo|formato|pdf|jpg|png/i)
  })

  it('accepts a PDF file without type error', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const pdfFile = makeFile('factura.pdf', 'application/pdf', 1000)
    fireEvent.change(input, { target: { files: [pdfFile] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts a JPEG file without type error', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const jpgFile = makeFile('factura.jpg', 'image/jpeg', 1000)
    fireEvent.change(input, { target: { files: [jpgFile] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('accepts a PNG file without type error', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const pngFile = makeFile('factura.png', 'image/png', 1000)
    fireEvent.change(input, { target: { files: [pngFile] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('rejects a file larger than 10 MB', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const bigFile = makeFile('big.pdf', 'application/pdf', 11 * 1024 * 1024)
    fireEvent.change(input, { target: { files: [bigFile] } })
    expect(screen.getByRole('alert').textContent).toMatch(/tamaño|size|10 MB|10MB/i)
  })

  it('accepts a file just under 10 MB', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const okFile = makeFile('ok.pdf', 'application/pdf', 9 * 1024 * 1024)
    fireEvent.change(input, { target: { files: [okFile] } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

// ── Task 5.5 — TRIANGULATE: upload failure / no file scenarios ───────────────

describe('FileUploadField — triangulate', () => {
  it('renders no error when no file is selected (no-file case)', () => {
    renderField()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the upload button after a valid file is chosen', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const pdfFile = makeFile('factura.pdf', 'application/pdf', 1000)
    fireEvent.change(input, { target: { files: [pdfFile] } })
    // Upload and cancel buttons should appear
    expect(screen.getByRole('button', { name: /subir archivo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /cancelar/i })).toBeInTheDocument()
    // No error shown
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not call onUrlChange when no valid file is selected', () => {
    const onUrlChange = vi.fn()
    renderField(onUrlChange)
    // No file interaction — no URL change
    expect(onUrlChange).not.toHaveBeenCalled()
  })

  it('can cancel selection after choosing a file', () => {
    renderField()
    const input = screen.getByLabelText(/archivo/i)
    const pdfFile = makeFile('factura.pdf', 'application/pdf', 1000)
    fireEvent.change(input, { target: { files: [pdfFile] } })
    // Upload button appears (file selected)
    expect(screen.getByRole('button', { name: /subir archivo/i })).toBeInTheDocument()

    const cancelBtn = screen.getByRole('button', { name: /cancelar/i })
    fireEvent.click(cancelBtn)
    // After cancel, upload button disappears — back to initial state
    expect(screen.queryByRole('button', { name: /subir archivo/i })).not.toBeInTheDocument()
  })
})
