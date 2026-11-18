import { Link } from 'react-router'
import { ScrollReveal } from '@/components/scroll-reveal'
import { SiteSticker } from '@/components/site-sticker'
import { GATE } from '@/features/gate-tool/gate-api'
import roadmap from '@data/roadmap.json'

// Everything Reinkeep offers, live or not. T-01..T-06 answered live on 2026-11-12; T-07..T-10 are built and go live
// with the next API deploy (deploy the API and this page together).
// The "Next" cards below come from the roadmap file (state "next"), the same file the old site reads, so the two
// never disagree. They have no link: nothing to open yet.
// `on`: where a person can use it. 'site' = a page on reinkeep.xyz. 'agents' = only through the API and MCP, no page yet.
// `opens`: what a new-tab link opens, for screen readers. Default: the agent guide.
type Tool = { n: string; title: string; text: string; sticker: string; where: string; on: 'site' | 'agents'; to?: string; href?: string; opens?: string }

// A real BLOCK receipt from the live gate (2026-11-17). Paid to Reinkeep's own address, no personal data. Receipts are
// never deleted, so this page stays up.
const SAMPLE_RECEIPT = `${GATE}/r/rk_221e9ffc97937a0c`

const LIVE: Tool[] = [
  { n: 'T-01', title: 'Check a token', on: 'site', sticker: 'sticker-question', where: '/check', to: '/check', text: 'Paste an address. Contract powers, liquidity seen, ticker copies, and the rule each one trips.' },
  { n: 'T-02', title: 'Gate', on: 'site', sticker: 'keep-allow', where: '/gate', to: '/gate', text: 'Write a payment and a policy, run it on the live gate, keep the signed receipt.' },
  { n: 'T-03', title: 'Verdict', on: 'agents', sticker: 'sticker-check', where: 'GET /verdict/{address}', href: `${GATE}/llms.txt`, text: 'Token rules only, no payment, no receipt. 60 free a day per caller.' },
  { n: 'T-04', title: 'Batch', on: 'agents', sticker: 'sticker-dots', where: 'POST /gate/batch', href: `${GATE}/llms.txt`, text: 'One payment against up to 10 tokens. One answer and one signed receipt per token.' },
  { n: 'T-05', title: 'Share a receipt', on: 'site', sticker: 'sticker-receipt', where: 'See a real receipt', href: SAMPLE_RECEIPT, opens: 'a real receipt page', text: 'Every signed answer gets a page a person can open, with a fresh signature check.' },
  { n: 'T-06', title: 'Status', on: 'site', sticker: 'sticker-shield', where: '/status', to: '/status', text: 'Signer, database, chain node, payments and AI: which are up right now.' },
  { n: 'T-07', title: 'Watch held tokens', on: 'agents', sticker: 'keep-review', where: 'POST /mandates', href: `${GATE}/llms.txt`, text: 'After you buy, the gate re-reads the contract every 30 minutes for 7 days and signs exit, watch or hold.' },
  { n: 'T-08', title: 'Pre-mortem', on: 'site', sticker: 'sticker-bolt', where: '/premortem', to: '/premortem', text: 'For builders: describe a launch, see the answer agents will get and the risks with fixes.' },
  { n: 'T-09', title: 'Launch data', on: 'site', sticker: 'sticker-coin', where: '/board', to: '/board', text: 'Board, Odds and Radar: how launches did a day later, from re-checks 24 hours after launch.' },
  { n: 'T-10', title: 'AI second opinion', on: 'agents', sticker: 'sticker-sparkle', where: 'judge: true', href: `${GATE}/llms.txt`, text: 'On a REVIEW, a larger model gives its lean with the facts it rests on. Advice only: the rules decide.' },
]

const NEXT = roadmap
  .filter((r) => r.state !== 'live')
  .map((r, i) => ({ n: `N-${String(i + 1).padStart(2, '0')}`, title: r.title, text: r.text, sticker: (r as { sticker?: string }).sticker ?? 'sticker-star' }))

const linkClass = 'mt-1 inline-flex min-h-10 items-center font-mono text-[13px] text-ink underline decoration-hair underline-offset-4 outline-none hover:decoration-ink focus-visible:ring-2 focus-visible:ring-ink'

function NextCard({ t }: { t: (typeof NEXT)[number] }) {
  return (
    <article className="flex h-full flex-col rounded-2xl border border-dashed border-hair p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold">
          <span className="font-mono text-ink/65">{t.n}</span>
          <span className="ml-2 text-ink/65">Next</span>
        </p>
        <span aria-hidden="true" className="-mr-1 -mt-1 shrink-0">
          <SiteSticker name={t.sticker} size={48} />
        </span>
      </div>
      <h3 className="mt-4 text-[20px] font-semibold tracking-tight">{t.title}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink/65">{t.text}</p>
      <p className="mt-4 text-[13px] font-medium text-ink/65">Not live yet</p>
    </article>
  )
}

function ToolCard({ t }: { t: Tool }) {
  return (
    <article className="flex h-full flex-col rounded-2xl bg-panel p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[12px] font-semibold">
          <span className="font-mono text-ink/65">{t.n}</span>
          <span className="ml-2 text-allow">Live</span>
        </p>
        <span aria-hidden="true" className="-mr-1 -mt-1 shrink-0">
          <SiteSticker name={t.sticker} size={48} />
        </span>
      </div>
      <h3 className="mt-4 text-[20px] font-semibold tracking-tight">{t.title}</h3>
      <p className="mt-2 flex-1 text-[15px] leading-relaxed text-ink/65">{t.text}</p>
      <p className="mt-4 text-[13px] font-medium text-ink/80">{t.on === 'site' ? 'Open it on this website' : 'For agents: API and MCP. No page yet'}</p>
      {t.to ? (
        <Link to={t.to} className={linkClass}>
          {t.where} →
        </Link>
      ) : (
        <a href={t.href} target="_blank" rel="noopener" className={linkClass}>
          {t.where} →<span className="sr-only"> (opens {t.opens ?? 'the agent guide'} in a new tab)</span>
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
        <p className="mt-3 max-w-[520px] text-[17px] text-ink/65">Ten tools today. Six open right here on the website; four are for agents, through the API and MCP. What comes next is listed below.</p>
      </ScrollReveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIVE.map((t, i) => (
          <ScrollReveal key={t.n} delay={(i % 3) * 0.06} className="h-full">
            <ToolCard t={t} />
          </ScrollReveal>
        ))}
      </div>
      <ScrollReveal>
        <h3 className="mt-16 text-[24px] font-semibold tracking-tight">Next</h3>
        <p className="mt-2 max-w-[520px] text-[15px] text-ink/65">Being built or planned. None of these are live yet.</p>
      </ScrollReveal>
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {NEXT.map((t, i) => (
          <ScrollReveal key={t.n} delay={(i % 3) * 0.06} className="h-full">
            <NextCard t={t} />
          </ScrollReveal>
        ))}
      </div>
    </section>
  )
}
