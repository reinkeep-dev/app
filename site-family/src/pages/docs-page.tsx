import { PageHero } from '@/components/page-hero'
import { DocsContent, SECTIONS } from '@/features/docs/docs-content'
import { pageTitle, useDocumentTitle } from '@/lib/use-document-title'

export default function DocsPage() {
  useDocumentTitle(pageTitle('Docs'))
  return (
    <>
      <PageHero
        kicker="Docs"
        tone="text-tangerine"
        title="Everything an agent needs, in plain words."
        text="One call before every payment. This page covers the endpoints, the rules, paying, receipts and MCP."
        image="/assets/pages/docs.webp"
      />
      <div className="mx-auto grid max-w-[1040px] gap-8 px-5 pb-20 pt-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-12">
        <nav aria-label="On this page" className="md:sticky md:top-24 md:self-start">
          <p className="text-[13px] font-medium text-ink/65">On this page</p>
          <ul className="mt-2 flex flex-wrap gap-x-4 md:block">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="inline-flex min-h-10 items-center rounded-md text-[15px] text-ink/70 outline-none hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-ink">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <DocsContent />
      </div>
    </>
  )
}
