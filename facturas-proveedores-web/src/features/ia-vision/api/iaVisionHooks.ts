/**
 * TanStack Query hooks for the IA vision data layer (C-15).
 *
 * - `useExtraerFacturaIA` / `useExtraerPagoIA` are mutations over the
 *   C-14 endpoints.
 * - `retry: false` — a 429 is a real answer, an `error: true` envelope
 *   is a real answer, 422 is a real answer; only generic 5xx / network
 *   is a candidate for manual retry via the modal's "Reintentar" button.
 * - NO `onSuccess` / `onError` logic — the modal owns the state machine.
 * - NO `invalidateQueries` — the proposal is a transient value held in
 *   modal state. When the user confirms, the existing C-09 / C-11
 *   mutation fires and the C-13 cache-invalidation chain takes over.
 *
 * TDD: Task 2.1 (RED) → 2.3 (GREEN) → 2.4/2.5 (TRIANGULATE).
 */
import { useMutation } from '@tanstack/react-query'
import { extraerFacturaIA, extraerPagoIA } from './iaVisionApi'

// ── Query keys ────────────────────────────────────────────────────────────────

export const IA_VISION_KEYS = {
  all: ['ia-vision'] as const,
}

// ── useExtraerFacturaIA ───────────────────────────────────────────────────────

export function useExtraerFacturaIA() {
  return useMutation({
    mutationFn: (file: File) => extraerFacturaIA(file),
    retry: false,
  })
}

// ── useExtraerPagoIA ──────────────────────────────────────────────────────────

export function useExtraerPagoIA() {
  return useMutation({
    mutationFn: (file: File) => extraerPagoIA(file),
    retry: false,
  })
}
