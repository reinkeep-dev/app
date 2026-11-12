import { PageHero } from '@/components/page-hero'
import { StatusBoard } from '@/features/status/status-board'
import { pageTitle, useDocumentTitle } from '@/lib/use-document-title'

export default function StatusPage() {
  useDocumentTitle(pageTitle('Status'))
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
