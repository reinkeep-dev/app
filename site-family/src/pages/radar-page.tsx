import { PageHero } from '@/components/page-hero'
import { RadarPart } from '@/features/launches/launches-board'
import { pageTitle, useDocumentTitle } from '@/lib/use-document-title'

export default function RadarPage() {
  useDocumentTitle(pageTitle('Ticker radar'))
  return (
    <>
      <PageHero kicker="Ticker radar" tone="text-review" title="Spot a wave of copies early." text="Tickers used by two or more new tokens in the last 48 hours, with the earliest token and the busiest one." image="/assets/pages/radar.webp" />
      <RadarPart />
    </>
  )
}
