/**
 * Card — the base container of the new design system (DESIGN_SYSTEM.md:
 * "el ladrillo del Home y de casi toda la app"). Mucho aire interno,
 * bordes redondeados, sombra apenas perceptible.
 *
 * Visuals only were updated to the new violet/beige/Inter tokens — props
 * and DOM shape (a single wrapping <div>) are unchanged, so existing
 * callers keep working as-is.
 */
import type { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  noPadding?: boolean
  hover?: boolean
}

export function Card({ children, className = '', noPadding = false, hover = true }: CardProps) {
  return (
    <div
      className={`
        rounded-card bg-surface font-inter
        shadow-card
        ring-1 ring-border-subtle
        transition-all duration-300 ease-[var(--ease-out)]
        dark:bg-card-dark dark:ring-white/10
        ${hover ? 'hover:shadow-[0_2px_4px_rgba(24,21,31,0.04),0_16px_40px_rgba(24,21,31,0.10)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.30)]' : ''}
        ${noPadding ? '' : 'p-6 lg:p-8'}
        ${className}
      `}
    >
      {children}
    </div>
  )
}

export default Card
