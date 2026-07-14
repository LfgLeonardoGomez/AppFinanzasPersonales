/**
 * PageHeader — eyebrow tag + title + optional description.
 *
 * Editorial luxury feel: massive serif title, microscopic eyebrow pill.
 */
interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: string
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div className="mb-8">
      {eyebrow && (
        <span className="mb-3 inline-block rounded-full bg-navy-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-navy-600 ring-1 ring-black/[0.04] dark:bg-navy-800/40 dark:text-zinc-300 dark:ring-white/10">
          {eyebrow}
        </span>
      )}
      <h1 className="font-serif text-3xl font-semibold tracking-tight text-navy-800 dark:text-zinc-100 lg:text-4xl">
        {title}
      </h1>
      {description && (
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-navy-400 dark:text-zinc-500">
          {description}
        </p>
      )}
    </div>
  )
}

export default PageHeader
