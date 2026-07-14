/**
 * Card — premium container with subtle depth and haptic hover.
 *
 * Uses a "single bezel" approach (outer wrapper with ring + shadow)
 * to keep the DOM lean while retaining a machined feel.
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
        rounded-[1.5rem] bg-card
        shadow-[0_2px_8px_rgba(10,37,64,0.04)]
        ring-1 ring-black/[0.04]
        transition-all duration-300 ease-[var(--ease-out)]
        dark:bg-card-dark dark:ring-white/10
        ${hover ? 'hover:shadow-[0_8px_24px_rgba(10,37,64,0.10)] dark:hover:shadow-[0_8px_24px_rgba(0,0,0,0.30)]' : ''}
        ${noPadding ? '' : 'p-6 lg:p-8'}
        ${className}
      `}
    >
      {children}
    </div>
  )
}

export default Card
