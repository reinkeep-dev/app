import { Link } from 'react-router'
import { ScrollReveal } from '@/components/scroll-reveal'
import { SiteSticker } from '@/components/site-sticker'
import { GATE } from '@/features/gate-tool/gate-api'
import { cn } from '@/lib/utils'

// Everything Reinkeep offers, live or not. T-01..T-06 answered live on 2026-11-12; T-07..T-10 are built and go live
// with the next API deploy (deploy the API and this page together).
// "Not yet" items say what they wait for, so nobody reads them as shipped.
// `on`: where a person can use it. 'site' = a page on reinkeep.xyz. 'agents' = only through the API and MCP, no page yet.
type Tool = { n: string; title: string; text: string; sticker: string; where: string; on: 'site' | 'agents'; to?: string; href?: string }

const LIVE: Tool[] = [
  { n: 'T-01', title: 'Check a token', on: 'site', sticker: 'sticker-question', where: '/check', to: '/check', text: 'Paste an address. Contract powers, liquidity seen, ticker copies, and the rule each one trips.' },
  { n: 'T-02', title: 'Gate', on: 'site', sticker: 'keep-allow', where: '/gate', to: '/gate', text: 'Write a payment and a policy, run it on the live gate, keep the signed receipt.' },
  { n: 'T-03', title: 'Verdict', on: 'agents', sticker: 'sticker-check', where: 'GET /verdict/{address}', href: `${GATE}/llms.txt`, text: 'Token rules only, no payment, no receipt. 60 free a day per caller.' },
  { n: 'T-04', title: 'Batch', on: 'agents', sticker: 'sticker-dots', where: 'POST /gate/batch', href: `${GATE}/llms.txt`, text: 'One payment against up to 10 tokens. One answer and one signed receipt per token.' },
  { n: 'T-05', title: 'Share a receipt', on: 'site', sticker: 'sticker-receipt', where: '/r/{id}', href: `${GATE}/llms.txt`, text: 'Every signed answer gets a page a person can open, with a fresh signature check.' },
  { n: 'T-06', title: 'Status', on: 'site', sticker: 'sticker-shield', where: '/status', to: '/status', text: 'Signer, database, chain node, payments and AI: which are up right now.' },
  { n: 'T-07', title: 'Watch held tokens', on: 'agents', sticker: 'keep-review', where: 'POST /mandates', href: `${GATE}/llms.txt`, text: 'After you buy, the gate re-reads the contract every 30 minutes for 7 days and signs exit, watch or hold.' },
  { n: 'T-08', title: 'Pre-mortem', on: 'site', sticker: 'sticker-bolt', where: '/premortem', to: '/premortem', text: 'For builders: describe a launch, see the answer agents will get and the risks with fixes.' },
  { n: 'T-09', title: 'Launch data', on: 'site', sticker: 'sticker-coin', where: '/board', to: '/board', text: 'Board, Odds and Radar: how launches did a day later, from re-checks 24 hours after launch.' },
  { n: 'T-10', title: 'AI second opinion', on: 'agents', sticker: 'sticker-sparkle', where: 'judge: true', href: `${GATE}/llms.txt`, text: 'On a REVIEW, a larger model gives its lean with the facts it rests on. Advice only: the rules decide.' },
]

const NOT_YET: { title: string; text: string }[] = [
  { title: 'Holder price', text: 'Half price for holders of the Reinkeep token. Built, switched on when the token launches.' },
  { title: 'Watch page', text: 'Paste a token you hold and follow its checks for 7 days, with an optional email. Agents can do this today.' },
  { title: 'Token autopsy', text: 'What happened to one token in its first day.' },
]

const linkClass = 'mt-1 inline-flex min-h-10 items-center font-mono text-[13px] text-ink underline decoration-hair underline-offset-4 outline-none hover:decoration-ink focus-visible:ring-2 focus-visible:ring-ink'

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
        <p className="mt-3 max-w-[520px] text-[17px] text-ink/65">Ten tools today. Six open right here on the website; four are for agents, through the API and MCP. The rest are listed below.</p>
      </ScrollReveal>
      <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {LIVE.map((t, i) => (
          <ScrollReveal key={t.n} delay={(i % 3) * 0.06} className="h-full">
            <ToolCard t={t} />
          </ScrollReveal>
        ))}
      </div>
      <ScrollReveal>
        <h3 className="mt-14 text-[14px] font-semibold text-ink/65">Not yet</h3>
        <ul className="mt-3 divide-y divide-hair border-y border-hair">
          {NOT_YET.map((t) => (
            <li key={t.title} className={cn('grid gap-1 py-4 sm:grid-cols-[220px_1fr] sm:gap-6')}>
              <span className="text-[16px] font-medium text-ink/70">{t.title}</span>
              <span className="text-[15px] text-ink/65">{t.text}</span>
            </li>
          ))}
        </ul>
      </ScrollReveal>
    </section>
  )
}
