import { Link } from 'react-router'
import { SiteSticker } from '@/components/site-sticker'
import { pageTitle, useDocumentTitle } from '@/lib/use-document-title'

export default function NotFoundPage() {
  useDocumentTitle(pageTitle('Page not found'))
  return (
    <section className="mx-auto flex max-w-[1040px] flex-col items-center px-5 py-20 text-center">
      <SiteSticker name="keep-block" size={170} />
      <h1 className="mt-6 text-[40px] font-semibold leading-tight sm:text-[52px]">Nothing at this gate.</h1>
      <p className="mt-3 max-w-[420px] text-[17px] text-ink/65">Keep checked every door and this address is not one of them. The link may be old, or mistyped.</p>
      <Link to="/" className="mt-8 inline-flex min-h-12 items-center rounded-full bg-ink px-6 text-[15px] font-medium text-white outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 active:scale-[0.97]">
        Back to the home page
      </Link>
    </section>
  )
}
