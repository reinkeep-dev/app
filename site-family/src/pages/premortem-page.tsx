import { PageHero } from '@/components/page-hero'
import { PremortemTool } from '@/features/premortem/premortem-tool'
import { useDocumentTitle } from '@/lib/use-document-title'
import { SITE_PAGES } from '@/lib/site-pages'

export default function PremortemPage() {
  useDocumentTitle(SITE_PAGES.premortem.title)
  return (
    <>
      <PageHero
        kicker="For builders"
        tone="text-review"
        title="See what agents will see, before you launch."
        text="Describe your token. Get the answer the gate would give agents buying it, the risks with fixes, and how launches like it did a day later."
        image="/assets/pages/premortem.webp"
      />
      <PremortemTool />
    </>
  )
}
