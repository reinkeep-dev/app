import { PageHero } from '@/components/page-hero'
import { OddsPart } from '@/features/launches/launches-board'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function OddsPage() {
  useDocumentTitle(SITE_PAGES.odds.title)
  return (
    <>
      <PageHero kicker="Odds" tone="text-allow" title="How many tokens like this still trade a day later." text="Every launch our collector sees is re-checked after 24 hours. Grouped by how it started. A share appears only from 30 re-checked pools. A record of past tokens, not a prediction." image="/assets/pages/odds.webp" />
      <OddsPart />
    </>
  )
}
