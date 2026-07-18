/**
 * PageHeader — eyebrow tag + title + optional description.
 *
 * Restyled to the new system (BRAND.md: "tipografía con carácter
 * tecnológico, no editorial" — DESIGN_REVIEW.md: sans for headings too,
 * Playfair Display retired here). Props are unchanged.
 */
interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div className="mb-8 font-inter">
      {eyebrow && (
        <span className="mb-3 inline-block rounded-pill bg-violet-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-violet-900 ring-1 ring-border-subtle dark:bg-navy-800/40 dark:text-zinc-300 dark:ring-white/10">
          {eyebrow}
        </span>
      )}
      <h1 className="font-inter text-3xl font-bold tracking-tight text-ink dark:text-zinc-100 lg:text-4xl">
        {title}
      </h1>
      {description && (
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-soft dark:text-zinc-500">
          {description}
        </p>
      )}
    </div>
  )
}

export default PageHeader
