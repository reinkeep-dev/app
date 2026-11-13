import { PageHero } from '@/components/page-hero'
import { AutopsyPart } from '@/features/launches/launches-board'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function AutopsyPage() {
  useDocumentTitle(SITE_PAGES.autopsy.title)
  return (
    <>
      <PageHero kicker="Autopsy" tone="text-block" title="What happened to one token in its first day." text="Paste a token address. See its numbers when we first saw it and a day later, and which pattern it fits: still trading, liquidity pulled, faded, or never lived." image="/assets/pages/autopsy.webp" />
      <AutopsyPart />
    </>
  )
}
