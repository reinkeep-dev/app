import { PageHero } from '@/components/page-hero'
import { TokenCheckSection } from '@/features/token-check/token-check-section'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function CheckPage() {
  useDocumentTitle(SITE_PAGES.check.title)
  return (
    <>
      <PageHero
        kicker="Token check"
        tone="text-sky"
        title="Look at a token before you buy."
        text="Free, no account. Paste a token address from Robinhood Chain and the gate reads the contract."
        image="/assets/pages/check.webp"
      />
      <TokenCheckSection />
    </>
  )
}
