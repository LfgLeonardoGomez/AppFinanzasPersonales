/**
 * useGlobalShortcuts tests (C-20, frontend-ui-polish).
 *
 * Locks the contract: single-key shortcuts fire on body focus, are
 * suppressed on form fields, sequence shortcuts (g+p, g+f, g+c) fire
 * within the 1000ms window, and the listener is cleaned up on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { useGlobalShortcuts } from './useGlobalShortcuts'

describe('useGlobalShortcuts (C-20, frontend-ui-polish)', () => {
  let input: HTMLInputElement

  beforeEach(() => {
    document.body.innerHTML = ''
    input = document.createElement('input')
    input.type = 'text'
    document.body.appendChild(input)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('fires a single-key shortcut when no input has focus', () => {
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    fireEvent.keyDown(document.body, { key: 'n' })

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not fire a single-key shortcut when focus is in an input', () => {
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    input.focus()
    fireEvent.keyDown(input, { key: 'n' })

    expect(action).not.toHaveBeenCalled()
  })

  it('does not fire a single-key shortcut when focus is in a textarea', () => {
    const action = vi.fn()
    const textarea = document.createElement('textarea')
    document.body.appendChild(textarea)
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    textarea.focus()
    fireEvent.keyDown(textarea, { key: 'n' })

    expect(action).not.toHaveBeenCalled()
  })

  it('does not fire a single-key shortcut when focus is in a contenteditable', () => {
    const action = vi.fn()
    const editable = document.createElement('div')
    editable.setAttribute('contenteditable', 'true')
    document.body.appendChild(editable)
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    editable.focus()
    fireEvent.keyDown(editable, { key: 'n' })

    expect(action).not.toHaveBeenCalled()
  })

  it('does not fire a shortcut when a modifier key is held', () => {
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true })
    fireEvent.keyDown(document.body, { key: 'n', metaKey: true })
    fireEvent.keyDown(document.body, { key: 'n', altKey: true })

    expect(action).not.toHaveBeenCalled()
  })

  it('fires a sequence shortcut (g then p) within the 1000ms window', () => {
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['g', 'p'], action }]),
    )

    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'p' })

    expect(action).toHaveBeenCalledTimes(1)
  })

  it('does not fire a sequence shortcut if the second key is after 1000ms', () => {
    vi.useFakeTimers()
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['g', 'p'], action }]),
    )

    fireEvent.keyDown(document.body, { key: 'g' })
    vi.advanceTimersByTime(1500)
    fireEvent.keyDown(document.body, { key: 'p' })

    expect(action).not.toHaveBeenCalled()
  })

  it('clears the prefix when an unrelated key follows g', () => {
    const gpAction = vi.fn()
    const nAction = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([
        { keys: ['g', 'p'], action: gpAction },
        { keys: ['n'], action: nAction },
      ]),
    )

    fireEvent.keyDown(document.body, { key: 'g' })
    fireEvent.keyDown(document.body, { key: 'x' })
    fireEvent.keyDown(document.body, { key: 'p' })

    expect(gpAction).not.toHaveBeenCalled()
    expect(nAction).not.toHaveBeenCalled()
  })

  it('cleans up the listener on unmount', () => {
    const action = vi.fn()
    const { unmount } = renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    unmount()
    fireEvent.keyDown(document.body, { key: 'n' })

    expect(action).not.toHaveBeenCalled()
  })

  it('respects the when predicate (binding is a no-op when it returns false)', () => {
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([
        { keys: ['n'], action, when: () => false },
      ]),
    )

    fireEvent.keyDown(document.body, { key: 'n' })

    expect(action).not.toHaveBeenCalled()
  })

  it('case-insensitive: capital N triggers the same binding as lowercase n', () => {
    const action = vi.fn()
    renderHook(() =>
      useGlobalShortcuts([{ keys: ['n'], action }]),
    )

    fireEvent.keyDown(document.body, { key: 'N' })

    expect(action).toHaveBeenCalledTimes(1)
  })
})
