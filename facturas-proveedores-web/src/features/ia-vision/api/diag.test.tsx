import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { setupServer } from 'msw/node'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMutation } from '@tanstack/react-query'
import type { ReactNode } from 'react'

let hitCount = 0
const server = setupServer(
  http.post('/api/diagnostic', async () => {
    hitCount++
    return HttpResponse.json({ ok: true }, { status: 200 })
  }),
)
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }))
afterAll(() => server.close())
afterEach(() => { server.resetHandlers(); hitCount = 0 })

function W({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

describe('waitFor with fetch', () => {
  it('waits for success', async () => {
    const { result } = renderHook(() => useMutation({
      mutationFn: async () => {
        const fd = new FormData()
        fd.append('file', new File([new Uint8Array(100)], 'test.jpg', { type: 'image/jpeg' }))
        const r = await fetch('/api/diagnostic', { method: 'POST', body: fd })
        return r.json()
      },
      retry: false,
    }), { wrapper: W })
    result.current.mutate()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(hitCount).toBe(1)
  })
})
