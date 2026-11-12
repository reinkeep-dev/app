import { PageHero } from '@/components/page-hero'
import { TokenCheckSection } from '@/features/token-check/token-check-section'
import { pageTitle, useDocumentTitle } from '@/lib/use-document-title'

export default function CheckPage() {
  useDocumentTitle(pageTitle('Check'))
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
