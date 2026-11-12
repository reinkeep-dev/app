import { Link } from 'react-router'
import { ScrollReveal } from '@/components/scroll-reveal'
import { SiteSticker } from '@/components/site-sticker'
import { GATE } from '@/features/gate-tool/gate-api'
import { cn } from '@/lib/utils'

// Everything Reinkeep offers, live or not. T-01..T-06 answered live on 2026-11-12; T-07..T-10 are built and go live
// with the next API deploy (deploy the API and this page together).
// "Not yet" items say what they wait for, so nobody reads them as shipped.
type Tool = { n: string; title: string; text: string; sticker: string; where: string; to?: string; href?: string }

const LIVE: Tool[] = [
  { n: 'T-01', title: 'Check a token', sticker: 'sticker-question', where: '/check', to: '/check', text: 'Paste an address. Contract powers, liquidity seen, ticker copies, and the rule each one trips.' },
  { n: 'T-02', title: 'Gate', sticker: 'keep-allow', where: '/gate', to: '/gate', text: 'Write a payment and a policy, run it on the live gate, keep the signed receipt.' },
  { n: 'T-03', title: 'Verdict', sticker: 'sticker-check', where: 'GET /verdict/{address}', href: `${GATE}/llms.txt`, text: 'Token rules only, no payment, no receipt. 60 free a day per caller.' },
  { n: 'T-04', title: 'Batch', sticker: 'sticker-dots', where: 'POST /gate/batch', href: `${GATE}/llms.txt`, text: 'One payment against up to 10 tokens. One answer and one signed receipt per token.' },
  { n: 'T-05', title: 'Share a receipt', sticker: 'sticker-receipt', where: '/r/{id}', href: `${GATE}/llms.txt`, text: 'Every signed answer gets a page a person can open, with a fresh signature check.' },
  { n: 'T-06', title: 'Status', sticker: 'sticker-shield', where: '/status', to: '/status', text: 'Signer, database, chain node, payments and AI: which are up right now.' },
  { n: 'T-07', title: 'Watch held tokens', sticker: 'keep-review', where: 'POST /mandates', href: `${GATE}/llms.txt`, text: 'After you buy, the gate re-reads the contract every 30 minutes for 7 days and signs exit, watch or hold.' },
  { n: 'T-08', title: 'Pre-mortem', sticker: 'sticker-bolt', where: '/premortem', to: '/premortem', text: 'For builders: describe a launch, see the answer agents will get and the risks with fixes.' },
  { n: 'T-09', title: 'Launch data', sticker: 'sticker-coin', where: '/board', to: '/board', text: 'Board, Odds, Radar and Autopsy: how launches did a day later, from re-checks 24 hours after launch.' },
  { n: 'T-10', title: 'AI second opinion', sticker: 'sticker-sparkle', where: 'judge: true', href: `${GATE}/llms.txt`, text: 'On a REVIEW, a larger model gives its lean with the facts it rests on. Advice only: the rules decide.' },
]

const NOT_YET: { title: string; text: string }[] = [
  { title: 'Holder price', text: 'Half price for holders of the Reinkeep token. Built, switched on when the token launches.' },
  { title: 'Email watch', text: 'An email when a contract you follow changes. Waits for our own domain to send from.' },
  { title: 'Complete launch data', text: 'Launch numbers fill in once the collector runs from its new home; until then they say “not enough data”.' },
]

const linkClass = 'mt-4 inline-flex min-h-10 items-center font-mono text-[13px] text-ink underline decoration-hair underline-offset-4 outline-none hover:decoration-ink focus-visible:ring-2 focus-visible:ring-ink'

function ToolCard({ t }: { t: Tool }) {
  return (
    <article className="flex h-full flex-col rounded-2xl bg-panel p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold">
          <span className="font-mono text-ink/45">{t.n}</span>
          <span className="ml-2 text-allow">Live</span>
        </p>
        <span aria-hidden="true" className="-mr-1 -mt-1 shrink-0">
          <SiteSticker name={t.sticker} size={48} />
        </span>
      </div>
      <h3 className="mt-4 text-[20px] font-semibold tracking-tight">{t.title}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink/60">{t.text}</p>
      {t.to ? (
        <Link to={t.to} className={linkClass}>
          {t.where} →
        </Link>
      ) : (
        <a href={t.href} target="_blank" rel="noopener" className={linkClass}>
          {t.where} →<span className="sr-only"> (opens the agent guide in a new tab)</span>
        </a>
      )}
    </article>
  )
}

export function ToolsSection() {
  return (
    <section id="tools" aria-labelledby="tools-title" className="mx-auto max-w-[1040px] border-t border-hair px-5 py-20">
      <ScrollReveal>
        <p className="text-[14px] font-semibold text-sky">What you can use</p>
        <h2 id="tools-title" className="mt-3 text-[34px] font-semibold leading-tight sm:text-[44px]">Every tool, and where to open it.</h2>
        <p className="mt-3 max-w-[520px] text-[17px] text-ink/60">Ten tools today. The rest are listed with what they wait for.</p>
      </ScrollReveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIVE.map((t, i) => (
          <ScrollReveal key={t.n} delay={(i % 3) * 0.06} className="h-full">
            <ToolCard t={t} />
          </ScrollReveal>
        ))}
      </div>
      <ScrollReveal>
        <h3 className="mt-14 text-[14px] font-semibold text-ink/50">Not yet</h3>
        <ul className="mt-3 divide-y divide-hair border-y border-hair">
          {NOT_YET.map((t) => (
            <li key={t.title} className={cn('grid gap-1 py-4 sm:grid-cols-[220px_1fr] sm:gap-6')}>
              <span className="text-[16px] font-medium text-ink/70">{t.title}</span>
              <span className="text-[15px] text-ink/55">{t.text}</span>
            </li>
          ))}
        </ul>
      </ScrollReveal>
    </section>
  )
}
