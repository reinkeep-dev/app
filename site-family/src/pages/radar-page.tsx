import { PageHero } from '@/components/page-hero'
import { RadarPart } from '@/features/launches/launches-board'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function RadarPage() {
  useDocumentTitle(SITE_PAGES.radar.title)
  return (
    <>
      <PageHero kicker="Ticker radar" tone="text-review" title="Spot a wave of copies early." text="Tickers used by two or more new tokens in the last 48 hours, with the earliest token and the busiest one." image="/assets/pages/radar.webp" />
      <RadarPart />
    </>
  )
}
