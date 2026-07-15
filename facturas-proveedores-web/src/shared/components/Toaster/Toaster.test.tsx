/**
 * Toaster tests (C-20, frontend-ui-polish).
 *
 * Locks the contract: the Toaster renders without error and the
 * `toast` helper is callable with the expected methods.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { Toaster } from './Toaster'
import { toast } from './toast'

describe('Toaster (C-20, frontend-ui-polish)', () => {
  afterEach(() => {
    cleanup()
    toast.dismiss()
  })

  it('renders the Toaster component without throwing', () => {
    expect(() => render(<Toaster />)).not.toThrow()
  })

  it('exposes the toast helper as a callable function with the expected methods', () => {
    expect(typeof toast).toBe('function')
    expect(typeof toast.success).toBe('function')
    expect(typeof toast.error).toBe('function')
    expect(typeof toast.info).toBe('function')
    expect(typeof toast.dismiss).toBe('function')
  })

  it('exposes the toast loading and promise helpers', () => {
    expect(typeof toast.loading).toBe('function')
    expect(typeof toast.promise).toBe('function')
  })
})
