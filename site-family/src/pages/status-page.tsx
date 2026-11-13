import { PageHero } from '@/components/page-hero'
import { StatusBoard } from '@/features/status/status-board'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function StatusPage() {
  useDocumentTitle(SITE_PAGES.status.title)
  return (
    <>
      <PageHero
        kicker="Status"
        tone="text-grass"
        title="Is the gate up right now?"
        text="Live from the gate itself. Each part it depends on is checked when you open this page."
        image="/assets/pages/status.webp"
      />
      <section className="mx-auto max-w-[1040px] px-5 pb-20 pt-6" aria-label="Gate status">
        <StatusBoard />
      </section>
    </>
  )
}
