import { PageHero } from '@/components/page-hero'
import { BoardPart } from '@/features/launches/launches-board'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function BoardPage() {
  useDocumentTitle(SITE_PAGES.board.title)
  return (
    <>
      <PageHero kicker="Launch board" tone="text-sky" title="Every launch day, side by side." text="Each UTC day of the last two weeks: pools our collector saw, how many were re-checked a day later, and the share still trading." image="/assets/pages/launches.webp" />
      <BoardPart />
    </>
  )
}
